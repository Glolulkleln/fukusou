const cloud = require('wx-server-sdk');
const { success, fail, verifyToken, paginate, formatDate } = require('./utils.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-change-in-production';

// 匿名访问的 action 列表
const PUBLIC_ACTIONS = ['getCategories', 'getClothingList', 'getClothingDetail', 'getBanners'];

// 鉴权中间件：从 event.token 解析 openid
async function getAuthUser(event) {
  const token = event.token;
  if (!token) return null;
  try {
    const decoded = verifyToken(token, JWT_SECRET);
    return decoded && decoded.openid ? decoded : null;
  } catch (e) {
    return null;
  }
}

// 统一格式化记录中的日期字段
function formatRecordDates(record, fields) {
  if (!record) return record;
  fields.forEach(field => {
    if (record[field]) {
      record[field] = formatDate(record[field]);
    }
  });
  return record;
}

function formatListDates(list, fields) {
  return (list || []).map(item => formatRecordDates(item, fields));
}

exports.main = async (event, context) => {
  const { action, ...params } = event;

  // 通用鉴权检查
  const authRequired = !PUBLIC_ACTIONS.includes(action);
  let openid = null;
  if (authRequired) {
    const user = await getAuthUser(event);
    if (!user || !user.openid) {
      return fail('未登录或 token 已过期', 401);
    }
    openid = user.openid;
  }

  switch (action) {
    case 'getCategories':
      return handleGetCategories(params);
    case 'getClothingList':
      return handleGetClothingList(params);
    case 'getClothingDetail':
      return handleGetClothingDetail(params);
    case 'getBanners':
      return handleGetBanners(params);
    case 'updateUserInfo':
      return handleUpdateUserInfo(params, openid);
    case 'getUserInfo':
      return handleGetUserInfo(openid);
    case 'getAddresses':
      return handleGetAddresses(openid);
    case 'addAddress':
      return handleAddAddress(params, openid);
    case 'updateAddress':
      return handleUpdateAddress(params, openid);
    case 'deleteAddress':
      return handleDeleteAddress(params, openid);
    case 'setDefaultAddress':
      return handleSetDefaultAddress(params, openid);
    case 'getFavorites':
      return handleGetFavorites(params, openid);
    case 'addFavorite':
      return handleAddFavorite(params, openid);
    case 'deleteFavorite':
      return handleDeleteFavorite(params, openid);
    case 'createOrder':
      return handleCreateOrder(params, openid);
    case 'getOrders':
      return handleGetOrders(params, openid);
    case 'getOrderDetail':
      return handleGetOrderDetail(params, openid);
    case 'cancelOrder':
      return handleCancelOrder(params, openid);
    case 'payOrder':
      return handlePayOrder(params, openid);
    case 'confirmReceive':
      return handleConfirmReceive(params, openid);
    case 'confirmReturn':
      return handleConfirmReturn(params, openid);
    case 'submitReview':
      return handleSubmitReview(params, openid);
    case 'getReviews':
      return handleGetReviews(params);
    case 'notFound':
    default:
      return fail('接口不存在', 404);
  }
};

// ==================== 分类相关 ====================
async function handleGetCategories() {
  const res = await db.collection('categories')
    .where({ status: 1 })
    .orderBy('sortOrder', 'asc')
    .get();
  return success(res.data || []);
}

// ==================== 商品相关 ====================
async function handleGetClothingList(params) {
  const { categoryId, keyword, page = 1, pageSize = 10 } = params;
  const where = { status: 1 };
  if (categoryId) where.categoryId = categoryId;
  if (keyword) where.name = db.RegExp({ regexp: keyword, options: 'i' });

  const result = await paginate(db, 'clothings', where, Number(page), Number(pageSize), 'createTime', 'desc');
  result.list = formatListDates(result.list, ['createTime', 'updateTime']);
  return success(result);
}

async function handleGetClothingDetail(params) {
  const { id } = params;
  if (!id) return fail('商品 id 不能为空', 400);

  const res = await db.collection('clothings').doc(id).get();
  if (!res.data) return fail('商品不存在', 404);

  formatRecordDates(res.data, ['createTime', 'updateTime']);
  return success(res.data);
}

// ==================== Banner 相关 ====================
async function handleGetBanners() {
  const res = await db.collection('banners')
    .where({ status: 1 })
    .orderBy('sortOrder', 'asc')
    .get();
  const list = formatListDates(res.data || [], ['createTime']);
  return success(list);
}

// ==================== 用户相关 ====================
async function handleUpdateUserInfo(params, openid) {
  const { nickname, avatarUrl, phone } = params;
  const now = db.serverDate();

  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();

  if (userRes.data.length === 0) {
    await db.collection('users').add({
      data: {
        _openid: openid,
        nickname: nickname || '',
        avatarUrl: avatarUrl || '',
        phone: phone || '',
        status: 1,
        createTime: now,
        updateTime: now
      }
    });
  } else {
    const updateData = { updateTime: now };
    if (nickname !== undefined) updateData.nickname = nickname;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (phone !== undefined) updateData.phone = phone;
    await db.collection('users').doc(userRes.data[0]._id).update({ data: updateData });
  }

  return handleGetUserInfo(openid);
}

async function handleGetUserInfo(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('用户不存在', 404);
  const user = formatRecordDates({ ...res.data[0] }, ['createTime', 'updateTime']);
  return success(user);
}

// ==================== 地址相关 ====================
async function handleGetAddresses(openid) {
  const res = await db.collection('addresses')
    .where({ _openid: openid })
    .orderBy('isDefault', 'desc')
    .orderBy('createTime', 'desc')
    .get();
  const list = formatListDates(res.data || [], ['createTime', 'updateTime']);
  return success(list);
}

async function handleAddAddress(params, openid) {
  const { consignee, phone, region, detailedAddress, isDefault } = params;
  if (!consignee || !phone || !detailedAddress) {
    return fail('请填写完整的地址信息', 400);
  }

  const now = db.serverDate();

  if (isDefault) {
    const existRes = await db.collection('addresses').where({ _openid: openid, isDefault: true }).get();
    for (const item of existRes.data) {
      await db.collection('addresses').doc(item._id).update({ data: { isDefault: false, updateTime: now } });
    }
  }

  await db.collection('addresses').add({
    data: {
      _openid: openid,
      consignee,
      phone,
      region: region || [],
      detailedAddress,
      isDefault: !!isDefault,
      createTime: now,
      updateTime: now
    }
  });

  return success(null);
}

async function handleUpdateAddress(params, openid) {
  const { id, consignee, phone, region, detailedAddress, isDefault } = params;
  if (!id) return fail('地址 id 不能为空', 400);

  const res = await db.collection('addresses').doc(id).get();
  if (!res.data) return fail('地址不存在', 404);
  if (res.data._openid !== openid) return fail('无权限操作此地址', 403);

  const now = db.serverDate();

  if (isDefault && !res.data.isDefault) {
    const existRes = await db.collection('addresses').where({ _openid: openid, isDefault: true }).get();
    for (const item of existRes.data) {
      await db.collection('addresses').doc(item._id).update({ data: { isDefault: false, updateTime: now } });
    }
  }

  const updateData = { updateTime: now };
  if (consignee !== undefined) updateData.consignee = consignee;
  if (phone !== undefined) updateData.phone = phone;
  if (region !== undefined) updateData.region = region;
  if (detailedAddress !== undefined) updateData.detailedAddress = detailedAddress;
  if (isDefault !== undefined) updateData.isDefault = !!isDefault;

  await db.collection('addresses').doc(id).update({ data: updateData });
  return success(null);
}

async function handleDeleteAddress(params, openid) {
  const { id } = params;
  if (!id) return fail('地址 id 不能为空', 400);

  const res = await db.collection('addresses').doc(id).get();
  if (!res.data) return fail('地址不存在', 404);
  if (res.data._openid !== openid) return fail('无权限操作此地址', 403);

  await db.collection('addresses').doc(id).remove();
  return success(null);
}

async function handleSetDefaultAddress(params, openid) {
  const { id } = params;
  if (!id) return fail('地址 id 不能为空', 400);

  const res = await db.collection('addresses').doc(id).get();
  if (!res.data) return fail('地址不存在', 404);
  if (res.data._openid !== openid) return fail('无权限操作此地址', 403);

  const now = db.serverDate();
  const existRes = await db.collection('addresses').where({ _openid: openid, isDefault: true }).get();
  for (const item of existRes.data) {
    await db.collection('addresses').doc(item._id).update({ data: { isDefault: false, updateTime: now } });
  }

  await db.collection('addresses').doc(id).update({ data: { isDefault: true, updateTime: now } });
  return success(null);
}

// ==================== 收藏相关 ====================
async function handleGetFavorites(params, openid) {
  const { page = 1, pageSize = 10 } = params;

  const favRes = await paginate(
    db,
    'favorites',
    { _openid: openid },
    Number(page),
    Number(pageSize),
    'createTime',
    'desc'
  );

  const clothingIds = favRes.list.map(f => f.clothingId);
  if (clothingIds.length === 0) {
    return success({ list: [], total: 0, page: Number(page), pageSize: Number(pageSize), totalPages: 0 });
  }

  const clothingRes = await db.collection('clothings').where({ _id: _.in(clothingIds) }).get();
  const clothingMap = {};
  clothingRes.data.forEach(c => {
    clothingMap[c._id] = formatRecordDates(c, ['createTime', 'updateTime']);
  });

  const list = favRes.list.map(f => ({
    ...f,
    clothing: clothingMap[f.clothingId] || null
  }));

  return success({
    list,
    total: favRes.total,
    page: favRes.page,
    pageSize: favRes.pageSize,
    totalPages: favRes.totalPages
  });
}

async function handleAddFavorite(params, openid) {
  const { clothingId } = params;
  if (!clothingId) return fail('商品 id 不能为空', 400);

  const existRes = await db.collection('favorites').where({ _openid: openid, clothingId }).limit(1).get();
  if (existRes.data.length > 0) return fail('已收藏该商品', 400);

  await db.collection('favorites').add({
    data: {
      _openid: openid,
      clothingId,
      createTime: db.serverDate()
    }
  });
  return success(null);
}

async function handleDeleteFavorite(params, openid) {
  const { clothingId } = params;
  if (!clothingId) return fail('商品 id 不能为空', 400);

  const res = await db.collection('favorites').where({ _openid: openid, clothingId }).limit(1).get();
  if (res.data.length === 0) return fail('收藏不存在', 404);

  await db.collection('favorites').doc(res.data[0]._id).remove();
  return success(null);
}

// ==================== 订单相关 ====================
async function handleCreateOrder(params, openid) {
  const { clothingId, selectedSpec, rentDays = 1, rentStartTime, rentEndTime, addressId, note } = params;
  if (!clothingId || !selectedSpec || !rentStartTime || !rentEndTime || !addressId) {
    return fail('订单参数不完整', 400);
  }

  const clothingRes = await db.collection('clothings').doc(clothingId).get();
  if (!clothingRes.data) return fail('商品不存在', 404);
  const clothing = clothingRes.data;

  if (clothing.stock <= 0) return fail('库存不足', 400);

  const orderNo = 'ORD' + Date.now() + Math.floor(Math.random() * 900 + 100);
  const rentPrice = Number(clothing.rentPrice) || 0;
  const depositAmount = Number(clothing.depositAmount) || 0;
  const rentAmount = +(rentPrice * Number(rentDays)).toFixed(2);
  const totalAmount = +(rentAmount + depositAmount).toFixed(2);
  const now = db.serverDate();

  const orderData = {
    orderNo,
    _openid: openid,
    clothingId,
    clothingName: clothing.name || '',
    mainImage: clothing.mainImage || '',
    selectedSpec,
    rentDays: Number(rentDays),
    rentStartTime: new Date(rentStartTime),
    rentEndTime: new Date(rentEndTime),
    rentAmount,
    depositAmount,
    totalAmount,
    status: 0,
    addressId,
    note: note || '',
    createTime: now,
    updateTime: now
  };

  const transaction = await db.startTransaction();
  try {
    await transaction.collection('clothings').doc(clothingId).update({
      data: { stock: _.inc(-1), updateTime: now }
    });
    await transaction.collection('orders').add({ data: orderData });
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    return fail(e.message || '创建订单失败', 500);
  }

  // 返回格式化后的订单信息
  const createdRes = await db.collection('orders').where({ orderNo }).limit(1).get();
  const order = formatRecordDates({ ...createdRes.data[0] }, ['createTime', 'updateTime', 'rentStartTime', 'rentEndTime', 'paidAt', 'actualReturnTime']);
  return success(order);
}

async function handleGetOrders(params, openid) {
  const { status, page = 1, pageSize = 10 } = params;
  const where = { _openid: openid };
  if (status !== undefined && status !== null && status !== '') where.status = Number(status);

  const result = await paginate(db, 'orders', where, Number(page), Number(pageSize), 'createTime', 'desc');
  result.list = formatListDates(result.list, ['createTime', 'updateTime', 'rentStartTime', 'rentEndTime', 'paidAt', 'actualReturnTime']);
  return success(result);
}

async function handleGetOrderDetail(params, openid) {
  const { orderNo } = params;
  if (!orderNo) return fail('订单号不能为空', 400);

  const res = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('订单不存在', 404);

  const order = formatRecordDates({ ...res.data[0] }, ['createTime', 'updateTime', 'rentStartTime', 'rentEndTime', 'paidAt', 'actualReturnTime']);
  return success(order);
}

async function handleCancelOrder(params, openid) {
  const { orderNo } = params;
  if (!orderNo) return fail('订单号不能为空', 400);

  const res = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('订单不存在', 404);

  const order = res.data[0];
  if (order.status !== 0) return fail('只有待支付订单可取消', 400);

  const now = db.serverDate();
  const transaction = await db.startTransaction();
  try {
    await transaction.collection('clothings').doc(order.clothingId).update({
      data: { stock: _.inc(1), updateTime: now }
    });
    await transaction.collection('orders').doc(order._id).update({
      data: { status: 5, updateTime: now }
    });
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    return fail(e.message || '取消订单失败', 500);
  }

  return success(null);
}

async function handlePayOrder(params, openid) {
  const { orderNo, payMethod = 'mock' } = params;
  if (!orderNo) return fail('订单号不能为空', 400);

  const res = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('订单不存在', 404);

  const order = res.data[0];
  if (order.status !== 0) return fail('订单状态不正确，无法支付', 400);

  const now = db.serverDate();
  const transaction = await db.startTransaction();
  try {
    await transaction.collection('orders').doc(order._id).update({
      data: { status: 1, payMethod, paidAt: now, updateTime: now }
    });
    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    return fail(e.message || '支付失败', 500);
  }

  return success({ orderNo, status: 1, payTime: formatDate(new Date()) });
}

async function handleConfirmReceive(params, openid) {
  const { orderNo } = params;
  if (!orderNo) return fail('订单号不能为空', 400);

  const res = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('订单不存在', 404);

  const order = res.data[0];
  if (order.status !== 2) return fail('只有待收货订单可确认收货', 400);

  await db.collection('orders').doc(order._id).update({
    data: { status: 3, updateTime: db.serverDate() }
  });
  return success(null);
}

async function handleConfirmReturn(params, openid) {
  const { orderNo } = params;
  if (!orderNo) return fail('订单号不能为空', 400);

  const res = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (res.data.length === 0) return fail('订单不存在', 404);

  const order = res.data[0];
  if (order.status !== 3) return fail('只有租赁中订单可确认归还', 400);

  const now = db.serverDate();
  await db.collection('orders').doc(order._id).update({
    data: { status: 4, actualReturnTime: now, updateTime: now }
  });
  return success(null);
}

// ==================== 评价相关 ====================
async function handleSubmitReview(params, openid) {
  const { orderNo, clothingId, rating, content, images } = params;
  if (!orderNo || !clothingId || !rating) return fail('评价参数不完整', 400);
  if (rating < 1 || rating > 5) return fail('评分需在 1-5 之间', 400);

  const orderRes = await db.collection('orders').where({ orderNo, _openid: openid }).limit(1).get();
  if (orderRes.data.length === 0) return fail('订单不存在', 404);

  const order = orderRes.data[0];
  if (order.status !== 4) return fail('订单未完成，无法评价', 400);
  if (order.hasReview) return fail('订单已评价', 400);

  const now = db.serverDate();
  await db.collection('reviews').add({
    data: {
      orderNo,
      _openid: openid,
      clothingId,
      rating: Number(rating),
      content: content || '',
      images: images || [],
      createTime: now
    }
  });

  await db.collection('orders').doc(order._id).update({
    data: { hasReview: true, updateTime: now }
  });

  return success(null);
}

async function handleGetReviews(params) {
  const { clothingId, page = 1, pageSize = 10 } = params;
  if (!clothingId) return fail('商品 id 不能为空', 400);

  const result = await paginate(
    db,
    'reviews',
    { clothingId },
    Number(page),
    Number(pageSize),
    'createTime',
    'desc'
  );

  const openids = [...new Set(result.list.map(r => r._openid))];
  let userMap = {};
  if (openids.length > 0) {
    const userRes = await db.collection('users').where({ _openid: _.in(openids) }).get();
    userRes.data.forEach(u => {
      userMap[u._openid] = { nickname: u.nickname || '', avatarUrl: u.avatarUrl || '' };
    });
  }

  result.list = result.list.map(r => ({
    ...formatRecordDates(r, ['createTime']),
    nickname: (userMap[r._openid] && userMap[r._openid].nickname) || '',
    avatarUrl: (userMap[r._openid] && userMap[r._openid].avatarUrl) || ''
  }));

  return success(result);
}
