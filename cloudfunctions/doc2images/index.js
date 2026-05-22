const cloud = require('wx-server-sdk');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const JSZip = require('jszip');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_PAGES = 20;
const RENDER_SCALE = 2;

exports.main = async (event) => {
  const { cloudFileID, renderImages } = event;

  if (!cloudFileID) {
    return { code: -1, message: '缺少 cloudFileID 参数' };
  }

  try {
    const fileRes = await cloud.downloadFile({ fileID: cloudFileID });
    const fileBuffer = fileRes.fileContent;

    if (!fileBuffer || fileBuffer.length === 0) {
      return { code: -1, message: '文件下载失败或文件为空' };
    }

    const ext = cloudFileID.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      return await handlePDF(fileBuffer, cloudFileID, renderImages === true);
    } else if (ext === 'docx') {
      return await handleDOCX(fileBuffer);
    } else if (ext === 'doc') {
      return {
        code: 0,
        data: { pageCount: 0, pageDimensions: [], pageImages: [], needManualPageCount: true },
      };
    } else {
      return { code: -1, message: '不支持的文件格式: ' + ext };
    }
  } catch (err) {
    console.error('doc2images error:', err);
    return { code: -1, message: err.message || '文档解析失败' };
  }
};

async function handlePDF(pdfBuffer, cloudFileID, shouldRender) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    return { code: -1, message: 'PDF 没有页面' };
  }

  const pageCount = Math.min(totalPages, MAX_PAGES);
  const pageDimensions = [];
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();
    pageDimensions.push({ width: Math.round(width), height: Math.round(height) });
  }

  let pageImages = [];
  let renderError = '';
  if (shouldRender) {
    try {
      pageImages = await renderPdfPages(pdfBuffer, pageCount);
    } catch (renderErr) {
      console.error('PDF render failed:', renderErr.message);
      renderError = renderErr.message || '渲染失败';
    }
  }

  return {
    code: 0,
    data: { pageCount, totalPagesInPdf: totalPages, pageDimensions, pageImages, renderError },
  };
}

// 初始化 resvg-wasm（全局只需一次）
let resvgReady = null;
function ensureResvg() {
  if (!resvgReady) {
    resvgReady = (async () => {
      const { initWasm } = require('@resvg/resvg-wasm');
      const fs = require('fs');
      const path = require('path');
      const wasmPath = path.join(__dirname, 'node_modules/@resvg/resvg-wasm/index_bg.wasm');
      const wasmBuf = fs.readFileSync(wasmPath);
      // 传入编译好的 WebAssembly.Module 以避免 URL/fetch 问题
      const wasmModule = await WebAssembly.compile(wasmBuf);
      await initWasm(wasmModule);
    })();
  }
  return resvgReady;
}

async function renderPdfPages(pdfBuffer, pageCount) {
  // 安装 DOM stubs，使 pdfjs SVGGraphics 可在 Node.js 运行
  const { setStubs, serializeSvg } = require('./domstubs');
  setStubs(global);

  // 加载 pdfjs-dist
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

  // 初始化 resvg-wasm（SVG → PNG）
  await ensureResvg();
  const { Resvg } = require('@resvg/resvg-wasm');
  const path = require('path');
  const fontPath = path.join(__dirname, 'NotoSansSC-Regular.otf');

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    cMapUrl: path.join(__dirname, 'node_modules/pdfjs-dist/cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts') + '/',
    disableStream: true,
    isEvalSupported: false,
  }).promise;

  const pageImages = [];

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });

      // 使用 SVGGraphics 渲染为 SVG DOM
      const opList = await page.getOperatorList();
      const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs, true);
      const svgElement = await svgGfx.getSVG(opList, viewport);
      page.cleanup();

      // 序列化 SVG DOM 为字符串
      const svgString = serializeSvg(svgElement);

      // 使用 resvg-wasm 将 SVG 转为 PNG（加载中文字体以支持文本渲染）
      const resvg = new Resvg(svgString, {
        fitTo: { mode: 'width', value: Math.round(viewport.width) },
        background: '#FFFFFF',
        font: {
          fontFiles: [fontPath],
          defaultFontFamily: 'Noto Sans SC',
          loadSystemFonts: false,
        },
      });
      const rendered = resvg.render();
      const pngBuffer = Buffer.from(rendered.asPng());

      const uploadRes = await cloud.uploadFile({
        cloudPath: 'pdf_pages/' + Date.now() + '_p' + i + '.png',
        fileContent: pngBuffer,
      });
      pageImages.push(uploadRes.fileID);
    } catch (pageErr) {
      console.error('Page ' + i + ' render failed:', pageErr.message);
      pageImages.push('');
    }
  }

  pdf.destroy();
  return pageImages;
}

