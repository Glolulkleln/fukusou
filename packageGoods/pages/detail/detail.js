const { callCloudApi, mapClothing, mapReviewList, getAccessibleImageUrl, getAccessibleImageUrls } = require('../../../utils/cloudApi');

Page({
  data: {
    clothing: null,
    galleryImages: [],
    specs: [],
    specList: [],
    selectedSpec: null,
    currentPrice: 0,
    reviews: [],
    isFavorite: false,
    rentDays: 3,
    rentDayOptions: [1, 3, 7, 15, 30],
    rentalNotice: '',
    rentalNoticeLines: []
  },

  onLoad(options) {
    const id = options.id || 1;
    this.getClothingDetail(id);
    this.getReviews(id);
    this.checkFavorite(id);
    this.getRentalNotice();
  },

  async getClothingDetail(id) {
    try {
      const res = await callCloudApi('getClothingDetail', { id });
      const clothing = mapClothing(res);
      if (clothing.main_image && clothing.main_image.startsWith('cloud://')) {
        clothing.main_image = await getAccessibleImageUrl(clothing.main_image);
      }
      let specList = [];
      try {
        specList = JSON.parse(clothing.specs || '[]');
      } catch (e) {
        console.error('规格解析失败:', e);
      }
      // 兼容旧版纯字符串规格，规范为 {size,price,stock} 对象
      if (specList.length && typeof specList[0] === 'string') {
        specList = specList.map(s => ({ size: s, price: clothing.rent_price || 0, stock: clothing.stock || 0 }));
      }
      const specSizes = specList.map(s => s.size);

      // 初始选中第一个尺码并取其定价
      let initialSpec = null;
      let initialPrice = clothing.rent_price || 0;
      if (specList.length) {
        initialSpec = specList[0].size;
        if (specList[0].price !== undefined && specList[0].price !== '' && specList[0].price !== null) {
          initialPrice = specList[0].price || initialPrice;
        }
      }

      // 多图展示：主图 + 附加图（去重），统一解析可访问地址
      let extraImages = [];
      try {
        extraImages = JSON.parse(clothing.images || '[]');
      } catch (e) {
        extraImages = [];
      }
      const rawGallery = [clothing.main_image, ...(extraImages || [])].filter(Boolean);
      // 去重
      const uniqueGallery = [];
      rawGallery.forEach(u => { if (uniqueGallery.indexOf(u) === -1) uniqueGallery.push(u); });
      const urlMap = await getAccessibleImageUrls(uniqueGallery);
      const galleryImages = uniqueGallery.map(u => urlMap[u] || u);

      this.setData({
        clothing,
        specs: specSizes,
        specList,
        selectedSpec: initialSpec,
        currentPrice: initialPrice,
        galleryImages
      });
      this.saveRecentView(clothing);
    } catch (err) {
      console.error(err);
    }
  },

  async getRentalNotice() {
    try {
      const res = await callCloudApi('getConfig', { key: 'rental_notice' });
      const value = (res && res.value) || '';
      const lines = value ? value.split('\n').filter(t => t.trim().length > 0) : [];
      this.setData({ rentalNotice: value, rentalNoticeLines: lines });
    } catch (err) {
      console.error('获取租赁须知失败:', err);
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

  previewImage(e) {
    const urls = this.data.galleryImages.length ? this.data.galleryImages : [this.data.clothing.main_image];
    const current = (e && e.currentTarget.dataset.src) || urls[0];
    if (!current) return;
    wx.previewImage({
      current,
      urls
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
    } catch (e) {
      console.error('保存最近浏览失败:', e);
    }
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
    const spec = e.currentTarget.dataset.spec;
    const specList = this.data.specList || [];
    const matched = specList.find(s => s.size === spec);
    let price = this.data.clothing.rent_price || 0;
    if (matched && matched.price !== undefined && matched.price !== '' && matched.price !== null) {
      price = matched.price || price;
    }
    this.setData({
      selectedSpec: spec,
      currentPrice: price
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
