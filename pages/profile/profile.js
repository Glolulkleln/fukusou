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

  async onGetPhone(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }
    try {
      const res = await callCloudApi('bindPhone', {
        encryptedData: e.detail.encryptedData,
        iv: e.detail.iv
      });
      wx.showToast({ title: '手机号绑定成功', icon: 'success' });
      this.getUserInfo();
    } catch (err) {
      // 开发/演示模式（未配置微信凭证）下，降级为手动输入手机号绑定
      if (err && (err.code === 400 || (err.message && err.message.includes('解密')))) {
        wx.showModal({
          title: '绑定手机号',
          editable: true,
          placeholderText: '请输入手机号',
          success: async (m) => {
            if (m.confirm && m.content) {
              try {
                await callCloudApi('bindPhone', { phone: m.content.trim() });
                wx.showToast({ title: '手机号绑定成功', icon: 'success' });
                this.getUserInfo();
              } catch (e2) {
                wx.showToast({ title: (e2 && e2.message) || '绑定失败', icon: 'none' });
              }
            }
          }
        });
      } else {
        wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' });
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