// ============ DOCX 富文本解析与渲染 ============

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const DEFAULT_FONT_SIZE = 11;
const LINE_HEIGHT_FACTOR = 1.6;
const PARA_SPACING = 4;

// 默认标题样式（当 styles.xml 未明确定义时）
const HEADING_DEFAULTS = {
  Heading1: { fontSize: 22, bold: true },
  Heading2: { fontSize: 18, bold: true },
  Heading3: { fontSize: 15, bold: true },
  Heading4: { fontSize: 13, bold: true },
  1: { fontSize: 22, bold: true },
  2: { fontSize: 18, bold: true },
  3: { fontSize: 15, bold: true },
};

/** 解析 word/styles.xml，提取样式 ID → {fontSize, bold, color} */
async function parseStylesXml(zip) {
  const styleMap = {};
  const stylesFile = zip.file('word/styles.xml');
  if (!stylesFile) return styleMap;

  const xml = await stylesFile.async('string');
  const styleBlocks = xml.split(/<w:style\s/);

  for (let i = 1; i < styleBlocks.length; i++) {
    const block = styleBlocks[i];
    const idMatch = block.match(/w:styleId="([^"]+)"/);
    if (!idMatch) continue;
    const styleId = idMatch[1];

    const style = {};
    const szMatch = block.match(/<w:sz\s+w:val="(\d+)"/);
    if (szMatch) style.fontSize = parseInt(szMatch[1], 10) / 2;

    if (/<w:b\s*\/?>/.test(block) && !/<w:b\s+w:val="(0|false)"/.test(block)) {
      style.bold = true;
    }

    const colorMatch = block.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/);
    if (colorMatch && colorMatch[1] !== '000000') style.color = colorMatch[1];

    if (Object.keys(style).length > 0) styleMap[styleId] = style;
  }

  return styleMap;
}

/** 解析 word/document.xml，提取带格式的段落 */
async function extractStyledParagraphs(zip, styleMap) {
  const docFile = zip.file('word/document.xml');
  if (!docFile) return [];

  const xml = await docFile.async('string');
  const paragraphs = [];
  const pParts = xml.split(/<w:p[\s>]/);

  for (let i = 1; i < pParts.length; i++) {
    const end = pParts[i].indexOf('</w:p>');
    const pXml = end > -1 ? pParts[i].substring(0, end) : pParts[i];

    // 段落属性
    let alignment = 'left';
    let styleId = null;
    let paraFontSize = null;
    let paraBold = null;
    let paraColor = null;

    const pPrMatch = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    if (pPrMatch) {
      const pPr = pPrMatch[1];
      const jcMatch = pPr.match(/<w:jc\s+w:val="([^"]+)"/);
      if (jcMatch) alignment = jcMatch[1];

      const styleMatch = pPr.match(/<w:pStyle\s+w:val="([^"]+)"/);
      if (styleMatch) styleId = styleMatch[1];

      // 段落级默认 run 属性
      const rPrMatch = pPr.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      if (rPrMatch) {
        const rPr = rPrMatch[1];
        const sz = rPr.match(/<w:sz\s+w:val="(\d+)"/);
        if (sz) paraFontSize = parseInt(sz[1], 10) / 2;
        if (/<w:b\s*\/?>/.test(rPr) && !/<w:b\s+w:val="(0|false)"/.test(rPr)) paraBold = true;
        const col = rPr.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/);
        if (col && col[1] !== '000000') paraColor = col[1];
      }
    }

    // 从样式继承
    const styleDef = styleMap[styleId] || HEADING_DEFAULTS[styleId] || {};
    const defaultFontSize = paraFontSize || styleDef.fontSize || DEFAULT_FONT_SIZE;
    const defaultBold = paraBold != null ? paraBold : (styleDef.bold || false);
    const defaultColor = paraColor || styleDef.color || '262626';

    // 解析 runs
    const runs = [];
    const rParts = pXml.split(/<w:r[\s>]/);

    for (let j = 1; j < rParts.length; j++) {
      const rEnd = rParts[j].indexOf('</w:r>');
      const rXml = rEnd > -1 ? rParts[j].substring(0, rEnd) : rParts[j];

      // 提取文字（包括 tab、break 等特殊元素）
      const texts = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tm;
      while ((tm = tRegex.exec(rXml)) !== null) texts.push(xmlUnescape(tm[1]));
      // 处理制表符
      if (/<w:tab\s*\/>/.test(rXml)) {
        texts.push('    ');
      }
      const text = texts.join('');
      if (!text) continue;

      // run 属性
      let fontSize = defaultFontSize;
      let bold = defaultBold;
      let italic = false;
      let underline = false;
      let color = defaultColor;

      const runRPrMatch = rXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      if (runRPrMatch) {
        const rPr = runRPrMatch[1];
        const sz = rPr.match(/<w:sz\s+w:val="(\d+)"/);
        if (sz) fontSize = parseInt(sz[1], 10) / 2;

        if (/<w:b\s*\/?>/.test(rPr)) {
          bold = !/<w:b\s+w:val="(0|false)"/.test(rPr);
        }
        if (/<w:i\s*\/?>/.test(rPr) && !/<w:i\s+w:val="(0|false)"/.test(rPr)) {
          italic = true;
        }
        if (/<w:u\s/.test(rPr) && !/w:val="none"/.test(rPr)) {
          underline = true;
        }
        const col = rPr.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/);
        if (col) color = col[1] === '000000' ? '262626' : col[1];
      }

      runs.push({ text, fontSize, bold, italic, underline, color });
    }

    // 空段落也要记录（产生空行）
    if (runs.length === 0) {
      runs.push({ text: '', fontSize: defaultFontSize, bold: false, italic: false, underline: false, color: defaultColor });
    }

    paragraphs.push({ runs, alignment, styleId });
  }

  return paragraphs;
}

