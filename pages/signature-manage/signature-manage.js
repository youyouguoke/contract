const { getSignatures, addSignature, removeSignature, updateSignature, uploadImage, deleteImage } = require('../../utils/cloud-db');
const { showToast } = require('../../utils/util');

Page({
  data: {
    signatures: [],
    hasDrew: false,
    sigName: '',
  },

  canvas: null,
  ctx: null,

  onShow() {
    this.loadSignatures();
  },

  onReady() {
    this.initCanvas();
  },

  async loadSignatures() {
    try {
      const signatures = await getSignatures();
      this.setData({ signatures });
    } catch (e) {
      console.error('Load signatures failed', e);
    }
  },

  initCanvas() {
    const query = this.createSelectorQuery();
    query.select('#signCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        const dpr = wx.getWindowInfo().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        this.canvas = canvas;
        this.ctx = ctx;
      });
  },

  onTouchStart(e) {
    const touch = e.touches[0];
    this.ctx.beginPath();
    this.ctx.moveTo(touch.x, touch.y);
  },

  onTouchMove(e) {
    const touch = e.touches[0];
    this.ctx.lineTo(touch.x, touch.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(touch.x, touch.y);

    if (!this.data.hasDrew) {
      this.setData({ hasDrew: true });
    }
  },

  onTouchEnd() {},

  onSigNameInput(e) {
    this.setData({ sigName: e.detail.value });
  },

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    const dpr = wx.getWindowInfo().pixelRatio;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    this.setData({ hasDrew: false });
  },

  saveSignature() {
    if (!this.data.hasDrew) {
      showToast('请先手写签名');
      return;
    }

    const name = this.data.sigName.trim();

    wx.canvasToTempFilePath({
      canvas: this.canvas,
      success: async (res) => {
        try {
          const cloudPath = `signatures/${Date.now()}.png`;
          const fileID = await uploadImage(res.tempFilePath, cloudPath);

          await addSignature({
            name: name || '签名' + (this.data.signatures.length + 1),
            image: fileID,
            createdAt: new Date().toISOString(),
            isDefault: this.data.signatures.length === 0,
          });

          this.clearCanvas();
          this.setData({ sigName: '' });
          this.loadSignatures();
          showToast('签名已保存');
        } catch (e) {
          showToast('签名保存失败');
        }
      },
      fail() {
        showToast('签名保存失败');
      },
    });
  },

  deleteSignature(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除签名',
      content: '确定删除此签名？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const sig = this.data.signatures.find(s => s.id === id);
            if (sig && sig.image && sig.image.startsWith('cloud://')) {
              await deleteImage(sig.image);
            }
            await removeSignature(id);
            this.loadSignatures();
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
      for (const s of this.data.signatures) {
        await updateSignature(s.id, { isDefault: s.id === id });
      }
      this.loadSignatures();
      showToast('已设为默认');
    } catch (e) {
      showToast('设置失败');
    }
  },
});
