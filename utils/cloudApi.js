const { request, BASE_URL } = require('./request');

const callCloudApi = async (action, params = {}, options = {}) => {
  const API_MAP = {
    getBanners: { url: '/api/banners', method: 'GET' },
    getCategories: { url: '/api/categories', method: 'GET' },
    getClothingList: { url: '/api/clothing', method: 'GET' },
    getClothingDetail: { url: '/api/clothing', method: 'GET' },
    getUserInfo: { url: '/api/user/info', method: 'GET' },
    bindPhone: { url: '/api/bind-phone', method: 'POST' },
    getNotifications: { url: '/api/notifications', method: 'GET' },
    markNotificationRead: { url: '/api/notifications', method: 'POST' },
    getAddresses: { url: '/api/addresses', method: 'GET' },
    getAddressDetail: { url: '/api/addresses', method: 'GET' },
    addAddress: { url: '/api/addresses', method: 'POST' },
    updateAddress: { url: '/api/addresses', method: 'PUT' },
    deleteAddress: { url: '/api/addresses', method: 'DELETE' },
    getFavorites: { url: '/api/favorites', method: 'GET' },
    addFavorite: { url: '/api/favorites/toggle', method: 'POST' },
    deleteFavorite: { url: '/api/favorites/toggle', method: 'POST' },
    toggleFavorite: { url: '/api/favorites/toggle', method: 'POST' },
    checkFavorite: { url: '/api/favorites/check', method: 'GET' },
    getOrders: { url: '/api/orders', method: 'GET' },
    getOrderDetail: { url: '/api/orders', method: 'GET' },
    createOrder: { url: '/api/orders', method: 'POST' },
    getReviews: { url: '/api/reviews', method: 'GET' },
    submitReview: { url: '/api/reviews', method: 'POST' },
    getDepositSummary: { url: '/api/deposit/summary', method: 'GET' },
    getDepositRecords: { url: '/api/deposit/records', method: 'GET' },
    payOrder: { url: '/api/pay/mock', method: 'POST' },
    remindShip: { url: '/api/orders/remind', method: 'POST' },
    cancelOrder: { url: '/api/orders/status', method: 'PUT' },
    confirmReturn: { url: '/api/orders/status', method: 'PUT' },
    updateUserInfo: { url: '/api/user/info', method: 'PUT' },
  };

  const config = API_MAP[action];
  if (!config) {
    throw new Error('接口不存在：' + action);
  }

  let url = config.url;
  const method = config.method;
  let data = { ...params };

  if (action === 'getClothingDetail' && (params.id || params.clothingId)) {
    url = '/api/clothing/' + (params.id || params.clothingId);
    data = {};
  }
  if (action === 'getConfig' && params.key) {
    url = '/api/config/' + params.key;
    data = {};
  }
  if (action === 'getLogistics' && (params.orderNo || params.order_no)) {
    url = '/api/orders/' + (params.orderNo || params.order_no) + '/logistics';
    data = {};
  }
  if (action === 'markNotificationRead' && (params.id || params.notificationId)) {
    url = '/api/notifications/' + (params.id || params.notificationId) + '/read';
    data = {};
  }
  if (action === 'getAddressDetail' && (params.id || params.addressId)) {
    url = '/api/addresses/' + (params.id || params.addressId);
    data = {};
  }
  if (action === 'updateAddress' && (params.id || params.addressId)) {
    url = '/api/addresses/' + (params.id || params.addressId);
    delete data.id;
    delete data.addressId;
  }
  if (action === 'deleteAddress' && (params.id || params.addressId)) {
    url = '/api/addresses/' + (params.id || params.addressId);
    data = {};
  }
  if (action === 'getOrderDetail' && (params.orderNo || params.order_no)) {
    url = '/api/orders/' + (params.orderNo || params.order_no);
    data = {};
  }
  if (action === 'cancelOrder' && (params.orderNo || params.order_no)) {
    url = '/api/orders/' + (params.orderNo || params.order_no) + '/status';
    data = { status: 5 };
  }
  if (action === 'confirmReturn' && (params.orderNo || params.order_no)) {
    url = '/api/orders/' + (params.orderNo || params.order_no) + '/status';
    data = { status: 3 };
  }
  if (action === 'payOrder' && (params.orderNo || params.order_no)) {
    url = '/api/pay/mock';
    data = { order_no: params.orderNo || params.order_no };
  }
  if (action === 'remindShip' && (params.orderNo || params.order_no)) {
    url = '/api/orders/' + (params.orderNo || params.order_no) + '/remind';
    data = {};
  }
  if (action === 'submitReview') {
    data = {
      order_no: params.orderNo || params.order_no,
      clothing_id: params.clothingId || params.clothing_id,
      rating: params.rating,
      content: params.content,
      images: params.images || []
    };
  }
  if (action === 'getReviews' && (params.clothingId || params.clothing_id)) {
    url = '/api/reviews?clothing_id=' + (params.clothingId || params.clothing_id);
    data = {};
  }
  if (action === 'checkFavorite' && (params.clothingId || params.clothing_id)) {
    url = '/api/favorites/check?clothing_id=' + (params.clothingId || params.clothing_id);
    data = {};
  }
  if (action === 'toggleFavorite') {
    data = { clothing_id: params.clothingId || params.clothing_id };
  }
  if (action === 'updateUserInfo') {
    url = '/api/user/info';
    data = {
      nickname: params.nickname,
      avatar_url: params.avatarUrl || params.avatar_url,
      phone: params.phone
    };
  }
  if (action === 'createOrder') {
    data = {
      items: params.items || [{
        clothing_id: params.clothingId || params.clothing_id,
        spec: params.selectedSpec || params.selected_spec,
        rent_days: params.rentDays || params.rent_days,
        deposit_amount: params.depositAmount || params.deposit_amount
      }],
      rent_start_time: params.rentStartTime || params.rent_start_time,
      rent_end_time: params.rentEndTime || params.rent_end_time,
      address_id: params.addressId || params.address_id
    };
  }
  if (action === 'getClothingList' && (params.categoryId || params.category_id)) {
    url = '/api/clothing?category_id=' + (params.categoryId || params.category_id);
    data = {};
  }
  if (action === 'addAddress' || action === 'updateAddress') {
    data = {
      consignee: params.consignee,
      phone: params.phone,
      detailed_address: params.detailedAddress || params.detailed_address,
      is_default: params.isDefault !== undefined ? params.isDefault : params.is_default
    };
  }

  try {
    const res = await request(url, method, data);
    return res.data;
  } catch (err) {
    console.error('api error:', action, err);
    throw err;
  }
};