/** 测量文本宽度 */
function measureText(otFont, text, fontSize) {
  if (!text) return 0;
  try {
    const glyphs = otFont.stringToGlyphs(text);
    let w = 0;
    for (const g of glyphs) w += (g.advanceWidth || 0);
    return w * (fontSize / otFont.unitsPerEm);
  } catch (_) {
    return text.length * fontSize * 0.55;
  }
}

/** 富文本排版 → 按页分组的 LayoutItem[] */
function layoutStyledParagraphs(paragraphs, otFont) {
  const pages = [[]]; // pages[pageIdx] = LayoutItem[]
  let curY = MARGIN; // 从顶部开始（SVG 坐标系）

  function newPage() {
    pages.push([]);
    curY = MARGIN;
  }

  for (const para of paragraphs) {
    // 空段落 → 空行间距
    if (para.runs.length === 1 && !para.runs[0].text) {
      const emptyH = para.runs[0].fontSize * LINE_HEIGHT_FACTOR * 0.6;
      curY += emptyH;
      if (curY > PAGE_H - MARGIN) newPage();
      continue;
    }

    // 将 runs 拆分为字符级段，逐字排版实现自动换行
    const charSegments = []; // [{ch, run}]
    for (const run of para.runs) {
      for (const ch of run.text) {
        charSegments.push({ ch, ...run });
      }
    }

    let lineSegments = []; // 当前行的字符段
    let lineWidth = 0;

    function flushLine() {
      if (lineSegments.length === 0) return;

      // 合并相邻同样式字符为 LayoutItem
      const items = [];
      let cur = { text: lineSegments[0].ch, fontSize: lineSegments[0].fontSize, bold: lineSegments[0].bold, italic: lineSegments[0].italic, underline: lineSegments[0].underline, color: lineSegments[0].color };

      for (let k = 1; k < lineSegments.length; k++) {
        const s = lineSegments[k];
        if (s.fontSize === cur.fontSize && s.bold === cur.bold && s.italic === cur.italic && s.underline === cur.underline && s.color === cur.color) {
          cur.text += s.ch;
        } else {
          items.push(cur);
          cur = { text: s.ch, fontSize: s.fontSize, bold: s.bold, italic: s.italic, underline: s.underline, color: s.color };
        }
      }
      items.push(cur);

      // 计算行高和基线
      let maxFontSize = DEFAULT_FONT_SIZE;
      for (const it of items) {
        if (it.fontSize > maxFontSize) maxFontSize = it.fontSize;
      }
      const lineH = maxFontSize * LINE_HEIGHT_FACTOR;
      const baselineY = curY + maxFontSize * (otFont.ascender / otFont.unitsPerEm);

      if (curY + lineH > PAGE_H - MARGIN) {
        newPage();
        // recalc baseline
        return flushLineOnNewPage(items, maxFontSize);
      }

      // 计算总宽度用于对齐
      let totalW = 0;
      for (const it of items) totalW += measureText(otFont, it.text, it.fontSize);

      let startX = MARGIN;
      if (para.alignment === 'center') startX = MARGIN + (CONTENT_W - totalW) / 2;
      else if (para.alignment === 'right') startX = MARGIN + CONTENT_W - totalW;

      let x = startX;
      const pageIdx = pages.length - 1;
      for (const it of items) {
        const w = measureText(otFont, it.text, it.fontSize);
        pages[pageIdx].push({
          text: it.text, x, y: baselineY,
          fontSize: it.fontSize, bold: it.bold, italic: it.italic,
          underline: it.underline, color: it.color, width: w,
        });
        x += w;
      }

      curY += lineH;
    }

    function flushLineOnNewPage(items, maxFontSize) {
      const lineH = maxFontSize * LINE_HEIGHT_FACTOR;
      const baselineY = curY + maxFontSize * (otFont.ascender / otFont.unitsPerEm);

      let totalW = 0;
      for (const it of items) totalW += measureText(otFont, it.text, it.fontSize);

      let startX = MARGIN;
      if (para.alignment === 'center') startX = MARGIN + (CONTENT_W - totalW) / 2;
      else if (para.alignment === 'right') startX = MARGIN + CONTENT_W - totalW;

      let x = startX;
      const pageIdx = pages.length - 1;
      for (const it of items) {
        const w = measureText(otFont, it.text, it.fontSize);
        pages[pageIdx].push({
          text: it.text, x, y: baselineY,
          fontSize: it.fontSize, bold: it.bold, italic: it.italic,
          underline: it.underline, color: it.color, width: w,
        });
        x += w;
      }
      curY += lineH;
    }

    for (const seg of charSegments) {
      const chW = measureText(otFont, seg.ch, seg.fontSize);
      if (lineWidth + chW > CONTENT_W && lineSegments.length > 0) {
        flushLine();
        lineSegments = [];
        lineWidth = 0;
      }
      lineSegments.push(seg);
      lineWidth += chW;
    }
    flushLine();
    lineSegments = [];
    lineWidth = 0;
    curY += PARA_SPACING;
  }

  return { pageLayouts: pages, pageCount: pages.length };
}

