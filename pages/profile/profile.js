const { callCloudApi, wxLogin, mapUser } = require('../../utils/cloudApi');

Page({
  data: {
    userInfo: null,
    hasLogin: false,
    loginLoading: false
  },

  onShow() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.getUserInfo();
    } else {
      this.setData({
        userInfo: null,
        hasLogin: false
      });
    }
  },

  async getUserInfo() {
    try {
      const res = await callCloudApi('getUserInfo');
      const userInfo = mapUser(res);
      wx.setStorageSync('userInfo', userInfo);
      this.setData({
        userInfo,
        hasLogin: true
      });
    } catch (err) {
      if (err && (err.code === 401 || (err.message && err.message.includes('token')))) {
        wx.removeStorageSync('token');
        wx.removeStorageSync('userInfo');
        wx.removeStorageSync('openid');
        this.setData({
          userInfo: null,
          hasLogin: false
        });
      }
    }
  },

  handleLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });

    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: async (profileRes) => {
        try {
          const userInfo = profileRes.userInfo;
          const loginRes = await wxLogin({
            nickName: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl
          });
          await callCloudApi('updateUserInfo', {
            nickname: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl
          });
          const mappedUser = mapUser(loginRes.userInfo);
          wx.setStorageSync('userInfo', mappedUser);
          this.setData({
            userInfo: mappedUser,
            hasLogin: true,
            loginLoading: false
          });
          wx.showToast({ title: '登录成功', icon: 'success' });
        } catch (err) {
          this.setData({ loginLoading: false });
          wx.showToast({ title: err.message || '登录失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loginLoading: false });
        wx.showToast({ title: '授权失败', icon: 'none' });
      }
    });
  },

  goToOrder() {
    if (!this.data.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/order/order'
    });
  },

  goToFavorite() {
    if (!this.data.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/favorite/favorite'
    });
  },

  goToAddress() {
    if (!this.data.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/address/address'
    });
  },

  goToDeposit() {
    if (!this.data.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/deposit/deposit'
    });
  },

  goToHelp() {
    wx.navigateTo({
      url: '/packageUser/pages/help/help'
    });
  },

  goToCustomerService() {
    wx.navigateTo({
      url: '/packageUser/pages/customer-service/customer-service'
    });
  },

  goToAbout() {
    wx.navigateTo({
      url: '/packageUser/pages/about/about'
    });
  }
});
