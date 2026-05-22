const { getContracts } = require('../../utils/cloud-db');
const app = getApp();

Page({
  data: {
    greeting: '',
    userInfo: {},
    stats: { total: 0, pending: 0, signing: 0, completed: 0 },
    recentContracts: [],
  },

  onLoad() {
    this.setGreeting();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.setData({ userInfo: app.globalData.userInfo || { name: '访客' } });
    this.loadContracts();
  },

  setGreeting() {
    const hour = new Date().getHours();
    let greeting = '晚上好';
    if (hour < 6) greeting = '凌晨好';
    else if (hour < 12) greeting = '上午好';
    else if (hour < 14) greeting = '中午好';
    else if (hour < 18) greeting = '下午好';
    this.setData({ greeting });
  },

  async loadContracts() {
    try {
      await app.loginPromise;
      const allContracts = await getContracts();

      const total = allContracts.length;
      const pending = allContracts.filter(c => c.status === 'pending').length;
      const signing = allContracts.filter(c => c.status === 'signing').length;
      const completed = allContracts.filter(c => c.status === 'completed').length;

      const sorted = [...allContracts].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      this.setData({
        stats: { total, pending, signing, completed },
        recentContracts: sorted.slice(0, 5),
      });
    } catch (e) {
      console.error('Load contracts failed', e);
    }
  },

  createContract() {
    app.requireLogin(() => {
      wx.navigateTo({ url: '/pages/templates/templates' });
    });
  },

  goTemplates() {
    app.requireLogin(() => {
      wx.navigateTo({ url: '/pages/templates/templates' });
    });
  },

  goContracts(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.switchTab({
      url: '/pages/contracts/contracts',
      success() {
        const page = getCurrentPages().pop();
        if (page) page.setFilter(status);
      },
    });
  },

  onContractTap(e) {
    const { id } = e.detail;
    wx.navigateTo({ url: `/pages/contract-detail/contract-detail?id=${id}` });
  },

  onShareAppMessage() {
    return {
      title: '秒签 - 免费电子签约小程序',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '秒签 - 免费电子签约小程序',
    };
  },
});