/** XML 特殊字符转义 */
function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

/** 渲染带样式的 SVG → PNG */
async function renderStyledToImages(pageLayouts, pageCount, otFont) {
  await ensureResvg();
  const { Resvg } = require('@resvg/resvg-wasm');

  const SCALE = RENDER_SCALE;
  const svgW = PAGE_W * SCALE;
  const svgH = PAGE_H * SCALE;
  const pageImages = [];

  for (let i = 0; i < pageCount; i++) {
    try {
      const items = pageLayouts[i] || [];
      const svgParts = [];

      for (const item of items) {
        if (!item.text) continue;
        const sx = item.x * SCALE;
        const sy = item.y * SCALE;
        const sFontSize = item.fontSize * SCALE;
        const fill = '#' + (item.color || '262626');

        const p = otFont.getPath(item.text, sx, sy, sFontSize);
        const pathData = p.toPathData();

        if (item.bold) {
          const sw = sFontSize * 0.03;
          svgParts.push('<path d="' + pathData + '" fill="' + fill + '" stroke="' + fill + '" stroke-width="' + sw.toFixed(2) + '" paint-order="stroke"/>');
        } else {
          svgParts.push('<path d="' + pathData + '" fill="' + fill + '"/>');
        }

        // 下划线
        if (item.underline) {
          const ux = sx;
          const uy = sy + sFontSize * 0.15;
          const uw = (item.width || 0) * SCALE;
          const uh = Math.max(1, sFontSize * 0.05);
          svgParts.push('<rect x="' + ux.toFixed(1) + '" y="' + uy.toFixed(1) + '" width="' + uw.toFixed(1) + '" height="' + uh.toFixed(1) + '" fill="' + fill + '"/>');
        }
      }

      const svgString = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgW + '" height="' + svgH
        + '" viewBox="0 0 ' + svgW + ' ' + svgH + '">'
        + '<rect width="100%" height="100%" fill="white"/>'
        + svgParts.join('\n')
        + '</svg>';

      const resvg = new Resvg(svgString, {
        fitTo: { mode: 'width', value: svgW },
      });
      const rendered = resvg.render();
      const pngBuffer = Buffer.from(rendered.asPng());

      const uploadRes = await cloud.uploadFile({
        cloudPath: 'pdf_pages/' + Date.now() + '_p' + (i + 1) + '.png',
        fileContent: pngBuffer,
      });
      pageImages.push(uploadRes.fileID);
    } catch (err) {
      console.error('Styled page ' + (i + 1) + ' render failed:', err.message);
      pageImages.push('');
    }
  }

  return pageImages;
}

