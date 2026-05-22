const { getContractsByBatchId } = require('../../utils/cloud-db');
const { getStatusInfo, showToast } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    batchId: '',
    contracts: [],
    title: '',
    sharedMap: {},
  },

  _shareContractId: '',
  _shareTitle: '',

  async onLoad(options) {
    const { batchId, title } = options;
    this.setData({ batchId, title: decodeURIComponent(title || '签约邀请') });

    await app.loginPromise;
    await this.loadContracts(batchId);
  },

  async loadContracts(batchId) {
    try {
      const contracts = await getContractsByBatchId(batchId);
      const list = contracts.map(c => {
        const signer = c.signers && c.signers[1] ? c.signers[1] : {};
        const statusInfo = getStatusInfo(c.status);
        return {
          id: c._id || c.id,
          title: c.title,
          signerName: signer.name || (signer.fillMode === 'signer' ? '待对方填写' : '未知'),
          signerPhone: signer.phone || '',
          status: c.status,
          statusText: statusInfo.text,
          statusColor: statusInfo.color,
          fillMode: signer.fillMode || 'initiator',
        };
      });
      this.setData({ contracts: list });
    } catch (e) {
      console.error('Load batch contracts failed', e);
      showToast('加载失败');
    }
  },

  onShareTap(e) {
    const { id, title } = e.currentTarget.dataset;
    this._shareContractId = id;
    this._shareTitle = title;
  },

  onShareAppMessage(res) {
    if (res.from === 'button' && res.target && res.target.dataset) {
      const { id, title } = res.target.dataset;
      return {
        title: `【签约邀请】${title}`,
        path: `/pages/contract-detail/contract-detail?id=${id}&from=share`,
      };
    }
    // 默认分享
    return {
      title: `【签约邀请】${this.data.title}`,
      path: `/pages/contracts/contracts`,
    };
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/contract-detail/contract-detail?id=${id}` });
  },

  goContracts() {
    wx.switchTab({ url: '/pages/contracts/contracts' });
  },
});
