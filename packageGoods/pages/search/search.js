const { callCloudApi, mapClothingList, resolveImagesInList } = require('../../../utils/cloudApi');

Page({
  data: {
    keyword: '',
    results: [],
    loading: true
  },

  onLoad(options) {
    const kw = decodeURIComponent(options.keyword || '');
    this.setData({ keyword: kw });
    this.executeSearch(kw);
  },

  executeSearch(kw) {
    this.setData({ loading: true });
    callCloudApi('getClothingList', { keyword: kw })
      .then(async res => {
        const list = mapClothingList(res && res.list ? res.list : res);
        const imageList = await resolveImagesInList(list, 'main_image');
        this.setData({
          results: imageList || [],
          loading: false
        });
      })
      .catch(err => {
        console.error(err);
        this.setData({ loading: false });
      });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  }
});
