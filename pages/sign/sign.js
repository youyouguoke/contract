const { getContractById, updateContract, uploadImage, getSignatures, getStamps } = require('../../utils/cloud-db');
const { showToast } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    contractId: '',
    contractTitle: '',
    contract: null,
    hasSigned: false,
    agreed: false,
    canSubmit: false,
    fromShare: false,
    // 签名方式：draw=手写, select=选择已有
    signMode: 'draw',
    savedSignatures: [],
    selectedSignature: null,
    // 印章
    savedStamps: [],
    selectedStamp: null,
    // 合约内容字段
    contractFields: [],
    // 签署方信息（对方填写模式）
    needSignerInfo: false,
    signerInfo: { name: '', phone: '', idType: '', idNumber: '', idTypeIndex: 0 },
    idTypeOptions: ['身份证', '护照', '营业执照', '其他'],
    signerIndex: -1,
  },

  canvas: null,
  ctx: null,
  isDrawing: false,
  lastX: 0,
  lastY: 0,

  async onLoad(options) {
    const { contractId, from } = options;
    try {
      await app.loginPromise;
      const [contract, savedSignatures, savedStamps] = await Promise.all([
        getContractById(contractId),
        getSignatures(),
        getStamps(),
      ]);

      // 解析合约内容字段
      const fields = contract && contract.formData && contract.formData.fields || {};
      const contractFields = Object.keys(fields)
        .filter(key => fields[key] !== undefined && fields[key] !== '')
        .map(key => ({ label: key, value: fields[key] }));

      this.setData({
        contractId,
        contractTitle: contract ? contract.title : '合约签署',
        contract,
        fromShare: from === 'share',
        savedSignatures,
        savedStamps,
        contractFields,
      });

      // 检查当前签署方是否需要自行填写信息
      if (contract && contract.signers) {
        const pendingIdx = contract.signers.findIndex(s => s.status === 'pending');
        if (pendingIdx > -1) {
          const signer = contract.signers[pendingIdx];
          if (signer.fillMode === 'signer' && !signer.name) {
            this.setData({
              needSignerInfo: true,
              signerIndex: pendingIdx,
              signerInfo: {
                name: signer.name || '',
                phone: signer.phone || '',
                idType: signer.idType || '',
                idNumber: signer.idNumber || '',
                idTypeIndex: signer.idType ? this.data.idTypeOptions.indexOf(signer.idType) : 0,
              },
            });
          }
        }
      }
    } catch (e) {
      console.error('Load contract failed', e);
    }
  },

  onReady() {
    this.initCanvas();
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
    this.isDrawing = true;
    this.lastX = touch.x;
    this.lastY = touch.y;

    this.ctx.beginPath();
    this.ctx.moveTo(touch.x, touch.y);
  },

  onTouchMove(e) {
    if (!this.isDrawing) return;
    const touch = e.touches[0];

    this.ctx.lineTo(touch.x, touch.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(touch.x, touch.y);

    this.lastX = touch.x;
    this.lastY = touch.y;

    if (!this.data.hasSigned) {
      this.setData({ hasSigned: true });
      this.updateCanSubmit();
    }
  },

  onTouchEnd() {
    this.isDrawing = false;
  },

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    const dpr = wx.getWindowInfo().pixelRatio;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    this.setData({ hasSigned: false });
    this.updateCanSubmit();
  },

  // 切换签名方式
  switchSignMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'draw') {
      this.setData({ signMode: 'draw', selectedSignature: null });
    } else {
      this.setData({ signMode: 'select', hasSigned: false });
      this.clearCanvas();
    }
    this.updateCanSubmit();
  },

  // 选择已有签名
  selectSignature(e) {
    const idx = e.currentTarget.dataset.index;
    const sig = this.data.savedSignatures[idx];
    this.setData({ selectedSignature: sig });
    this.updateCanSubmit();
  },

  // 选择/取消印章（可选）
  selectStamp(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx < 0) {
      this.setData({ selectedStamp: null });
      return;
    }
    const stamp = this.data.savedStamps[idx];
    // 点击已选中的印章则取消选择
    if (this.data.selectedStamp && this.data.selectedStamp.id === stamp.id) {
      this.setData({ selectedStamp: null });
    } else {
      this.setData({ selectedStamp: stamp });
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
    this.updateCanSubmit();
  },

  onSignerInfoInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`signerInfo.${field}`]: e.detail.value });
    this.updateCanSubmit();
  },

  onSignerIdTypePick(e) {
    const typeIndex = e.detail.value;
    this.setData({
      'signerInfo.idType': this.data.idTypeOptions[typeIndex],
      'signerInfo.idTypeIndex': typeIndex,
    });
  },

  updateCanSubmit() {
    const { signMode, hasSigned, selectedSignature, agreed, needSignerInfo, signerInfo } = this.data;
    const signed = signMode === 'draw' ? hasSigned : !!selectedSignature;
    let infoComplete = true;
    if (needSignerInfo) {
      infoComplete = !!(signerInfo.name && signerInfo.name.trim() && signerInfo.phone && /^1\d{10}$/.test(signerInfo.phone));
    }
    this.setData({ canSubmit: signed && agreed && infoComplete });
  },

  rejectSign() {
    wx.showModal({
      title: '确认拒绝',
      content: '拒绝后将无法再签署此合约',
      confirmColor: '#FA3534',
      success: async (res) => {
        if (res.confirm) {
          try {
            await updateContract(this.data.contractId, {
              status: 'rejected',
              updatedAt: new Date().toISOString(),
            });
            showToast('已拒绝签署');
            setTimeout(() => wx.navigateBack(), 1500);
          } catch (e) {
            showToast('操作失败');
          }
        }
      },
    });
  },

  confirmSign() {
    if (!this.data.canSubmit) return;

    wx.showModal({
      title: '确认签署',
      content: '签署后将具有法律效力，确认签署？',
      success: (res) => {
        if (res.confirm) {
          this.submitSignature();
        }
      },
    });
  },

  async submitSignature() {
    wx.showLoading({ title: '签署中...', mask: true });

    try {
      let signatureFileID;

      if (this.data.signMode === 'select' && this.data.selectedSignature) {
        // 使用已有签名的 cloud fileID
        signatureFileID = this.data.selectedSignature.image;
      } else {
        // 手写签名导出并上传
        const tempRes = await new Promise((resolve, reject) => {
          wx.canvasToTempFilePath({
            canvas: this.canvas,
            success: resolve,
            fail: reject,
          });
        });
        signatureFileID = await uploadImage(
          tempRes.tempFilePath,
          `sign-records/${this.data.contractId}/${Date.now()}.png`
        );
      }

      // Update contract signers
      const contract = this.data.contract;
      const signers = [...contract.signers];
      const pendingIdx = signers.findIndex(s => s.status === 'pending');
      if (pendingIdx > -1) {
        signers[pendingIdx].status = 'signed';
        signers[pendingIdx].signedAt = new Date().toISOString();
        signers[pendingIdx].signatureFileID = signatureFileID;
        // 印章（可选）
        if (this.data.selectedStamp) {
          signers[pendingIdx].stampFileID = this.data.selectedStamp.image;
        }
        // 签署方自行填写的信息
        if (this.data.needSignerInfo) {
          const info = this.data.signerInfo;
          signers[pendingIdx].name = info.name;
          signers[pendingIdx].phone = info.phone;
          signers[pendingIdx].idType = info.idType || '';
          signers[pendingIdx].idNumber = info.idNumber || '';
        }
      }
      const allSigned = signers.every(s => s.status === 'signed');

      await updateContract(this.data.contractId, {
        signers,
        status: allSigned ? 'completed' : 'signing',
        updatedAt: new Date().toISOString(),
      });

      wx.hideLoading();
      wx.showToast({ title: '签署成功', icon: 'success', duration: 2000 });
      setTimeout(() => {
        if (this.data.fromShare) {
          wx.reLaunch({ url: '/pages/index/index' });
        } else {
          wx.navigateBack({ delta: 2 });
        }
      }, 2000);
    } catch (e) {
      wx.hideLoading();
      showToast('签署失败，请重试');
    }
  },

  onShareAppMessage() {
    const { contract, contractId } = this.data;
    return {
      title: `【签约邀请】${contract ? contract.title : '合约签署'}`,
      path: `/pages/contract-detail/contract-detail?id=${contractId}&from=share`,
    };
  },
});
