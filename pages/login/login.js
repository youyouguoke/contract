const { showToast } = require('../../utils/util');
const app = getApp();

Page({
  async wxLogin() {
    wx.showLoading({ title: '登录中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {},
      });
      console.log('[wxLogin] result code:', res.result ? res.result.code : 'null');
      console.log('[wxLogin] result data.name:', res.result && res.result.data ? res.result.data.name : 'null');
      if (res.result && res.result.code === 0) {
        app.globalData.userInfo = res.result.data;
        app.globalData.isLoggedIn = true;
        wx.hideLoading();
        showToast('登录成功');
        setTimeout(() => wx.navigateBack(), 1000);
      } else {
        wx.hideLoading();
        showToast('登录失败');
      }
    } catch (e) {
      wx.hideLoading();
      console.error('[wxLogin] EXCEPTION:', e.message);
      showToast('微信登录失败');
    }
  },
});
