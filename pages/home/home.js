const { callCloudApi, mapBannerList, mapCategoryList, mapClothingList, resolveImagesInList } = require('../../utils/cloudApi');

Page({
  data: {
    bannerList: [],
    categoryList: [],
    clothingList: [],
    recentList: [],
    loading: true
  },

  onLoad() {
    this.loadAllData();
    this.loadRecent();
  },

  loadRecent() {
    try {
      const list = wx.getStorageSync('recentViews') || [];
      resolveImagesInList(list, 'main_image').then(resolved => {
        this.setData({ recentList: resolved || [] });
      }).catch(() => this.setData({ recentList: [] }));
    } catch (e) {
      this.setData({ recentList: [] });
    }
  },

  loadAllData() {
    this.setData({ loading: true });
    Promise.all([
      this.getBanners(),
      this.getCategories(),
      this.getRecommendClothing()
    ]).then(() => {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }).catch(() => {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    });
  },

  getBanners() {
    return callCloudApi('getBanners')
      .then(res => {
        this.setData({ bannerList: mapBannerList(res || []) });
      })
      .catch(err => console.error('getBanners error:', err));
  },

  getCategories() {
    return callCloudApi('getCategories')
      .then(res => {
        this.setData({ categoryList: mapCategoryList(res || []) });
      })
      .catch(err => console.error('getCategories error:', err));
  },

  getRecommendClothing() {
    return callCloudApi('getClothingList')
      .then(async res => {
        const list = mapClothingList(res && res.list ? res.list : res);
        const imageList = await resolveImagesInList(list, 'main_image');
        this.setData({ clothingList: imageList || [] });
      })
      .catch(err => console.error('getRecommendClothing error:', err));
  },

  onPullDownRefresh() {
    this.loadAllData();
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  },

  onSearchConfirm(e) {
    const val = e.detail.value;
    if (!val.trim()) {
      return;
    }
    wx.navigateTo({
      url: `/packageGoods/pages/search/search?keyword=${encodeURIComponent(val)}`
    });
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    app.globalData.targetCategoryId = id;
    wx.switchTab({
      url: '/pages/category/category'
    });
  },

  onBannerTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  },

  onShareAppMessage() {
    return {
      title: '云裳微租 - 校园服装租赁，让每一次出场都恰到好处',
      path: '/pages/home/home'
    };
  }
});
