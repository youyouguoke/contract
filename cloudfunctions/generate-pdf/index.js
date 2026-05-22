const cloud = require('wx-server-sdk');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const JSZip = require('jszip');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ============ Helpers ============

async function downloadFile(fileID) {
  const res = await cloud.downloadFile({ fileID });
  return res.fileContent;
}

async function getDocById(collection, id) {
  const res = await db.collection(collection).where({ _id: id }).limit(1).get();
  return res.data && res.data.length > 0 ? res.data[0] : null;
}

function isPdfBuffer(buf) {
  return buf && buf.length > 4 && buf.slice(0, 5).toString('ascii') === '%PDF-';
}

async function embedImage(pdfDoc, imageBytes) {
  if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
    return pdfDoc.embedPng(imageBytes);
  }
  if (imageBytes[0] === 0xFF && imageBytes[1] === 0xD8) {
    return pdfDoc.embedJpg(imageBytes);
  }
  try {
    return await pdfDoc.embedPng(imageBytes);
  } catch (_) {
    return pdfDoc.embedJpg(imageBytes);
  }
}

// ============ 中文字体加载 ============

// 全局缓存字体字节，避免重复加载
let cachedFontBytes = null;

/**
 * 加载中文字体：内存缓存 → 本地文件（打包在云函数中）
 */
async function loadChineseFont(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);

  if (!cachedFontBytes) {
    const fs = require('fs');
    const path = require('path');
    const fontPath = path.join(__dirname, 'NotoSansSC-Regular.otf');
    try {
      cachedFontBytes = fs.readFileSync(fontPath);
      console.log('Chinese font loaded from local file:', cachedFontBytes.length, 'bytes');
    } catch (err) {
      console.error('Font file not found:', fontPath, err.message);
      return null;
    }
  }

  try {
    return await pdfDoc.embedFont(cachedFontBytes);
  } catch (err) {
    console.error('Font embed failed:', err.message);
    return null;
  }
}

// ============ Collect signer images ============

async function collectSignerImages(pdfDoc, contract) {
  const images = [];
  const signers = contract.signers || [];
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i];
    if (s.status === 'signed' && s.signatureFileID) {
      try {
        const bytes = await downloadFile(s.signatureFileID);
        images.push({ index: i, image: await embedImage(pdfDoc, bytes), name: s.name, role: s.role });
      } catch (_) {}
    }
  }
  return images;
}

async function collectStampImages(pdfDoc, contract) {
  const images = {};
  const signers = contract.signers || [];
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i];
    let stampFileID = null;
    if (s.status === 'signed' && s.stampFileID) {
      stampFileID = s.stampFileID;
    } else if (i === 0 && contract.selectedStampId) {
      try {
        const stampRecord = await getDocById('stamps', contract.selectedStampId);
        if (stampRecord && stampRecord.image) stampFileID = stampRecord.image;
      } catch (_) {}
    }
    if (stampFileID) {
      try {
        const bytes = await downloadFile(stampFileID);
        images[i] = await embedImage(pdfDoc, bytes);
      } catch (_) {}
    }
  }
  return images;
}

// ============ Scenario A: Overlay markers on existing PDF ============