/** 生成 PDF（用于合约签署, best-effort 格式） */
async function generateStyledPdf(paragraphs, pageLayouts) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fs = require('fs');
  const path = require('path');
  let cnFontBytes = null;
  try {
    cnFontBytes = fs.readFileSync(path.join(__dirname, 'NotoSansSC-Regular.otf'));
  } catch (_) {}

  const font = cnFontBytes
    ? await pdfDoc.embedFont(cnFontBytes)
    : await pdfDoc.embedFont('Helvetica');

  // 按 pageLayouts 逐页生成
  for (let pi = 0; pi < pageLayouts.length; pi++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const items = pageLayouts[pi] || [];

    for (const item of items) {
      if (!item.text) continue;
      // PDF y 从底部算，layout y 从顶部算
      const pdfY = PAGE_H - item.y;
      const r = parseInt((item.color || '262626').substring(0, 2), 16) / 255;
      const g = parseInt((item.color || '262626').substring(2, 4), 16) / 255;
      const b = parseInt((item.color || '262626').substring(4, 6), 16) / 255;
      const drawOpts = {
        x: item.x,
        y: pdfY,
        size: item.fontSize,
        font,
        color: rgb(r, g, b),
      };
      try {
        page.drawText(item.text, drawOpts);
      } catch (_) {
        // 整段绘制失败时，逐字符尝试，跳过不支持的字符而非丢失整段
        let offsetX = item.x;
        for (const ch of item.text) {
          try {
            page.drawText(ch, { ...drawOpts, x: offsetX });
            offsetX += font.widthOfTextAtSize(ch, item.fontSize);
          } catch (_e) {
            // 该字符不支持，用空格占位保持布局
            try {
              offsetX += font.widthOfTextAtSize(' ', item.fontSize);
            } catch (_e2) {}
          }
        }
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const pdfCloudPath = 'templates/converted_' + Date.now() + '.pdf';
  const uploadRes = await cloud.uploadFile({
    cloudPath: pdfCloudPath,
    fileContent: pdfBuffer,
  });
  return uploadRes.fileID;
}

async function handleDOCX(docxBuffer) {
  const opentype = require('opentype.js');
  const path = require('path');

  // 1. 解压 DOCX
  const zip = await JSZip.loadAsync(docxBuffer);

  // 2. 解析样式
  const styleMap = await parseStylesXml(zip);
  console.log('DOCX styleMap keys:', Object.keys(styleMap).join(', '));

  // 3. 提取富文本段落
  const paragraphs = await extractStyledParagraphs(zip, styleMap);
  console.log('DOCX paragraphs:', paragraphs.length);

  // 4. 加载字体
  const fontPath = path.join(__dirname, 'NotoSansSC-Regular.otf');
  const otFont = opentype.loadSync(fontPath);

  // 5. 排版
  const { pageLayouts, pageCount } = layoutStyledParagraphs(paragraphs, otFont);
  console.log('DOCX layout: pages=' + pageCount);

  const finalPageCount = Math.min(pageCount, MAX_PAGES);
  const pageDimensions = [];
  for (let i = 0; i < finalPageCount; i++) {
    pageDimensions.push({ width: PAGE_W, height: PAGE_H });
  }

  // 6. 生成 PDF
  let pdfCloudFileID = '';
  try {
    pdfCloudFileID = await generateStyledPdf(paragraphs, pageLayouts.slice(0, finalPageCount));
    console.log('DOCX PDF uploaded:', pdfCloudFileID);
  } catch (err) {
    console.error('DOCX PDF generate failed:', err.message);
  }

  // 7. 渲染预览图
  let pageImages = [];
  let renderError = '';
  try {
    pageImages = await renderStyledToImages(pageLayouts.slice(0, finalPageCount), finalPageCount, otFont);
  } catch (err) {
    console.error('DOCX render failed:', err.message);
    renderError = err.message || '渲染失败';
  }

  return {
    code: 0,
    data: {
      pageCount: finalPageCount,
      pageDimensions,
      pageImages,
      renderError,
      pdfCloudFileID,
    },
  };
}
