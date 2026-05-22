const { getContracts, getSignatures, getStamps, db } = require('../../utils/cloud-db');
const { showToast } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    isLoggedIn: false,
    userInfo: {},
    avatarText: '',
    stats: { initiated: 0, received: 0, completed: 0 },
    signatureCount: 0,
    stampCount: 0,
    showEditor: false,
    editNickName: '',
    editAvatar: '',
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    const isLoggedIn = app.isLoggedIn();
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      isLoggedIn,
      userInfo,
      avatarText: (userInfo.name || '?')[0],
    });
    if (isLoggedIn) this.loadData();
  },

  async loadData() {
    try {
      const [signatures, stamps] = await Promise.all([
        getSignatures(),
        getStamps(),
      ]);
      this.setData({
        signatureCount: signatures.length,
        stampCount: stamps.length,
      });
      this.loadStats();
    } catch (e) {
      console.error('Load profile data failed', e);
    }
  },

  async loadStats() {
    try {
      const allContracts = await getContracts();
      this.setData({
        stats: {
          initiated: allContracts.length,
          received: 0,
          completed: allContracts.filter(c => c.status === 'completed').length,
        },
      });
    } catch (e) {
      console.error('Load stats failed', e);
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goPage(e) {
    const { url } = e.currentTarget.dataset;
    if (url === '/pages/contracts/contracts') {
      wx.switchTab({ url });
    } else {
      wx.navigateTo({ url });
    }
  },

  showProfileEditor() {
    const userInfo = this.data.userInfo;
    this.setData({
      showEditor: true,
      editNickName: userInfo.name || '',
      editAvatar: userInfo.avatar || '',
    });
  },

  hideProfileEditor() {
    this.setData({ showEditor: false });
  },

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        this.setData({ editAvatar: tempPath });
      },
    });
  },

  onEditNickInput(e) {
    this.setData({ editNickName: e.detail.value });
  },

  async saveProfile() {
    const { editNickName, editAvatar, userInfo } = this.data;
    if (!editNickName || !editNickName.trim()) {
      showToast('请输入昵称');
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });

    try {
      let avatarFileID = userInfo.avatar || '';

      // 如果选了新头像（本地临时路径），上传到云存储
      if (editAvatar && editAvatar !== userInfo.avatar && !editAvatar.startsWith('cloud://')) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: 'avatars/' + (userInfo._id || Date.now()) + '_' + Date.now() + '.jpg',
          filePath: editAvatar,
        });
        avatarFileID = uploadRes.fileID;
      }

      // 更新数据库
      const updateData = { name: editNickName.trim(), avatar: avatarFileID };
      await db.collection('users').doc(userInfo._id).update({ data: updateData });

      // 更新全局 & 页面
      app.globalData.userInfo.name = editNickName.trim();
      app.globalData.userInfo.avatar = avatarFileID;

      this.setData({
        showEditor: false,
        userInfo: app.globalData.userInfo,
        avatarText: editNickName.trim()[0],
      });

      wx.hideLoading();
      showToast('保存成功');
    } catch (e) {
      wx.hideLoading();
      console.error('Save profile failed:', e);
      showToast('保存失败');
    }
  },

  showAbout() {
    wx.showModal({
      title: '墨舟秒签',
      content: '专注于为中小机构及个体经营者提供真正免费、即开即用的电子签约解决方案。\n\n所有信息保存在微信官方服务器，运营者无权查看，请您放心使用。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  logout() {
    wx.showModal({
      title: '确认退出',
      content: '退出登录后需要重新登录才能使用签约功能',
      success: (res) => {
        if (res.confirm) {
          app.logout();
          this.setData({ isLoggedIn: false, userInfo: {} });
          showToast('已退出登录');
        }
      },
    });
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