async function overlayMarkers(pdfDoc, template, contract, signerImageMap) {
  const markers = template.markers || [];
  const pages = pdfDoc.getPages();
  const signers = contract.signers || [];

  console.log('overlayMarkers: markers=%d, pages=%d, signers=%d, signerImages=%s',
    markers.length, pages.length, signers.length, Object.keys(signerImageMap).join(','));

  for (const marker of markers) {
    const pageIndex = marker.page;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { width: pw, height: ph } = page.getSize();
    const mW = (marker.widthPercent / 100) * pw;
    const mH = (marker.heightPercent / 100) * ph;
    const mX = (marker.xPercent / 100) * pw;
    const mY = ph - (marker.yPercent / 100) * ph - mH;

    if (marker.type === 'signature') {
      const img = signerImageMap[marker.signerIndex];
      if (img) page.drawImage(img, { x: mX, y: mY, width: mW, height: mH });
    } else if (marker.type === 'stamp') {
      // 查找对应签署方的印章
      const signer = signers[marker.signerIndex];
      let stampFileID = null;

      // 1. 签署方自带印章
      if (signer && signer.stampFileID) {
        stampFileID = signer.stampFileID;
      }
      // 2. 合约级别的 selectedStampId 回退（适用于发起方）
      if (!stampFileID && marker.signerIndex === 0 && contract.selectedStampId) {
        try {
          const stampRecord = await getDocById('stamps', contract.selectedStampId);
          if (stampRecord && stampRecord.image) {
            stampFileID = stampRecord.image;
          }
        } catch (_) {}
      }

      if (stampFileID) {
        try {
          const bytes = await downloadFile(stampFileID);
          const img = await embedImage(pdfDoc, bytes);
          const stampSize = Math.min(mW, mH);
          const stampX = mX + (mW - stampSize) / 2;
          const stampY = mY + (mH - stampSize) / 2;
          page.drawImage(img, { x: stampX, y: stampY, width: stampSize, height: stampSize });
        } catch (_) {}
      }
    } else if (marker.type === 'date') {
      // 只为已签署的签署方显示日期
      const signer = signers[marker.signerIndex];
      if (signer && signer.status === 'signed' && signer.signedAt) {
        const dateStr = signer.signedAt.substring(0, 10);
        page.drawText(dateStr, { x: mX + 2, y: mY + mH * 0.3, size: Math.max(8, Math.min(mH * 0.5, 14)) });
      }
    }
  }
}

// ============ Scenario B: Parse DOCX, build PDF pages ============

/** XML 实体反转义（解码从 DOCX XML 提取的文本） */
function xmlUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

async function extractDocxText(fileBytes) {
  const zip = await JSZip.loadAsync(fileBytes);
  const docXml = zip.file('word/document.xml');
  if (!docXml) return [];

  const xml = await docXml.async('string');
  const paragraphs = [];
  // Extract <w:t> text nodes grouped by <w:p> paragraphs
  const pParts = xml.split(/<w:p[\s>]/);
  for (let i = 1; i < pParts.length; i++) {
    const end = pParts[i].indexOf('</w:p>');
    const pXml = end > -1 ? pParts[i].substring(0, end) : pParts[i];
    const texts = [];
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = tRegex.exec(pXml)) !== null) {
      texts.push(xmlUnescape(m[1]));
    }
    paragraphs.push(texts.join(''));
  }
  return paragraphs;
}

// ============ Scenario C: Generate PDF from contract fields ============

// ============ 安全文本绘制 ============

function safeDrawText(page, text, options) {
  try {
    page.drawText(text, options);
  } catch (_) {
    // 整段绘制失败时，逐字符尝试，跳过不支持的字符而非丢失整段
    if (!text || !options.font) return;
    let offsetX = options.x || 0;
    for (const ch of text) {
      try {
        page.drawText(ch, { ...options, x: offsetX });
        offsetX += options.font.widthOfTextAtSize(ch, options.size || 12);
      } catch (_e) {
        try {
          offsetX += options.font.widthOfTextAtSize(' ', options.size || 12);
        } catch (_e2) {}
      }
    }
  }
}

function safeTextWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch (_) {
    // 中文字符宽度估算
    return text.length * size * 0.55;
  }
}