const wxLogin = async (userInfo) => {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (!res.code) return reject(new Error('wx.login 失败'));
        try {
          const data = { code: res.code };
          if (userInfo) {
            data.nickname = userInfo.nickName;
            data.avatar_url = userInfo.avatarUrl;
          }
          const loginRes = await request('/api/login', 'POST', data);
          const result = loginRes.data;
          wx.setStorageSync('token', result.token);
          wx.setStorageSync('openid', result.openid);
          wx.setStorageSync('userInfo', result.userInfo);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      },
      fail: reject
    });
  });
};

// HTTP 图片临时缓存（微信小程序不再支持 HTTP 图片，需下载到本地）
const imageCache = new Map();

const downloadHttpImage = (httpUrl) => {
  if (imageCache.has(httpUrl)) return Promise.resolve(imageCache.get(httpUrl));
  return new Promise((resolve) => {
    wx.downloadFile({
      url: httpUrl,
      success: (res) => {
        if (res.statusCode === 200) {
          imageCache.set(httpUrl, res.tempFilePath);
          resolve(res.tempFilePath);
        } else {
          resolve(httpUrl); // 降级：返回原 URL（可能是 HTTPS 或其他）
        }
      },
      fail: () => resolve(httpUrl) // 下载失败降级
    });
  });
};

const getAccessibleImageUrl = async (url) => {
  if (!url) return url;
  if (url.startsWith('http://')) return downloadHttpImage(url);
  if (url.startsWith('https://')) return url;
  const fullUrl = BASE_URL + (url.startsWith('/') ? url : '/' + url);
  if (fullUrl.startsWith('http://')) return downloadHttpImage(fullUrl);
  return fullUrl;
};

const getAccessibleImageUrls = async (urls) => {
  if (!Array.isArray(urls) || urls.length === 0) return {};
  const fullUrls = urls.map(url => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return BASE_URL + (url.startsWith('/') ? url : '/' + url);
  });

  const httpUrls = fullUrls.filter(u => u && u.startsWith('http://'));
  if (httpUrls.length > 0) {
    await Promise.all(httpUrls.map(u => downloadHttpImage(u)));
  }

  const map = {};
  urls.forEach((url, i) => {
    if (!url) return;
    const fullUrl = fullUrls[i];
    if (fullUrl && fullUrl.startsWith('http://')) {
      map[url] = imageCache.get(fullUrl) || fullUrl;
    } else {
      map[url] = fullUrl;
    }
  });
  return map;
};

const uploadCloudFile = (filePath, token) => {
  const authToken = token || wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/api/upload',
      filePath: filePath,
      name: 'file',
      header: authToken ? { 'Authorization': 'Bearer ' + authToken } : {},
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode === 401) {
            reject(new Error('登录已过期，请重新登录'));
            return;
          }
          if (data.code === 200 || data.success) {
            resolve(data.data);
          } else {
            reject(new Error(data.message || '上传失败'));
          }
        } catch (e) {
          reject(e);
        }
      },
      fail: reject
    });
  });
};

const mapUser = (user) => {
  if (!user) return user;
  return {
    ...user,
    avatar_url: user.avatarUrl || user.avatar_url || ''
  };
};

