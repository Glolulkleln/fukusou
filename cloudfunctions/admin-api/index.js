const cloud = require('wx-server-sdk');
const { success, fail, signToken, verifyToken, verifyPassword, formatDate } = require('./utils.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-change-in-production';

function resp(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

function ok(data) {
  return resp({ code: 200, success: true, data });
}

function error(message, code = 500) {
  return resp(fail(message, code), code);
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }
  return body;
}

function normalizePath(path) {
  if (!path) return '/';
  let p = path.split('?')[0];
  p = p.replace(/^\/api\/admin/, '');
  p = p.replace(/^\/admin-api/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

function getAdminFromHeaders(headers) {
  const authHeader = headers.Authorization || headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    return verifyToken(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function formatDocDates(doc) {
  const fields = ['createTime', 'updateTime', 'paidAt', 'rentStartTime', 'rentEndTime', 'actualReturnTime'];
  fields.forEach(field => {
    if (doc[field] != null) {
      doc[field] = formatDate(doc[field]);
    }
  });
  return doc;
}

function camelToSnake(key) {
  if (key === '_id') return 'id';
  if (key === '_openid') return 'openid';
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function convertKeys(obj) {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj === null || typeof obj !== 'object') return obj;
  const result = {};
  for (const key of Object.keys(obj)) {
    result[camelToSnake(key)] = convertKeys(obj[key]);
  }
  return result;
}

function getPageParams(query) {
  const page = parseInt(query.page) || 1;
  const pageSize = parseInt(query.pageSize || query.page_size) || 10;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

async function handleLogin(body) {
  const { username, password } = body;
  if (!username || !password) {
    return error('用户名和密码不能为空', 400);
  }
  const res = await db.collection('admins').where({ username, status: 1 }).get();
  if (res.data.length === 0) {
    return error('用户名或密码错误', 401);
  }
  const admin = res.data[0];
  if (!verifyPassword(password, admin.password)) {
    return error('用户名或密码错误', 401);
  }
  const token = signToken(
    { adminId: admin._id, username: admin.username, role: admin.role || 1 },
    JWT_SECRET,
    '24h'
  );
  return ok({
    token,
    adminInfo: convertKeys(formatDocDates(admin))
  });
}

async function handleDashboard() {
  const [usersRes, clothingsRes, ordersRes, completedRes] = await Promise.all([
    db.collection('users').count(),
    db.collection('clothings').count(),
    db.collection('orders').count(),
    db.collection('orders').where({ status: 4 }).get()
  ]);
  const revenue = (completedRes.data || []).reduce((sum, o) => sum + (Number(o.rentAmount) || 0), 0);
  return ok({
    users: usersRes.total || 0,
    clothings: clothingsRes.total || 0,
    orders: ordersRes.total || 0,
    revenue
  });
}

async function handleGetCategories() {
  const res = await db.collection('categories').orderBy('sortOrder', 'asc').orderBy('_id', 'asc').get();
  return ok(res.data.map(item => convertKeys(formatDocDates(item))));
}

async function handleCreateCategory(body) {
  const { name, sortOrder, status } = body;
  if (!name) return error('分类名称不能为空', 400);
  await db.collection('categories').add({
    data: {
      name,
      sortOrder: sortOrder || 0,
      status: status !== undefined ? status : 1,
      createTime: db.serverDate()
    }
  });
  return ok(null);
}

async function handleUpdateCategory(id, body) {
  const { name, sortOrder, status } = body;
  if (!name) return error('分类名称不能为空', 400);
  const update = { name };
  if (sortOrder !== undefined) update.sortOrder = sortOrder;
  if (status !== undefined) update.status = status;
  await db.collection('categories').doc(id).update({ data: update });
  return ok(null);
}

async function handleDeleteCategory(id) {
  const clothingRes = await db.collection('clothings').where({ categoryId: id }).count();
  if (clothingRes.total > 0) {
    return error('该分类下存在关联服装，不允许删除', 400);
  }
  await db.collection('categories').doc(id).remove();
  return ok(null);
}

async function handleGetClothings(query) {
  const { page, pageSize, skip } = getPageParams(query);
  const keyword = query.name || query.keyword || '';
  const categoryId = query.categoryId || query.category_id || '';

  const where = {};
  if (keyword) {
    where.name = db.RegExp({ regexp: keyword, options: 'i' });
  }
  if (categoryId) {
    where.categoryId = categoryId;
  }

  const collection = db.collection('clothings').where(where);
  const totalRes = await collection.count();
  const listRes = await collection.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get();
  const list = listRes.data || [];

  if (list.length > 0) {
    const categoryIds = [...new Set(list.map(c => c.categoryId).filter(Boolean))];
    if (categoryIds.length > 0) {
      const catRes = await db.collection('categories').where({ _id: _.in(categoryIds) }).get();
      const catMap = {};
      catRes.data.forEach(c => catMap[c._id] = c.name);
      list.forEach(c => {
        c.categoryName = catMap[c.categoryId] || '';
      });
    }
  }

  return ok({
    list: list.map(item => convertKeys(formatDocDates(item))),
    total: totalRes.total || 0,
    page,
    page_size: pageSize
  });
}

async function handleGetClothing(id) {
  const res = await db.collection('clothings').doc(id).get();
  if (!res.data) return error('商品不存在', 404);
  return ok(convertKeys(formatDocDates(res.data)));
}

async function handleCreateClothing(body) {
  const data = {
    name: body.name,
    categoryId: body.categoryId,
    mainImage: body.mainImage,
    images: body.images || [],
    specs: body.specs || [],
    rentPrice: body.rentPrice,
    depositAmount: body.depositAmount,
    stock: body.stock !== undefined ? body.stock : 0,
    status: body.status !== undefined ? body.status : 1,
    createTime: db.serverDate(),
    updateTime: db.serverDate()
  };
  await db.collection('clothings').add({ data });
  return ok(null);
}

async function handleUpdateClothing(id, body) {
  const update = {};
  ['name', 'categoryId', 'mainImage', 'images', 'specs', 'rentPrice', 'depositAmount', 'stock', 'status'].forEach(key => {
    if (body[key] !== undefined) update[key] = body[key];
  });
  if (Object.keys(update).length === 0) return error('无更新内容', 400);
  update.updateTime = db.serverDate();
  await db.collection('clothings').doc(id).update({ data: update });
  return ok(null);
}

async function handleDeleteClothing(id) {
  const orderRes = await db.collection('orders').where({ clothingId: id, status: _.lt(4) }).count();
  if (orderRes.total > 0) {
    return error('该商品存在未完成订单，不允许删除', 400);
  }
  await db.collection('clothings').doc(id).remove();
  return ok(null);
}

async function handleGetOrders(query) {
  const { page, pageSize, skip } = getPageParams(query);
  const status = query.status;
  const orderNo = query.orderNo || query.order_no || '';

  const where = {};
  if (status !== undefined && status !== '') {
    where.status = parseInt(status);
  }
  if (orderNo) {
    where.orderNo = db.RegExp({ regexp: orderNo, options: 'i' });
  }

  const collection = db.collection('orders').where(where);
  const totalRes = await collection.count();
  const listRes = await collection.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get();
  const list = listRes.data || [];

  if (list.length > 0) {
    const openids = [...new Set(list.map(o => o._openid).filter(Boolean))];
    if (openids.length > 0) {
      const userRes = await db.collection('users').where({ _openid: _.in(openids) }).get();
      const userMap = {};
      userRes.data.forEach(u => userMap[u._openid] = u);
      list.forEach(o => {
        const u = userMap[o._openid];
        o.nickname = u ? u.nickname : '';
        o.userPhone = u ? u.phone : '';
      });
    }
  }

  return ok({
    list: list.map(item => convertKeys(formatDocDates(item))),
    total: totalRes.total || 0,
    page,
    page_size: pageSize
  });
}

async function handleGetOrder(orderNo) {
  const res = await db.collection('orders').where({ orderNo }).get();
  if (res.data.length === 0) return error('订单不存在', 404);
  const order = res.data[0];
  const userRes = await db.collection('users').where({ _openid: order._openid }).get();
  if (userRes.data.length > 0) {
    order.nickname = userRes.data[0].nickname;
    order.userPhone = userRes.data[0].phone;
  }
  return ok(convertKeys(formatDocDates(order)));
}

async function handleUpdateOrderStatus(orderNo, body) {
  const status = parseInt(body.status);
  if (isNaN(status) || status < 0 || status > 5) {
    return error('订单状态无效', 400);
  }
  const res = await db.collection('orders').where({ orderNo }).get();
  if (res.data.length === 0) return error('订单不存在', 404);
  const order = res.data[0];
  const update = { status, updateTime: db.serverDate() };
  if (body.expressNo !== undefined) update.expressNo = body.expressNo;
  if (status === 4) update.actualReturnTime = db.serverDate();
  await db.collection('orders').doc(order._id).update({ data: update });
  return ok(null);
}

async function handleShipOrder(orderNo, body) {
  const expressNo = body.expressNo;
  if (!expressNo) return error('快递单号不能为空', 400);
  const res = await db.collection('orders').where({ orderNo }).get();
  if (res.data.length === 0) return error('订单不存在', 404);
  const order = res.data[0];
  if (order.status !== 1) return error('只有待发货状态的订单才能发货', 400);
  await db.collection('orders').doc(order._id).update({
    data: { status: 2, expressNo, updateTime: db.serverDate() }
  });
  return ok(null);
}

async function handleGetBanners() {
  const res = await db.collection('banners').orderBy('sortOrder', 'asc').get();
  return ok(res.data.map(item => convertKeys(formatDocDates(item))));
}

async function handleCreateBanner(body) {
  const { title, imageUrl, targetLink, sortOrder, status } = body;
  await db.collection('banners').add({
    data: {
      title: title || '',
      imageUrl,
      targetLink: targetLink || '',
      sortOrder: sortOrder || 0,
      status: status !== undefined ? status : 1,
      createTime: db.serverDate()
    }
  });
  return ok(null);
}

async function handleUpdateBanner(id, body) {
  const update = {};
  ['title', 'imageUrl', 'targetLink', 'sortOrder', 'status'].forEach(key => {
    if (body[key] !== undefined) update[key] = body[key];
  });
  await db.collection('banners').doc(id).update({ data: update });
  return ok(null);
}

async function handleDeleteBanner(id) {
  await db.collection('banners').doc(id).remove();
  return ok(null);
}

async function handleGetReviews(query) {
  const { page, pageSize, skip } = getPageParams(query);
  const collection = db.collection('reviews');
  const totalRes = await collection.count();
  const listRes = await collection.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get();
  const list = listRes.data || [];

  if (list.length > 0) {
    const openids = [...new Set(list.map(r => r._openid).filter(Boolean))];
    const clothingIds = [...new Set(list.map(r => r.clothingId).filter(Boolean))];
    const [userRes, clothingRes] = await Promise.all([
      openids.length > 0 ? db.collection('users').where({ _openid: _.in(openids) }).get() : Promise.resolve({ data: [] }),
      clothingIds.length > 0 ? db.collection('clothings').where({ _id: _.in(clothingIds) }).get() : Promise.resolve({ data: [] })
    ]);
    const userMap = {};
    userRes.data.forEach(u => userMap[u._openid] = u);
    const clothingMap = {};
    clothingRes.data.forEach(c => clothingMap[c._id] = c.name);
    list.forEach(r => {
      const u = userMap[r._openid];
      r.nickname = u ? u.nickname : '';
      r.clothingName = clothingMap[r.clothingId] || '';
    });
  }

  return ok({
    list: list.map(item => convertKeys(formatDocDates(item))),
    total: totalRes.total || 0,
    page,
    page_size: pageSize
  });
}

async function handleDeleteReview(id) {
  await db.collection('reviews').doc(id).remove();
  return ok(null);
}

async function handleReplyReview(id, body) {
  if (body.reply === undefined) return error('回复内容不能为空', 400);
  await db.collection('reviews').doc(id).update({
    data: { reply: body.reply }
  });
  return ok(null);
}

async function handleGetUsers(query) {
  const { page, pageSize, skip } = getPageParams(query);
  const keyword = query.keyword || query.nickname || query.openid || '';

  let where = {};
  if (keyword) {
    where = _.or([
      { nickname: db.RegExp({ regexp: keyword, options: 'i' }) },
      { _openid: db.RegExp({ regexp: keyword, options: 'i' }) }
    ]);
  }

  const collection = db.collection('users').where(where);
  const totalRes = await collection.count();
  const listRes = await collection.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get();

  return ok({
    list: (listRes.data || []).map(item => convertKeys(formatDocDates(item))),
    total: totalRes.total || 0,
    page,
    page_size: pageSize
  });
}

async function handleUpdateUserStatus(id, body) {
  const status = parseInt(body.status);
  if (status !== 0 && status !== 1) return error('状态值无效', 400);
  await db.collection('users').doc(id).update({
    data: { status, updateTime: db.serverDate() }
  });
  return ok(null);
}

function isCloudUrl(url) {
  return typeof url === 'string' && url.startsWith('cloud://');
}

async function handleUpload(body) {
  const { base64Image } = body || {};
  if (!base64Image) {
    return error('缺少图片数据', 400);
  }

  const base64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer || buffer.length === 0) {
    return error('图片数据无效', 400);
  }

  const extMatch = base64Image.match(/^data:image\/(\w+);base64,/);
  let ext = extMatch ? extMatch[1] : 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  const cloudPath = `admin/${Date.now()}.${ext}`;

  try {
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    });
    return ok({ fileID: uploadRes.fileID });
  } catch (e) {
    console.error('uploadFile error:', e);
    return error('图片上传失败', 500);
  }
}

async function handleResolveImage(body) {
  const { cloudUrl } = body || {};
  if (!cloudUrl) {
    return error('缺少 cloudUrl', 400);
  }
  if (!isCloudUrl(cloudUrl)) {
    return ok({ url: cloudUrl });
  }

  try {
    const result = await cloud.getTempFileURL({
      fileList: [cloudUrl]
    });
    const file = result && result.fileList && result.fileList[0];
    if (file && file.status === 0 && file.tempFileURL) {
      return ok({ url: file.tempFileURL });
    }
    console.error('getTempFileURL failed:', cloudUrl, JSON.stringify(result));
    return error('获取图片链接失败', 500);
  } catch (e) {
    console.error('getTempFileURL error:', cloudUrl, e);
    return error('获取图片链接失败', 500);
  }
}

async function handleResolveImageBatch(body) {
  let { cloudUrls } = body || {};
  if (!Array.isArray(cloudUrls)) {
    return error('cloudUrls 必须是数组', 400);
  }

  cloudUrls = [...new Set(cloudUrls.filter(u => typeof u === 'string' && isCloudUrl(u)))];
  if (cloudUrls.length === 0) {
    return ok({ urlMap: {} });
  }

  const urlMap = {};
  const BATCH_SIZE = 50;

  for (let i = 0; i < cloudUrls.length; i += BATCH_SIZE) {
    const chunk = cloudUrls.slice(i, i + BATCH_SIZE);
    try {
      const result = await cloud.getTempFileURL({
        fileList: chunk
      });
      const fileList = (result && result.fileList) || [];
      fileList.forEach(file => {
        const originalUrl = file.fileID;
        if (file.status === 0 && file.tempFileURL) {
          urlMap[originalUrl] = file.tempFileURL;
        } else {
          console.error('getTempFileURL failed for batch item:', originalUrl, JSON.stringify(file));
          urlMap[originalUrl] = originalUrl;
        }
      });
    } catch (e) {
      console.error('getTempFileURL error for batch chunk:', chunk, e);
      chunk.forEach(url => {
        urlMap[url] = url;
      });
    }
  }

  return ok({ urlMap });
}

function handleActionError(e) {
  console.error(e);
  return { success: false, message: e.message || '服务器内部错误' };
}

async function routeByAction(action, data, admin) {
  switch (action) {
    case 'login': return await handleLogin(data);
    case 'dashboard': return await handleDashboard();
    case 'getCategories': return await handleGetCategories();
    case 'createCategory': return await handleCreateCategory(data);
    case 'updateCategory': return await handleUpdateCategory(data.id, data);
    case 'deleteCategory': return await handleDeleteCategory(data.id);
    case 'getClothings': return await handleGetClothings(data);
    case 'createClothing': return await handleCreateClothing(data);
    case 'updateClothing': return await handleUpdateClothing(data.id, data);
    case 'deleteClothing': return await handleDeleteClothing(data.id);
    case 'getClothing': return await handleGetClothing(data.id);
    case 'getOrders': return await handleGetOrders(data);
    case 'getOrder': return await handleGetOrder(data.id);
    case 'updateOrderStatus': return await handleUpdateOrderStatus(data.id, data);
    case 'shipOrder': return await handleShipOrder(data.id, data);
    case 'getBanners': return await handleGetBanners();
    case 'createBanner': return await handleCreateBanner(data);
    case 'updateBanner': return await handleUpdateBanner(data.id, data);
    case 'deleteBanner': return await handleDeleteBanner(data.id);
    case 'getReviews': return await handleGetReviews(data);
    case 'deleteReview': return await handleDeleteReview(data.id);
    case 'replyReview': return await handleReplyReview(data.id, data);
    case 'getUsers': return await handleGetUsers(data);
    case 'updateUserStatus': return await handleUpdateUserStatus(data.id, data);
    case 'upload': return await handleUpload(data);
    case 'resolveImage': return await handleResolveImage(data);
    case 'resolveImageBatch': return await handleResolveImageBatch(data);
    default: return fail('接口不存在', 404);
  }
}

exports.main = async (event, context) => {
  let actionEvent = event;
  if (event.body) {
    const parsedBody = parseBody(event.body);
    if (parsedBody && parsedBody.action) {
      actionEvent = { ...event, ...parsedBody };
    }
  }
  
  if (actionEvent.action) {
    const { action, data = {} } = actionEvent;
    const token = actionEvent.token || '';
    if (action !== 'login') {
      const admin = token ? (() => { try { return verifyToken(token, JWT_SECRET); } catch (e) { return null; } })() : null;
      if (!admin) return fail('未登录或 Token 无效', 401);
      try {
        return await routeByAction(action, data, admin);
      } catch (e) {
        return handleActionError(e);
      }
    }
    try {
      return await routeByAction(action, data, null);
    } catch (e) {
      return handleActionError(e);
    }
  }

  const method = (event.httpMethod || event.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: ''
    };
  }

  const path = normalizePath(event.path);
  const query = event.queryStringParameters || event.query || {};
  const body = parseBody(event.body);

  if (body === null) {
    return error('请求体 JSON 解析失败', 400);
  }

  if (path !== '/login') {
    const admin = getAdminFromHeaders(event.headers || {});
    if (!admin) {
      return error('未登录或 Token 无效', 401);
    }
  }

  try {
    if (method === 'POST' && path === '/login') return await handleLogin(body);
    if (method === 'GET' && path === '/dashboard') return await handleDashboard();

    const categoryMatch = path.match(/^\/categories\/([^/]+)$/);
    if (method === 'GET' && path === '/categories') return await handleGetCategories();
    if (method === 'POST' && path === '/categories') return await handleCreateCategory(body);
    if (method === 'PUT' && categoryMatch) return await handleUpdateCategory(categoryMatch[1], body);
    if (method === 'DELETE' && categoryMatch) return await handleDeleteCategory(categoryMatch[1]);

    const clothingMatch = path.match(/^\/clothings\/([^/]+)$/);
    if (method === 'GET' && path === '/clothings') return await handleGetClothings(query);
    if (method === 'POST' && path === '/clothings') return await handleCreateClothing(body);
    if (method === 'PUT' && clothingMatch) return await handleUpdateClothing(clothingMatch[1], body);
    if (method === 'DELETE' && clothingMatch) return await handleDeleteClothing(clothingMatch[1]);
    if (method === 'GET' && clothingMatch) return await handleGetClothing(clothingMatch[1]);

    const orderStatusMatch = path.match(/^\/orders\/([^/]+)\/status$/);
    const orderShipMatch = path.match(/^\/orders\/([^/]+)\/ship$/);
    const orderMatch = path.match(/^\/orders\/([^/]+)$/);
    if (method === 'GET' && path === '/orders') return await handleGetOrders(query);
    if (method === 'GET' && orderMatch) return await handleGetOrder(orderMatch[1]);
    if (method === 'PUT' && orderStatusMatch) return await handleUpdateOrderStatus(orderStatusMatch[1], body);
    if (method === 'POST' && orderShipMatch) return await handleShipOrder(orderShipMatch[1], body);

    const bannerMatch = path.match(/^\/banners\/([^/]+)$/);
    if (method === 'GET' && path === '/banners') return await handleGetBanners();
    if (method === 'POST' && path === '/banners') return await handleCreateBanner(body);
    if (method === 'PUT' && bannerMatch) return await handleUpdateBanner(bannerMatch[1], body);
    if (method === 'DELETE' && bannerMatch) return await handleDeleteBanner(bannerMatch[1]);

    const reviewReplyMatch = path.match(/^\/reviews\/([^/]+)\/reply$/);
    const reviewMatch = path.match(/^\/reviews\/([^/]+)$/);
    if (method === 'GET' && path === '/reviews') return await handleGetReviews(query);
    if (method === 'DELETE' && reviewMatch) return await handleDeleteReview(reviewMatch[1]);
    if (method === 'PUT' && reviewReplyMatch) return await handleReplyReview(reviewReplyMatch[1], body);

    const userStatusMatch = path.match(/^\/users\/([^/]+)\/status$/);
    if (method === 'GET' && path === '/users') return await handleGetUsers(query);
    if (method === 'PUT' && userStatusMatch) return await handleUpdateUserStatus(userStatusMatch[1], body);

    if (method === 'POST' && path === '/upload') return await handleUpload(body);
    if (method === 'POST' && path === '/resolve-image') return await handleResolveImage(body);
    if (method === 'POST' && path === '/resolve-image/batch') return await handleResolveImageBatch(body);

    return error('接口不存在', 404);
  } catch (e) {
    console.error(e);
    return error(e.message || '服务器内部错误', 500);
  }
};
