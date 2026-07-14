const { callCloudApi, mapFavoriteList, resolveImagesInList } = require('../../../utils/cloudApi');

Page({
  data: {
    favorites: [],
    loading: true,
    noMore: true
  },

  onShow() {
    this.getFavorites();
  },

  getFavorites() {
    this.setData({ loading: true });
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
      return;
    }

    callCloudApi('getFavorites')
      .then(async res => {
        const list = mapFavoriteList(res && res.list ? res.list : res);
        const imageList = await resolveImagesInList(list, 'main_image');
        this.setData({
          favorites: imageList || [],
          loading: false
        });
        wx.stopPullDownRefresh();
      })
      .catch(err => {
        console.error(err);
        this.setData({ loading: false });
        wx.stopPullDownRefresh();
      });
  },

  onPullDownRefresh() {
    this.getFavorites();
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  }
});
