const { callCloudApi, mapClothing, mapReviewList, getAccessibleImageUrl, getAccessibleImageUrls } = require('../../../utils/cloudApi');

Page({
  data: {
    clothing: null,
    specs: [],
    selectedSpec: null,
    reviews: [],
    isFavorite: false,
    rentDays: 3,
    rentDayOptions: [1, 3, 7, 15, 30]
  },

  onLoad(options) {
    const id = options.id || 1;
    this.getClothingDetail(id);
    this.getReviews(id);
    this.checkFavorite(id);
  },

  async getClothingDetail(id) {
    try {
      const res = await callCloudApi('getClothingDetail', { id });
      const clothing = mapClothing(res);
      if (clothing.main_image && clothing.main_image.startsWith('cloud://')) {
        clothing.main_image = await getAccessibleImageUrl(clothing.main_image);
      }
      let parsedSpecs = [];
      try {
        parsedSpecs = JSON.parse(clothing.specs || '[]');
      } catch (e) {}

      this.setData({
        clothing,
        specs: parsedSpecs
      });
      this.saveRecentView(clothing);
    } catch (err) {
      console.error(err);
    }
  },

  async getReviews(id) {
    try {
      const res = await callCloudApi('getReviews', { clothingId: id });
      const list = res && res.list ? res.list : res;
      const formatted = mapReviewList(list).map(item => {
        try {
          item.images = JSON.parse(item.images || '[]');
        } catch(e) {
          item.images = item.images || [];
        }
        return item;
      });

      // 批量转换评价图片 cloud:// 地址
      const allImageUrls = [];
      formatted.forEach(item => {
        (item.images || []).forEach(url => allImageUrls.push(url));
      });
      const urlMap = await getAccessibleImageUrls(allImageUrls);
      formatted.forEach(item => {
        item.images = (item.images || []).map(url => urlMap[url] || url);
      });

      this.setData({ reviews: formatted });
    } catch (err) {
      console.error(err);
    }
  },

  async checkFavorite(id) {
    const token = wx.getStorageSync('token');
    if (!token) return;
    try {
      const res = await callCloudApi('checkFavorite', { clothing_id: id });
      this.setData({ isFavorite: !!res });
    } catch (err) {
      console.error(err);
    }
  },

  previewImage() {
    if (!this.data.clothing || !this.data.clothing.main_image) return;
    wx.previewImage({
      current: this.data.clothing.main_image,
      urls: [this.data.clothing.main_image]
    });
  },

  saveRecentView(clothing) {
    if (!clothing || !clothing.id) return;
    try {
      let list = wx.getStorageSync('recentViews') || [];
      list = list.filter(item => item.id !== clothing.id);
      list.unshift({
        id: clothing.id,
        name: clothing.name,
        main_image: clothing.main_image,
        rent_price: clothing.rent_price
      });
      if (list.length > 10) list = list.slice(0, 10);
      wx.setStorageSync('recentViews', list);
    } catch (e) {}
  },

  async toggleFavorite() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const clothingId = this.data.clothing.id;
    try {
      if (this.data.isFavorite) {
        await callCloudApi('deleteFavorite', { clothingId });
        this.setData({ isFavorite: false });
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      } else {
        await callCloudApi('addFavorite', { clothingId });
        this.setData({ isFavorite: true });
        wx.showToast({ title: '收藏成功', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  selectSpec(e) {
    this.setData({
      selectedSpec: e.currentTarget.dataset.spec
    });
  },

  setRentDays(e) {
    const days = e.currentTarget.dataset.days;
    this.setData({ rentDays: days });
  },

  addToCart() {
    if (!this.data.clothing || this.data.clothing.stock <= 0) {
      wx.showToast({ title: '暂无库存', icon: 'none' });
      return;
    }

    if (!this.data.selectedSpec) {
      wx.showToast({ title: '请先选择尺寸规格', icon: 'none' });
      return;
    }

    let cart = wx.getStorageSync('cart') || [];
    const cartItem = {
      id: new Date().getTime(),
      clothing_id: this.data.clothing.id,
      name: this.data.clothing.name,
      main_image: this.data.clothing.main_image,
      spec: this.data.selectedSpec,
      rent_price: this.data.clothing.rent_price,
      deposit_amount: this.data.clothing.deposit_amount,
      rent_days: this.data.rentDays,
      selected: true
    };

    cart.push(cartItem);
    wx.setStorageSync('cart', cart);

    wx.showToast({ title: '已成功加入租赁袋', icon: 'success' });
  },

  rentNow() {
    if (!this.data.clothing || this.data.clothing.stock <= 0) {
      wx.showToast({ title: '暂无库存', icon: 'none' });
      return;
    }

    if (!this.data.selectedSpec) {
      wx.showToast({ title: '请先选择尺寸规格', icon: 'none' });
      return;
    }

    const cartItem = {
      id: new Date().getTime(),
      clothing_id: this.data.clothing.id,
      name: this.data.clothing.name,
      main_image: this.data.clothing.main_image,
      spec: this.data.selectedSpec,
      rent_price: this.data.clothing.rent_price,
      deposit_amount: this.data.clothing.deposit_amount,
      rent_days: this.data.rentDays,
      selected: true
    };

    let cart = wx.getStorageSync('cart') || [];
    cart = cart.filter(item => !item.selected);
    cart.push(cartItem);
    wx.setStorageSync('cart', cart);

    wx.navigateTo({
      url: '/packageUser/pages/checkout/checkout'
    });
  },

  onShareAppMessage() {
    const c = this.data.clothing || {};
    return {
      title: c.name ? '推荐你租这件：' + c.name : '云裳微租 - 校园服装租赁',
      path: '/packageGoods/pages/detail/detail?id=' + (c.id || '')
    };
  }
});
