const { callCloudApi, mapCategoryList, mapClothingList, resolveImagesInList } = require('../../utils/cloudApi');

Page({
  data: {
    categoryList: [],
    clothingList: [],
    currentCategoryId: null,
    loading: true
  },

  onShow() {
    this.getCategories();
  },

  getCategories() {
    this.setData({ loading: true });
    callCloudApi('getCategories')
      .then(async res => {
        const categoryList = mapCategoryList(res || []);
        if (categoryList.length > 0) {
          const app = getApp();
          let targetId = app.globalData.targetCategoryId;

          if (!targetId) {
            targetId = categoryList[0]._id || categoryList[0].id;
          } else {
            app.globalData.targetCategoryId = null;
          }

          this.setData({
            categoryList,
            currentCategoryId: targetId
          });
          await this.getClothingByCategory(targetId);
        } else {
          this.setData({ loading: false });
        }
      })
      .catch(err => {
        console.error(err);
        this.setData({ loading: false });
      });
  },

  getClothingByCategory(categoryId) {
    if (!categoryId) return Promise.resolve();
    this.setData({ loading: true });
    return callCloudApi('getClothingList', { categoryId })
      .then(async res => {
        const list = mapClothingList(res && res.list ? res.list : res);
        const imageList = await resolveImagesInList(list, 'main_image');
        this.setData({
          clothingList: imageList || [],
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
    if (this.data.currentCategoryId) {
      this.getClothingByCategory(this.data.currentCategoryId);
    } else {
      wx.stopPullDownRefresh();
    }
  },

  switchCategory(e) {
    if (!e || !e.currentTarget) return;
    const categoryId = e.currentTarget.dataset.id;
    
    if (String(this.data.currentCategoryId) === String(categoryId)) {
      return;
    }
    
    this.setData({
      currentCategoryId: categoryId
    });
    this.getClothingByCategory(categoryId);
  },

  goToDetail(e) {
    if (!e || !e.currentTarget) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  }
});
