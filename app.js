App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
  },

  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-6gp5z6zac9f4f427',
      traceUser: true,
    });
    this.loginPromise = this.checkLogin();
  },

  async checkLogin() {
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      if (res.result && res.result.code === 0) {
        this.globalData.userInfo = res.result.data;
        this.globalData.isLoggedIn = true;
      }
    } catch (e) {
      console.error('Cloud login failed', e);
    }
  },

  isLoggedIn() {
    return this.globalData.isLoggedIn;
  },

  async requireLogin(callback) {
    await this.loginPromise;
    if (this.isLoggedIn()) {
      callback && callback();
    } else {
      wx.navigateTo({ url: '/pages/login/login' });
    }
  },

  logout() {
    this.globalData.isLoggedIn = false;
    this.globalData.userInfo = null;
  },
});
