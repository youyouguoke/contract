const { getStamps, addStamp, removeStamp, updateStamp, uploadImage, deleteImage } = require('../../utils/cloud-db');
const { showToast } = require('../../utils/util');

const PURPOSE_LIST = ['合同专用章', '财务专用章', '公章', '发票专用章'];

Page({
  data: {
    stamps: [],
    companyName: '',
    stampPurpose: '',
    stampCode: '',
    uploadedImage: '',
    showCreator: false,
    generatedPreview: '',
    purposeList: PURPOSE_LIST,
  },

  stampCanvas: null,
  stampCtx: null,

  onShow() {
    this.loadStamps();
  },

  onReady() {
    this.initStampCanvas();
  },

  async loadStamps() {
    try {
      const stamps = await getStamps();
      this.setData({ stamps });
    } catch (e) {
      console.error('Load stamps failed', e);
    }
  },

  initStampCanvas() {
    const query = this.createSelectorQuery();
    query.select('#stampCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        canvas.width = 500;
        canvas.height = 500;
        this.stampCanvas = canvas;
        this.stampCtx = canvas.getContext('2d');
      });
  },

  toggleCreator() {
    const show = !this.data.showCreator;
    this.setData({
      showCreator: show,
      companyName: '',
      stampPurpose: '',
      stampCode: '',
      uploadedImage: '',
      generatedPreview: '',
    });
    if (show) {
      setTimeout(() => this.initStampCanvas(), 200);
    }
  },

  onNameInput(e) {
    this.setData({ companyName: e.detail.value });
    this.refreshPreview();
  },

  onPurposeTap(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ stampPurpose: this.data.stampPurpose === val ? '' : val });
    this.refreshPreview();
  },

  onCodeInput(e) {
    this.setData({ stampCode: e.detail.value });
    this.refreshPreview();
  },

  refreshPreview() {
    if (!this.data.uploadedImage && this.data.companyName.trim()) {
      this.drawStampPreview();
    }
  },

  drawStampPreview() {
    const { companyName, stampPurpose, stampCode } = this.data;
    const name = companyName.trim();
    if (!name || !this.stampCtx) return;

    const ctx = this.stampCtx;
    const size = 500;
    const cx = size / 2;
    const cy = size / 2;
    const R = 220;
    const color = '#C32A2A';

    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.stroke();

    const showPurposeText = stampPurpose && stampPurpose !== '公章';

    const starCy = showPurposeText ? cy - 40 : cy;
    const starOuter = 88;
    const starInner = 42;
    this.drawStar(ctx, cx, starCy, starOuter, starInner, color);

    const chars = name.split('');
    const textR = R - 36;
    const charAngle = 0.28;
    const totalAngle = Math.min(chars.length * charAngle, Math.PI * 1.45);
    const startAngle = -Math.PI / 2 - totalAngle / 2;
    const step = totalAngle / Math.max(chars.length - 1, 1);

    ctx.save();
    ctx.fillStyle = color;
    const baseFontSize = 48;
    const fontSize = chars.length <= 8 ? baseFontSize : chars.length <= 12 ? baseFontSize - 6 : baseFontSize - 10;
    ctx.font = `bold ${fontSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < chars.length; i++) {
      const angle = chars.length === 1
        ? -Math.PI / 2
        : startAngle + step * i;
      const x = cx + textR * Math.cos(angle);
      const y = cy + textR * Math.sin(angle);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    if (showPurposeText) {
      ctx.save();
      ctx.fillStyle = color;
      const purposeFontSize = stampPurpose.length <= 5 ? 34 : 28;
      ctx.font = `bold ${purposeFontSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(stampPurpose, cx, starCy + 90);
      ctx.restore();
    }

    if (stampCode.trim()) {
      const code = stampCode.trim();
      const codeChars = code.split('');
      const codeR = R - 34;
      const codeCharAngle = 0.16;
      const codeTotalAngle = Math.min(codeChars.length * codeCharAngle, Math.PI * 0.7);
      const codeStartAngle = Math.PI / 2 + codeTotalAngle / 2;
      const codeStep = codeTotalAngle / Math.max(codeChars.length - 1, 1);

      ctx.save();
      ctx.fillStyle = color;
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < codeChars.length; i++) {
        const angle = codeChars.length === 1
          ? Math.PI / 2
          : codeStartAngle - codeStep * i;
        const x = cx + codeR * Math.cos(angle);
        const y = cy + codeR * Math.sin(angle);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle - Math.PI / 2);
        ctx.fillText(codeChars[i], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas: this.stampCanvas,
        success: (res) => {
          this.setData({ generatedPreview: res.tempFilePath });
        },
      });
    }, 100);
  },

  drawStar(ctx, cx, cy, outerR, innerR, color) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const outerAngle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const innerAngle = outerAngle + Math.PI / 5;
      const ox = cx + outerR * Math.cos(outerAngle);
      const oy = cy + outerR * Math.sin(outerAngle);
      const ix = cx + innerR * Math.cos(innerAngle);
      const iy = cy + innerR * Math.sin(innerAngle);
      if (i === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  uploadLocalImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        this.setData({ uploadedImage: tempPath, generatedPreview: '' });
      },
    });
  },

  removeImage() {
    this.setData({ uploadedImage: '' });
    if (this.data.companyName.trim()) {
      setTimeout(() => this.drawStampPreview(), 200);
    }
  },

  generateStamp() {
    const name = this.data.companyName.trim();

    if (!name) {
      showToast('请输入单位名称');
      return;
    }
    if (name.length > 16) {
      showToast('名称最多16个字');
      return;
    }

    if (!this.data.uploadedImage && !this.data.generatedPreview) {
      this.drawStampPreview();
      setTimeout(() => this.doSaveStamp(), 500);
      return;
    }

    this.doSaveStamp();
  },

  async doSaveStamp() {
    const { uploadedImage, companyName, stampPurpose, stampCode, generatedPreview } = this.data;
    const name = companyName.trim();

    try {
      let fileID;
      const imagePath = uploadedImage || generatedPreview;
      if (imagePath) {
        const cloudPath = `stamps/${Date.now()}.png`;
        fileID = await uploadImage(imagePath, cloudPath);
      }

      const displayName = stampPurpose ? name + ' - ' + stampPurpose : name;
      await addStamp({
        type: uploadedImage ? 'uploaded' : 'generated',
        image: fileID || '',
        companyName: name,
        displayName: displayName,
        stampPurpose: stampPurpose,
        stampCode: stampCode.trim(),
        createdAt: new Date().toISOString(),
        isDefault: this.data.stamps.length === 0,
      });

      this.setData({
        showCreator: false,
        companyName: '',
        stampPurpose: '',
        stampCode: '',
        uploadedImage: '',
        generatedPreview: '',
      });
      this.loadStamps();
      showToast('印章已保存');
    } catch (e) {
      showToast('印章保存失败');
    }
  },

  previewStamp(e) {
    const { id } = e.currentTarget.dataset;
    const stamp = this.data.stamps.find(s => s.id === id);
    if (stamp && stamp.image) {
      wx.previewImage({
        current: stamp.image,
        urls: [stamp.image],
      });
    }
  },

  deleteStamp(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除印章',
      content: '确定删除此印章？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const stamp = this.data.stamps.find(s => s.id === id);
            if (stamp && stamp.image && stamp.image.startsWith('cloud://')) {
              await deleteImage(stamp.image);
            }
            await removeStamp(id);
            this.loadStamps();
            showToast('已删除');
          } catch (e) {
            showToast('删除失败');
          }
        }
      },
    });
  },

  async setDefault(e) {
    const { id } = e.currentTarget.dataset;
    try {
      for (const s of this.data.stamps) {
        await updateStamp(s.id, { isDefault: s.id === id });
      }
      this.loadStamps();
      showToast('已设为默认');
    } catch (e) {
      showToast('设置失败');
    }
  },
});
