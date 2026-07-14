App({
  globalData: {
    targetCategoryId: null,
    userInfo: null,
    token: null
  },
  onLaunch() {
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    if (token) {
      this.globalData.token = token;
    }
    if (userInfo) {
      this.globalData.userInfo = userInfo;
    }

    wx.onError((msg) => {
      console.error('App onError:', msg);
    });

    if (wx.onUnhandledRejection) {
      wx.onUnhandledRejection((res) => {
        console.error('App unhandledRejection:', res.reason, res.errMsg);
      });
    }
  }
})