function drawTextWrapped(page, text, x, y, maxWidth, fontSize, font, lineHeight) {
  if (!text) return y;
  const chars = text.split('');
  let line = '';
  let curY = y;

  for (const ch of chars) {
    if (ch === '\n') {
      if (line) { safeDrawText(page, line, { x, y: curY, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) }); }
      curY -= lineHeight;
      line = '';
      continue;
    }
    const testLine = line + ch;
    const testWidth = safeTextWidth(font, testLine, fontSize);
    if (testWidth > maxWidth && line) {
      safeDrawText(page, line, { x, y: curY, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
      curY -= lineHeight;
      line = ch;
    } else {
      line = testLine;
    }
  }
  if (line) {
    safeDrawText(page, line, { x, y: curY, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
    curY -= lineHeight;
  }
  return curY;
}

async function generateContentPdf(pdfDoc, contract, cnFont, signerImages, stampImages) {
  const PAGE_W = 595; // A4
  const PAGE_H = 842;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const font = cnFont || await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = cnFont || await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let curY = PAGE_H - MARGIN;

  function ensureSpace(need) {
    if (curY - need < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      curY = PAGE_H - MARGIN;
    }
  }

  // Title
  ensureSpace(40);
  const titleText = contract.title || '合约';
  const titleSize = 18;
  const titleWidth = safeTextWidth(fontBold, titleText, titleSize);
  safeDrawText(page, titleText, { x: (PAGE_W - titleWidth) / 2, y: curY, size: titleSize, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
  curY -= 40;

  // Divider
  page.drawLine({ start: { x: MARGIN, y: curY }, end: { x: PAGE_W - MARGIN, y: curY }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  curY -= 25;

  // Contract content section
  const fields = contract.formData && contract.formData.fields || {};
  const signers = contract.signers || [];

  const partyA = signers.find(s => s.role === '甲方');
  const partyB = signers.find(s => s.role === '乙方');
  const partyAName = (fields['甲方名称'] || (partyA ? partyA.name : '') || '-');
  const partyBName = (partyB ? partyB.name : '-');

  // Contract info — 发起方用甲方/乙方名称
  const initiatorRole = contract.myRoleLabel || '甲方';
  const initiatorDisplayName = initiatorRole === '甲方' ? partyAName : partyBName;
  const info = [
    ['发起方', initiatorDisplayName],
    ['创建时间', contract.createdAt ? contract.createdAt.substring(0, 10) : '-'],
  ];
  if (contract.deadline) info.push(['签署截止', contract.deadline]);

  for (const [label, value] of info) {
    ensureSpace(22);
    safeDrawText(page, `${label}:  ${value}`, { x: MARGIN, y: curY, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
    curY -= 22;
  }
  curY -= 10;

  ensureSpace(30);
  safeDrawText(page, '合约内容', { x: MARGIN, y: curY, size: 14, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
  curY -= 28;
  page.drawLine({ start: { x: MARGIN, y: curY + 10 }, end: { x: PAGE_W - MARGIN, y: curY + 10 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  curY -= 5;

  // 甲方：名称  一行；乙方：名称  一行
  ensureSpace(40);
  safeDrawText(page, `甲方：${partyAName}`, { x: MARGIN, y: curY, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  curY -= 20;

  ensureSpace(20);
  safeDrawText(page, `乙方：${partyBName}`, { x: MARGIN, y: curY, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  curY -= 20;

  // 合约内容（详细）
  const contentText = fields['合约内容'] || '';
  if (contentText) {
    ensureSpace(40);
    safeDrawText(page, '合约内容', { x: MARGIN, y: curY, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    curY -= 18;
    curY = drawTextWrapped(page, String(contentText), MARGIN + 10, curY, CONTENT_W - 10, 10, font, 16);
    curY -= 10;
  }

  // Other fields (exclude 甲方名称 and 合约内容 which are already shown above)
  const skipFields = ['甲方名称', '合约内容'];
  const extraKeys = Object.keys(fields).filter(k => !skipFields.includes(k) && fields[k] !== undefined && fields[k] !== '');
  for (const key of extraKeys) {
    ensureSpace(40);
    safeDrawText(page, key, { x: MARGIN, y: curY, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    curY -= 18;
    curY = drawTextWrapped(page, String(fields[key]), MARGIN + 10, curY, CONTENT_W - 10, 10, font, 16);
    curY -= 10;
  }

  // Signer block — left/right side-by-side, no role labels, horizontally aligned
  ensureSpace(30);
  curY -= 10;
  safeDrawText(page, '签署信息', { x: MARGIN, y: curY, size: 14, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
  curY -= 28;
  page.drawLine({ start: { x: MARGIN, y: curY + 10 }, end: { x: PAGE_W - MARGIN, y: curY + 10 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  curY -= 10;

  const LEFT_X = MARGIN;
  const RIGHT_X = MARGIN + CONTENT_W / 2 + 10;
  const COL_W = CONTENT_W / 2 - 10; // 每列可用宽度
  const SIG_W = 120;
  const SIG_H = 50;
  const STAMP_SIZE = 70;

  // Process signers in pairs (left/right), draw both at the same Y for horizontal alignment
  for (let row = 0; row < Math.ceil(signers.length / 2); row++) {
    const leftIdx = row * 2;
    const rightIdx = row * 2 + 1;
    const leftSigner = signers[leftIdx];
    const rightSigner = rightIdx < signers.length ? signers[rightIdx] : null;

    // Calculate max height needed for this row
    let leftH = 0;
    let rightH = 0;
    const leftSigImg = signerImages.find(img => img.index === leftIdx);
    const leftStampImg = stampImages[leftIdx];
    if (leftSigImg) leftH += SIG_H + 8;
    if (leftStampImg) leftH += STAMP_SIZE + 8;
    if (leftSigner.signedAt) leftH += 16;

    if (rightSigner) {
      const rightSigImg = signerImages.find(img => img.index === rightIdx);
      const rightStampImg = stampImages[rightIdx];
      if (rightSigImg) rightH += SIG_H + 8;
      if (rightStampImg) rightH += STAMP_SIZE + 8;
      if (rightSigner.signedAt) rightH += 16;
    }

    const rowHeight = Math.max(leftH, rightH) + 20;
    ensureSpace(rowHeight);

    // 每列居中计算：centerX = 列起始X + 列宽/2
    const leftCenterX = LEFT_X + COL_W / 2;
    const rightCenterX = RIGHT_X + COL_W / 2;

    // Draw signatures at same Y, centered in each column
    let drawY = curY;

    if (leftSigImg) {
      page.drawImage(leftSigImg.image, { x: leftCenterX - SIG_W / 2, y: drawY - SIG_H, width: SIG_W, height: SIG_H });
    }
    if (rightSigner) {
      const rightSigImg = signerImages.find(img => img.index === rightIdx);
      if (rightSigImg) {
        page.drawImage(rightSigImg.image, { x: rightCenterX - SIG_W / 2, y: drawY - SIG_H, width: SIG_W, height: SIG_H });
      }
    }
    drawY -= SIG_H + 8;

    // Stamps at same Y, centered
    if (leftStampImg) {
      page.drawImage(leftStampImg, { x: leftCenterX - STAMP_SIZE / 2, y: drawY - STAMP_SIZE, width: STAMP_SIZE, height: STAMP_SIZE });
    }
    if (rightSigner) {
      const rightStampImg = stampImages[rightIdx];
      if (rightStampImg) {
        page.drawImage(rightStampImg, { x: rightCenterX - STAMP_SIZE / 2, y: drawY - STAMP_SIZE, width: STAMP_SIZE, height: STAMP_SIZE });
      }
    }
    drawY -= STAMP_SIZE + 8;

    // Dates at same Y, centered
    if (leftSigner.signedAt) {
      const leftDateStr = leftSigner.signedAt.substring(0, 10);
      const leftDateW = safeTextWidth(font, leftDateStr, 9);
      safeDrawText(page, leftDateStr, { x: leftCenterX - leftDateW / 2, y: drawY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }
    if (rightSigner && rightSigner.signedAt) {
      const rightDateStr = rightSigner.signedAt.substring(0, 10);
      const rightDateW = safeTextWidth(font, rightDateStr, 9);
      safeDrawText(page, rightDateStr, { x: rightCenterX - rightDateW / 2, y: drawY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }
    drawY -= 16;

    curY = drawY - 10;
  }
}

// ============ Main ============

exports.main = async (event) => {
  const { contractId } = event;
  if (!contractId) {
    return { code: -1, message: '缺少 contractId 参数' };
  }

  try {
    const contract = await getDocById('contracts', contractId);
    if (!contract) {
      return { code: -1, message: '合约不存在' };
    }

    const pdfDoc = PDFDocument.create ? await PDFDocument.create() : null;
    let resultPdfDoc;
    const template = contract.templateId ? await getDocById('templates', contract.templateId) : null;
    const hasCloudFile = template && template.cloudFileID;

    if (hasCloudFile) {
      // ---- Document template: has uploaded file ----
      const fileBytes = await downloadFile(template.cloudFileID);

      if (isPdfBuffer(fileBytes)) {
        // Case 1: PDF file — load and overlay
        resultPdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      } else {
        // Case 2: Word file — extract text, create new PDF, overlay
        resultPdfDoc = await PDFDocument.create();
        const cnFont = await loadChineseFont(resultPdfDoc);
        const font = cnFont || await resultPdfDoc.embedFont(StandardFonts.Helvetica);
        const paragraphs = await extractDocxText(fileBytes);

        const PAGE_W = 595;
        const PAGE_H = 842;
        const MARGIN = 50;
        const CONTENT_W = PAGE_W - MARGIN * 2;

        // 确定模板期望的页数（标记可能引用这些页）
        const expectedPages = (template.pageCount && template.pageCount > 0) ? template.pageCount
          : (template.pages && template.pages.length > 0) ? template.pages.length : 1;

        let page = resultPdfDoc.addPage([PAGE_W, PAGE_H]);
        let curY = PAGE_H - MARGIN;

        for (const para of paragraphs) {
          if (!para.trim()) { curY -= 14; continue; }
          if (curY < MARGIN + 20) {
            page = resultPdfDoc.addPage([PAGE_W, PAGE_H]);
            curY = PAGE_H - MARGIN;
          }
          curY = drawTextWrapped(page, para, MARGIN, curY, CONTENT_W, 11, font, 18);
          curY -= 6;
        }

        // 确保 PDF 至少有模板期望的页数（以匹配签署标记位置）
        while (resultPdfDoc.getPageCount() < expectedPages) {
          resultPdfDoc.addPage([PAGE_W, PAGE_H]);
        }
      }

      // Overlay markers (signature/stamp/date positions)
      const signerImageMap = {};
      const signerImages = await collectSignerImages(resultPdfDoc, contract);
      for (const si of signerImages) { signerImageMap[si.index] = si.image; }

      console.log('Template markers:', template.markers ? template.markers.length : 0,
        'Signers:', (contract.signers || []).map(s => s.status).join(','),
        'SignerImages:', signerImages.length,
        'PDF pages:', resultPdfDoc.getPageCount());

      // Also check legacy selectedSignatureId / selectedStampId
      if (contract.selectedSignatureId && !signerImageMap[contract.myRole || 0]) {
        const sigRecord = await getDocById('signatures', contract.selectedSignatureId);
        if (sigRecord && sigRecord.image) {
          try {
            const bytes = await downloadFile(sigRecord.image);
            signerImageMap[contract.myRole || 0] = await embedImage(resultPdfDoc, bytes);
          } catch (_) {}
        }
      }

      if (template.markers && template.markers.length > 0) {
        await overlayMarkers(resultPdfDoc, template, contract, signerImageMap);
      }
    } else {
      // ---- Non-document template: generate PDF from contract fields ----
      resultPdfDoc = await PDFDocument.create();
      const cnFont = await loadChineseFont(resultPdfDoc);
      const signerImages = await collectSignerImages(resultPdfDoc, contract);
      const stampImages = await collectStampImages(resultPdfDoc, contract);
      await generateContentPdf(resultPdfDoc, contract, cnFont, signerImages, stampImages);
    }

    // Save and upload
    const composedBytes = await resultPdfDoc.save();
    const cloudPath = `signed-contracts/${contractId}_${Date.now()}.pdf`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: Buffer.from(composedBytes),
    });

    await db.collection('contracts').doc(contractId).update({
      data: {
        signedPdfFileID: uploadRes.fileID,
        signedPdfGeneratedAt: new Date().toISOString(),
      },
    });

    return { code: 0, data: { fileID: uploadRes.fileID } };
  } catch (err) {
    console.error('generate-pdf error:', err);
    return { code: -1, message: err.message || 'PDF 生成失败' };
  }
};