const mapClothing = (item) => {
  if (!item) return item;
  return {
    ...item,
    id: item.id,
    main_image: item.main_image || item.mainImage || '',
    rent_price: item.rent_price || item.rentPrice || 0,
    deposit_amount: item.deposit_amount || item.depositAmount || 0,
    category_id: item.category_id || item.categoryId,
    create_time: item.create_time || item.createTime,
    update_time: item.update_time || item.updateTime
  };
};

const mapClothingList = (list) => {
  return (list || []).map(mapClothing);
};

const mapCategory = (category) => {
  if (!category) return category;
  return {
    ...category,
    id: category.id
  };
};

const mapCategoryList = (list) => {
  return (list || []).map(mapCategory);
};

const mapBanner = (banner) => {
  if (!banner) return banner;
  return {
    ...banner,
    id: banner.id,
    image_url: banner.image_url || banner.imageUrl || '',
    target_link: banner.target_link || banner.targetLink || ''
  };
};

const mapBannerList = (list) => {
  return (list || []).map(mapBanner);
};

const mapAddress = (addr) => {
  if (!addr) return addr;
  return {
    ...addr,
    id: addr.id,
    detailed_address: addr.detailed_address || addr.detailedAddress || '',
    is_default: addr.is_default !== undefined ? addr.is_default : (addr.isDefault ? 1 : 0)
  };
};

const mapAddressList = (list) => {
  return (list || []).map(mapAddress);
};

const mapOrder = (order) => {
  if (!order) return order;
  return {
    ...order,
    order_no: order.order_no || order.orderNo || '',
    clothing_id: order.clothing_id || order.clothingId,
    clothing_name: order.clothing_name || order.clothingName || '',
    main_image: order.main_image || order.mainImage || '',
    rent_days: order.rent_days || order.rentDays || 1,
    rent_start_time: order.rent_start_time || order.rentStartTime || '',
    rent_end_time: order.rent_end_time || order.rentEndTime || '',
    rent_amount: order.rent_amount || order.rentAmount || 0,
    deposit_amount: order.deposit_amount || order.depositAmount || 0,
    discount_amount: order.discount_amount || order.discountAmount || 0,
    total_amount: order.total_amount || order.totalAmount || 0,
    created_at: order.created_at || order.createTime || '',
    updated_at: order.updated_at || order.updateTime || '',
    paid_at: order.paid_at || order.paidAt,
    actual_return_time: order.actual_return_time || order.actualReturnTime,
    express_no: order.express_no || order.expressNo,
    express_company: order.express_company || order.expressCompany
  };
};

const mapOrderList = (list) => {
  return (list || []).map(mapOrder);
};

const mapReview = (review) => {
  if (!review) return review;
  return {
    ...review,
    avatar_url: review.avatar_url || review.avatarUrl || '',
    created_at: review.created_at || review.createTime || ''
  };
};

const mapReviewList = (list) => {
  return (list || []).map(mapReview);
};

const mapFavorite = (item) => {
  if (!item) return item;
  const clothing = mapClothing(item.clothing || item);
  return {
    ...item,
    ...clothing,
    id: item.id,
    clothing_id: clothing.id || item.clothing_id || item.clothingId
  };
};

const mapFavoriteList = (list) => {
  return (list || []).map(mapFavorite);
};

const resolveImageUrl = async (url) => {
  return getAccessibleImageUrl(url);
};

const resolveImagesInList = async (list, field = 'main_image') => {
  if (!Array.isArray(list) || list.length === 0) return list;

  // 收集所有需要下载的 HTTP URL
  const httpUrls = [];
  list.forEach(item => {
    if (!item) return;
    const original = item[field];
    if (!original) return;
    const fullUrl = (original.startsWith('http://') || original.startsWith('https://'))
      ? original
      : BASE_URL + (original.startsWith('/') ? original : '/' + original);
    if (fullUrl.startsWith('http://')) httpUrls.push(fullUrl);
  });

  // 批量预下载 HTTP 图片
  if (httpUrls.length > 0) {
    await Promise.all(httpUrls.map(u => downloadHttpImage(u)));
  }

  return list.map(item => {
    if (!item) return item;
    const original = item[field];
    if (!original) return item;
    const fullUrl = (original.startsWith('http://') || original.startsWith('https://'))
      ? original
      : BASE_URL + (original.startsWith('/') ? original : '/' + original);
    const resolved = fullUrl.startsWith('http://') ? (imageCache.get(fullUrl) || fullUrl) : fullUrl;
    return { ...item, [field]: resolved };
  });
};

module.exports = {
  callCloudApi,
  wxLogin,
  getAccessibleImageUrl,
  getAccessibleImageUrls,
  uploadCloudFile,
  mapUser,
  mapClothing,
  mapClothingList,
  mapCategory,
  mapCategoryList,
  mapBanner,
  mapBannerList,
  mapAddress,
  mapAddressList,
  mapOrder,
  mapOrderList,
  mapReview,
  mapReviewList,
  mapFavorite,
  mapFavoriteList,
  resolveImageUrl,
  resolveImagesInList
};
