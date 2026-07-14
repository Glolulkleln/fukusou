Page({
  data: {
    version: '1.0.0'
  },

  onLoad() {
    try {
      const info = wx.getAccountInfoSync();
      if (info && info.miniProgram && info.miniProgram.version) {
        this.setData({ version: info.miniProgram.version });
      }
    } catch (e) {
      // 开发版/体验版 getAccountInfoSync 可能返回空版本，保留默认值
    }
  }
});
