Page({
  data: {
    servicePhone: '400-123-4567',
    serviceWechat: 'yunshangweizu',
    workTime: '每日 9:00 - 21:00'
  },

  callPhone() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone,
      fail: () => {}
    });
  },

  copyWechat() {
    wx.setClipboardData({
      data: this.data.serviceWechat,
      success: () => {
        wx.showToast({ title: '微信号已复制', icon: 'success' });
      }
    });
  },

  goHelp() {
    wx.navigateTo({ url: '/packageUser/pages/help/help' });
  }
});
