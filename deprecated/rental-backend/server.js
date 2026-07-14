// SQL Injection Security Check: All SQL queries in this file use parameterized queries
// via the dbQuery() helper function with request.input(). No string concatenation of
// user input into SQL statements was found. Check passed on 2026-07-13.

require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

app.use(cors({
  origin: function (origin, callback) {
    // 允许本地文件访问（直接双击 HTML）和无 origin 的请求
    if (!origin || origin === 'null' || origin === 'file://') {
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // 开发环境下允许 localhost 任意端口
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalLimiter);

const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { code: 429, message: '操作过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname))
  }
});

const fileFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('只允许上传 jpg/jpeg/png/gif/webp 格式的图片'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool;

async function initPool() {
  try {
    pool = await sql.connect(config);
    console.log('Database connection pool initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database pool:', error.message);
    process.exit(1);
  }
}

function success(res, data = null, message = 'success') {
  res.json({ code: 200, data, message });
}

function fail(res, message = '服务器内部错误', code = 500) {
  res.status(code).json({ code, message });
}

async function dbQuery(queryStr, params = []) {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  const request = pool.request();
  params.forEach(param => {
    request.input(param.name, param.type, param.value);
  });
  const result = await request.query(queryStr);
  return result;
}

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail(res, '未登录或登录已过期', 401);
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return fail(res, 'Token 无效或已过期', 401);
  }
}

function userAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail(res, '未登录或登录已过期', 401);
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return fail(res, 'Token 无效或已过期', 401);
  }
}

app.post('/api/admin/login', sensitiveLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return fail(res, '用户名和密码不能为空', 400);
    }
    const result = await dbQuery(
      'SELECT * FROM [admin] WHERE username = @username AND status = 1',
      [{ name: 'username', type: sql.NVarChar, value: username }]
    );
    if (result.recordset.length === 0) {
      return fail(res, '用户名或密码错误', 401);
    }
    const admin = result.recordset[0];
    if (admin.password_hash !== password) {
      return fail(res, '用户名或密码错误', 401);
    }
    const token = jwt.sign(
      { admin_id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    const adminInfo = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      phone: admin.phone
    };
    success(res, { token, adminInfo });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/info', adminAuth, async (req, res, next) => {
  try {
    const adminId = req.admin.admin_id;
    const result = await dbQuery(
      'SELECT id, username, role, phone, status FROM [admin] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: adminId }]
    );
    if (result.recordset.length === 0) {
      return fail(res, '管理员不存在', 404);
    }
    success(res, result.recordset[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/banners', async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT * FROM [banner] WHERE status = 1 ORDER BY sort_order ASC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories', async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT * FROM [category] ORDER BY sort_order ASC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/clothing', async (req, res, next) => {
  try {
    const categoryId = req.query.category_id;
    const keyword = req.query.keyword;
    let result;
    
    if (categoryId) {
      result = await dbQuery(
        'SELECT * FROM [clothing] WHERE category_id = @categoryId AND status = 1 ORDER BY created_at DESC',
        [{ name: 'categoryId', type: sql.Int, value: categoryId }]
      );
    } else if (keyword) {
      result = await dbQuery(
        'SELECT * FROM [clothing] WHERE name LIKE @keyword AND status = 1 ORDER BY created_at DESC',
        [{ name: 'keyword', type: sql.NVarChar, value: `%${keyword}%` }]
      );
    } else {
      result = await dbQuery('SELECT * FROM [clothing] WHERE status = 1 ORDER BY created_at DESC');
    }
    
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/clothing/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await dbQuery(
      'SELECT * FROM [clothing] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
      
    if (result.recordset.length > 0) {
      success(res, result.recordset[0]);
    } else {
      fail(res, '未找到该服装', 404);
    }
  } catch (error) {
    next(error);
  }
});

// TODO: 真实微信登录接入位置
// 真实微信登录流程：
// 1. 前端调用 wx.login() 获取 code
// 2. 前端将 code 发送到后端
// 3. 后端调用微信 code2session 接口（https://api.weixin.qq.com/sns/jscode2session）
//    换取 openid 和 session_key
// 4. 后端使用 openid 查询或创建用户
// 5. 后端生成 JWT Token 返回给前端
// 当前为模拟版，使用前端传入的 openid
app.post('/api/login', sensitiveLimiter, async (req, res, next) => {
  try {
    const { openid, nickname, avatar_url } = req.body;
    
    const checkResult = await dbQuery(
      'SELECT * FROM [user] WHERE openid = @openid',
      [{ name: 'openid', type: sql.NVarChar, value: openid }]
    );

    if (checkResult.recordset.length === 0) {
      await dbQuery(
        'INSERT INTO [user] (openid, nickname, avatar_url) VALUES (@openid, @nickname, @avatar_url)',
        [
          { name: 'openid', type: sql.NVarChar, value: openid },
          { name: 'nickname', type: sql.NVarChar, value: nickname },
          { name: 'avatar_url', type: sql.NVarChar, value: avatar_url }
        ]
      );
    } else {
      await dbQuery(
        'UPDATE [user] SET nickname = @nickname, avatar_url = @avatar_url WHERE openid = @openid',
        [
          { name: 'openid', type: sql.NVarChar, value: openid },
          { name: 'nickname', type: sql.NVarChar, value: nickname },
          { name: 'avatar_url', type: sql.NVarChar, value: avatar_url }
        ]
      );
    }

    const userResult = await dbQuery(
      'SELECT id, openid, nickname, avatar_url, phone FROM [user] WHERE openid = @openid',
      [{ name: 'openid', type: sql.NVarChar, value: openid }]
    );

    const userInfo = userResult.recordset[0];
    const token = jwt.sign(
      { user_id: userInfo.id, openid: userInfo.openid },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    success(res, { token, userInfo });
  } catch (error) {
    next(error);
  }
});

app.get('/api/user/info', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const result = await dbQuery(
      'SELECT id, openid, nickname, avatar_url, phone, status FROM [user] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: userId }]
    );
    if (result.recordset.length === 0) {
      return fail(res, '用户不存在', 404);
    }
    success(res, result.recordset[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', sensitiveLimiter, userAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { items, rent_start_time, rent_end_time } = req.body;
    const userId = req.user.user_id;

    await transaction.begin();

    const orderNumbers = [];
    for (let item of items) {
      const clothingRequest = new sql.Request(transaction);
      const clothingResult = await clothingRequest
        .input('clothing_id', sql.Int, item.clothing_id)
        .query('SELECT stock, name, rent_price, deposit_amount FROM [clothing] WHERE id = @clothing_id');

      if (clothingResult.recordset.length === 0) {
        await transaction.rollback();
        return fail(res, `服装不存在`, 400);
      }

      const currentStock = clothingResult.recordset[0].stock;
      const clothingName = clothingResult.recordset[0].name;
      const dbRentPrice = parseFloat(clothingResult.recordset[0].rent_price);
      const dbDepositAmount = parseFloat(clothingResult.recordset[0].deposit_amount);
      const rentDays = item.rent_days || 1;
      const rentAmount = dbRentPrice * rentDays;
      const totalAmount = rentAmount + dbDepositAmount;

      if (currentStock <= 0) {
        await transaction.rollback();
        return fail(res, `服装 [${clothingName}] 库存不足`, 400);
      }

      const deductRequest = new sql.Request(transaction);
      await deductRequest
        .input('clothing_id', sql.Int, item.clothing_id)
        .query('UPDATE [clothing] SET stock = stock - 1 WHERE id = @clothing_id');

      const orderNo = 'ORD' + new Date().getTime() + Math.floor(Math.random() * 1000);

      const orderRequest = new sql.Request(transaction);
      await orderRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('user_id', sql.Int, userId)
        .input('clothing_id', sql.Int, item.clothing_id)
        .input('selected_spec', sql.NVarChar, item.spec)
        .input('rent_start_time', sql.DateTime, new Date(rent_start_time))
        .input('rent_end_time', sql.DateTime, new Date(rent_end_time))
        .input('rent_amount', sql.Decimal(10,2), rentAmount)
        .input('deposit_amount', sql.Decimal(10,2), dbDepositAmount)
        .input('total_amount', sql.Decimal(10,2), totalAmount)
        .query('INSERT INTO [orders] (order_no, user_id, clothing_id, selected_spec, rent_start_time, rent_end_time, rent_amount, deposit_amount, total_amount, status) VALUES (@order_no, @user_id, @clothing_id, @selected_spec, @rent_start_time, @rent_end_time, @rent_amount, @deposit_amount, @total_amount, 0)');
      
      const depositRequest = new sql.Request(transaction);
      await depositRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('user_id', sql.Int, userId)
        .input('deposit_amount', sql.Decimal(10,2), item.deposit_amount)
        .query('INSERT INTO [deposit_flow] (order_no, user_id, amount, flow_type, status, remark) VALUES (@order_no, @user_id, @deposit_amount, 1, 1, N\'支付押金\')');

      orderNumbers.push(orderNo);
    }

    await transaction.commit();
    success(res, orderNumbers);
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    next(error);
  }
});

app.get('/api/orders', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;

    const ordersResult = await dbQuery(
      'SELECT o.*, c.name, c.main_image FROM [orders] o LEFT JOIN [clothing] c ON o.clothing_id = c.id WHERE o.user_id = @user_id ORDER BY o.created_at DESC',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );

    success(res, ordersResult.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:order_no', userAuth, async (req, res, next) => {
  try {
    const orderNo = req.params.order_no;
    const userId = req.user.user_id;
    const result = await dbQuery(
      'SELECT o.*, c.name, c.main_image, c.rent_price as original_price FROM [orders] o LEFT JOIN [clothing] c ON o.clothing_id = c.id WHERE o.order_no = @orderNo',
      [{ name: 'orderNo', type: sql.NVarChar, value: orderNo }]
    );

    if (result.recordset.length === 0) {
      return fail(res, '订单不存在', 404);
    }

    const order = result.recordset[0];
    if (order.user_id !== userId) {
      return fail(res, '无权限查看此订单', 403);
    }

    success(res, order);
  } catch (error) {
    next(error);
  }
});

const validTransitions = {
  0: [1, 5],
  1: [2],
  2: [3],
  3: [4],
  4: [],
  5: []
};

function isValidStatusTransition(oldStatus, newStatus) {
  const allowed = validTransitions[oldStatus];
  return allowed && allowed.includes(newStatus);
}

app.put('/api/orders/:order_no/status', userAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const orderNo = req.params.order_no;
    const { status } = req.body;
    const userId = req.user.user_id;

    if (status < 0 || status > 5) {
      return fail(res, '订单状态无效', 400);
    }

    await transaction.begin();

    const orderRequest = new sql.Request(transaction);
    const orderResult = await orderRequest
      .input('order_no', sql.NVarChar, orderNo)
      .query('SELECT * FROM [orders] WHERE order_no = @order_no');

    if (orderResult.recordset.length === 0) {
      await transaction.rollback();
      return fail(res, '订单不存在', 404);
    }

    const order = orderResult.recordset[0];
    if (order.user_id !== userId) {
      await transaction.rollback();
      return fail(res, '无权限操作此订单', 403);
    }

    const oldStatus = order.status;
    const clothingId = order.clothing_id;

    if (!isValidStatusTransition(oldStatus, status)) {
      await transaction.rollback();
      return fail(res, '订单状态流转不合法', 400);
    }

    const updateRequest = new sql.Request(transaction);
    if (status === 4) {
      await updateRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('status', sql.TinyInt, status)
        .query('UPDATE [orders] SET status = @status, actual_return_time = GETDATE() WHERE order_no = @order_no');
    } else {
      await updateRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('status', sql.TinyInt, status)
        .query('UPDATE [orders] SET status = @status WHERE order_no = @order_no');
    }
      
    if (status === 4) {
      const depositRequest = new sql.Request(transaction);
      await depositRequest
        .input('order_no', sql.NVarChar, orderNo)
        .query('INSERT INTO [deposit_flow] (order_no, user_id, amount, flow_type, status, remark) SELECT order_no, user_id, deposit_amount, 2, 1, N\'退还押金\' FROM [orders] WHERE order_no = @order_no');
    }

    if (status === 5 && oldStatus < 4) {
      const stockRequest = new sql.Request(transaction);
      await stockRequest
        .input('clothing_id', sql.Int, clothingId)
        .query('UPDATE [clothing] SET stock = stock + 1 WHERE id = @clothing_id');
    }
      
    await transaction.commit();
    success(res);
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    next(error);
  }
});

// ==================== 支付相关接口 ====================
// TODO: 真实微信支付接入位置参考 wx.requestPayment 和微信支付 API 文档
// 真实微信支付流程：
// 1. 后端调用微信支付统一下单接口，获取 prepay_id
// 2. 后端返回支付参数给前端（timeStamp, nonceStr, package, signType, paySign）
// 3. 前端调用 wx.requestPayment 发起支付
// 4. 微信支付后台异步通知后端支付结果
// 5. 后端校验支付结果，更新订单状态

app.post('/api/pay/mock', sensitiveLimiter, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { order_no } = req.body;

    if (!order_no) {
      return fail(res, '订单号不能为空', 400);
    }

    await transaction.begin();

    const orderRequest = new sql.Request(transaction);
    const orderResult = await orderRequest
      .input('order_no', sql.NVarChar, order_no)
      .query('SELECT * FROM [orders] WHERE order_no = @order_no');

    if (orderResult.recordset.length === 0) {
      await transaction.rollback();
      return fail(res, '订单不存在', 404);
    }

    const order = orderResult.recordset[0];

    // 校验订单状态是否为待支付（status=0）
    if (order.status !== 0) {
      await transaction.rollback();
      return fail(res, '订单状态不正确，无法支付', 400);
    }

    // 模拟支付成功，更新订单状态为待发货（status=1）
    // TODO: 这里是模拟支付，真实微信支付接入位置
    // 真实场景中，这里应该调用微信支付 API 进行下单，
    // 然后在支付回调中更新订单状态
    const updateRequest = new sql.Request(transaction);
    await updateRequest
      .input('order_no', sql.NVarChar, order_no)
      .input('status', sql.TinyInt, 1)
      .query('UPDATE [orders] SET status = @status, paid_at = GETDATE() WHERE order_no = @order_no');

    await transaction.commit();

    success(res, {
      order_no: order_no,
      status: 1,
      pay_time: new Date().toISOString()
    }, '支付成功');
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    next(error);
  }
});

app.post('/api/reviews', userAuth, async (req, res, next) => {
  try {
    const { order_no, clothing_id, rating, content, images } = req.body;
    const userId = req.user.user_id;
    await dbQuery(
      'INSERT INTO [review] (order_no, user_id, clothing_id, rating, content, images) VALUES (@order_no, @user_id, @clothing_id, @rating, @content, @images)',
      [
        { name: 'order_no', type: sql.NVarChar, value: order_no },
        { name: 'user_id', type: sql.Int, value: userId },
        { name: 'clothing_id', type: sql.Int, value: clothing_id },
        { name: 'rating', type: sql.TinyInt, value: rating },
        { name: 'content', type: sql.NVarChar, value: content },
        { name: 'images', type: sql.NVarChar, value: JSON.stringify(images || []) }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/reviews', async (req, res, next) => {
  try {
    const clothingId = req.query.clothing_id;
    const result = await dbQuery(
      'SELECT r.*, u.nickname, u.avatar_url FROM [review] r LEFT JOIN [user] u ON r.user_id = u.id WHERE r.clothing_id = @clothing_id ORDER BY r.created_at DESC',
      [{ name: 'clothing_id', type: sql.Int, value: clothingId }]
    );
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/favorites/check', userAuth, async (req, res, next) => {
  try {
    const { clothing_id } = req.query;
    const userId = req.user.user_id;
    
    const favResult = await dbQuery(
      'SELECT id FROM [favorite] WHERE user_id = @user_id AND clothing_id = @clothing_id',
      [
        { name: 'user_id', type: sql.Int, value: userId },
        { name: 'clothing_id', type: sql.Int, value: clothing_id }
      ]
    );
      
    success(res, favResult.recordset.length > 0);
  } catch (error) {
    next(error);
  }
});

app.post('/api/favorites/toggle', userAuth, async (req, res, next) => {
  try {
    const { clothing_id } = req.body;
    const userId = req.user.user_id;
    
    const favResult = await dbQuery(
      'SELECT id FROM [favorite] WHERE user_id = @user_id AND clothing_id = @clothing_id',
      [
        { name: 'user_id', type: sql.Int, value: userId },
        { name: 'clothing_id', type: sql.Int, value: clothing_id }
      ]
    );
      
    if (favResult.recordset.length > 0) {
      await dbQuery(
        'DELETE FROM [favorite] WHERE id = @id',
        [{ name: 'id', type: sql.Int, value: favResult.recordset[0].id }]
      );
      success(res, false, '取消收藏成功');
    } else {
      await dbQuery(
        'INSERT INTO [favorite] (user_id, clothing_id) VALUES (@user_id, @clothing_id)',
        [
          { name: 'user_id', type: sql.Int, value: userId },
          { name: 'clothing_id', type: sql.Int, value: clothing_id }
        ]
      );
      success(res, true, '收藏成功');
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/favorites', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;

    const favsResult = await dbQuery(
      'SELECT f.id as fav_id, c.* FROM [favorite] f INNER JOIN [clothing] c ON f.clothing_id = c.id WHERE f.user_id = @user_id ORDER BY f.created_at DESC',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );

    success(res, favsResult.recordset);
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(res, '文件大小不能超过 5MB', 400);
      }
      return fail(res, '文件上传错误: ' + err.message, 400);
    } else if (err) {
      return fail(res, err.message || '文件上传失败', 400);
    }
    if (!req.file) {
      return fail(res, '无文件上传', 400);
    }
    const fileUrl = `${process.env.UPLOAD_BASE_URL}/uploads/${req.file.filename}`;
    success(res, fileUrl);
  });
});

app.get('/api/addresses', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const result = await dbQuery(
      'SELECT * FROM [address] WHERE user_id = @user_id ORDER BY is_default DESC, created_at DESC',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.post('/api/addresses', userAuth, async (req, res, next) => {
  try {
    const { consignee, phone, detailed_address, is_default } = req.body;
    const userId = req.user.user_id;
    if (is_default === 1) {
      await dbQuery(
        'UPDATE [address] SET is_default = 0 WHERE user_id = @user_id',
        [{ name: 'user_id', type: sql.Int, value: userId }]
      );
    }
    await dbQuery(
      'INSERT INTO [address] (user_id, consignee, phone, detailed_address, is_default) VALUES (@user_id, @consignee, @phone, @detailed_address, @is_default)',
      [
        { name: 'user_id', type: sql.Int, value: userId },
        { name: 'consignee', type: sql.NVarChar, value: consignee },
        { name: 'phone', type: sql.NVarChar, value: phone },
        { name: 'detailed_address', type: sql.NVarChar, value: detailed_address },
        { name: 'is_default', type: sql.TinyInt, value: is_default || 0 }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/addresses/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await dbQuery(
      'SELECT * FROM [address] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    if (result.recordset.length > 0) {
      success(res, result.recordset[0]);
    } else {
      fail(res, '地址不存在', 404);
    }
  } catch (error) {
    next(error);
  }
});

app.put('/api/addresses/:id', userAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { consignee, phone, detailed_address, is_default } = req.body;
    const userId = req.user.user_id;
    
    const addressResult = await dbQuery(
      'SELECT * FROM [address] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    
    if (addressResult.recordset.length === 0) {
      return fail(res, '地址不存在', 404);
    }
    
    if (addressResult.recordset[0].user_id !== userId) {
      return fail(res, '无权限操作此地址', 403);
    }
    
    if (is_default === 1) {
      await dbQuery(
        'UPDATE [address] SET is_default = 0 WHERE user_id = @user_id',
        [{ name: 'user_id', type: sql.Int, value: userId }]
      );
    }
    await dbQuery(
      'UPDATE [address] SET consignee = @consignee, phone = @phone, detailed_address = @detailed_address, is_default = @is_default WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'consignee', type: sql.NVarChar, value: consignee },
        { name: 'phone', type: sql.NVarChar, value: phone },
        { name: 'detailed_address', type: sql.NVarChar, value: detailed_address },
        { name: 'is_default', type: sql.TinyInt, value: is_default }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/addresses/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    await dbQuery(
      'DELETE FROM [address] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/deposit/summary', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const frozenResult = await dbQuery(
      'SELECT SUM(deposit_amount) as total FROM [orders] WHERE user_id = @user_id AND status IN (0, 1, 2, 3)',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );
    const refundResult = await dbQuery(
      'SELECT SUM(amount) as total FROM [deposit_flow] WHERE user_id = @user_id AND flow_type = 2 AND status = 1',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );
    success(res, {
      frozen: frozenResult.recordset[0].total || 0,
      refunded: refundResult.recordset[0].total || 0
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/deposit/records', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const result = await dbQuery(
      'SELECT * FROM [deposit_flow] WHERE user_id = @user_id ORDER BY created_at DESC',
      [{ name: 'user_id', type: sql.Int, value: userId }]
    );
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/dashboard', adminAuth, async (req, res, next) => {
  try {
    const userCount = await dbQuery('SELECT COUNT(*) as count FROM [user]');
    const clothingCount = await dbQuery('SELECT COUNT(*) as count FROM [clothing]');
    const orderCount = await dbQuery('SELECT COUNT(*) as count FROM [orders]');
    const moneyResult = await dbQuery('SELECT SUM(rent_amount) as total FROM [orders] WHERE status = 4');
    success(res, {
      users: userCount.recordset[0].count,
      clothings: clothingCount.recordset[0].count,
      orders: orderCount.recordset[0].count,
      revenue: moneyResult.recordset[0].total || 0
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/clothing', adminAuth, async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT c.*, cat.name as category_name FROM [clothing] c LEFT JOIN [category] cat ON c.category_id = cat.id ORDER BY c.created_at DESC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/clothing', adminAuth, async (req, res, next) => {
  try {
    const { name, category_id, main_image, rent_price, deposit_amount, specs, status, stock } = req.body;
    await dbQuery(
      'INSERT INTO [clothing] (name, category_id, main_image, rent_price, deposit_amount, specs, status, stock) VALUES (@name, @category_id, @main_image, @rent_price, @deposit_amount, @specs, @status, @stock)',
      [
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'category_id', type: sql.Int, value: category_id },
        { name: 'main_image', type: sql.NVarChar, value: main_image },
        { name: 'rent_price', type: sql.Decimal(10,2), value: rent_price },
        { name: 'deposit_amount', type: sql.Decimal(10,2), value: deposit_amount },
        { name: 'specs', type: sql.NVarChar, value: JSON.stringify(specs) },
        { name: 'status', type: sql.TinyInt, value: status },
        { name: 'stock', type: sql.Int, value: stock || 0 }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/clothing/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { name, category_id, main_image, rent_price, deposit_amount, specs, status, stock } = req.body;
    await dbQuery(
      'UPDATE [clothing] SET name = @name, category_id = @category_id, main_image = @main_image, rent_price = @rent_price, deposit_amount = @deposit_amount, specs = @specs, status = @status, stock = @stock WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'category_id', type: sql.Int, value: category_id },
        { name: 'main_image', type: sql.NVarChar, value: main_image },
        { name: 'rent_price', type: sql.Decimal(10,2), value: rent_price },
        { name: 'deposit_amount', type: sql.Decimal(10,2), value: deposit_amount },
        { name: 'specs', type: sql.NVarChar, value: JSON.stringify(specs) },
        { name: 'status', type: sql.TinyInt, value: status },
        { name: 'stock', type: sql.Int, value: stock || 0 }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/clothing/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;

    const orderResult = await dbQuery(
      'SELECT COUNT(*) as count FROM [orders] WHERE clothing_id = @id AND status < 4',
      [{ name: 'id', type: sql.Int, value: id }]
    );

    if (orderResult.recordset[0].count > 0) {
      return fail(res, '该服装存在未完成订单，不允许删除', 400);
    }

    await dbQuery(
      'DELETE FROM [clothing] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/categories', adminAuth, async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT * FROM [category] ORDER BY sort_order ASC, id ASC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/categories', adminAuth, async (req, res, next) => {
  try {
    const { name, sort_order } = req.body;
    if (!name) {
      return fail(res, '分类名称不能为空', 400);
    }
    await dbQuery(
      'INSERT INTO [category] (name, sort_order) VALUES (@name, @sort_order)',
      [
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'sort_order', type: sql.Int, value: sort_order || 0 }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/categories/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { name, sort_order } = req.body;
    if (!name) {
      return fail(res, '分类名称不能为空', 400);
    }
    await dbQuery(
      'UPDATE [category] SET name = @name, sort_order = @sort_order WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'sort_order', type: sql.Int, value: sort_order || 0 }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/categories/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;

    const clothingResult = await dbQuery(
      'SELECT COUNT(*) as count FROM [clothing] WHERE category_id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );

    if (clothingResult.recordset[0].count > 0) {
      return fail(res, '该分类下存在关联服装，不允许删除', 400);
    }

    await dbQuery(
      'DELETE FROM [category] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', adminAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 10;
    const keyword = req.query.keyword || '';

    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const params = [];

    if (keyword) {
      whereClause = 'WHERE nickname LIKE @keyword';
      params.push({ name: 'keyword', type: sql.NVarChar, value: `%${keyword}%` });
    }

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM [user] ${whereClause}`,
      params
    );

    const listParams = [...params];
    listParams.push({ name: 'offset', type: sql.Int, value: offset });
    listParams.push({ name: 'pageSize', type: sql.Int, value: pageSize });

    const listResult = await dbQuery(
      `SELECT id, nickname, avatar_url, phone, status, created_at FROM [user] ${whereClause} ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      listParams
    );

    success(res, {
      list: listResult.recordset,
      total: countResult.recordset[0].total,
      page: page,
      page_size: pageSize
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/users/:id/status', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (status !== 0 && status !== 1) {
      return fail(res, '状态值无效', 400);
    }

    await dbQuery(
      'UPDATE [user] SET status = @status WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'status', type: sql.TinyInt, value: status }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders', adminAuth, async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT o.*, u.nickname, u.phone as user_phone, c.name as clothing_name FROM [orders] o LEFT JOIN [user] u ON o.user_id = u.id LEFT JOIN [clothing] c ON o.clothing_id = c.id ORDER BY o.created_at DESC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/orders/:order_no/ship', adminAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const orderNo = req.params.order_no;
    const { express_no } = req.body;

    if (!express_no) {
      return fail(res, '快递单号不能为空', 400);
    }

    await transaction.begin();

    const orderRequest = new sql.Request(transaction);
    const orderResult = await orderRequest
      .input('order_no', sql.NVarChar, orderNo)
      .query('SELECT * FROM [orders] WHERE order_no = @order_no');

    if (orderResult.recordset.length === 0) {
      await transaction.rollback();
      return fail(res, '订单不存在', 404);
    }

    const oldStatus = orderResult.recordset[0].status;

    if (oldStatus !== 1) {
      await transaction.rollback();
      return fail(res, '只有待发货状态的订单才能发货', 400);
    }

    const updateRequest = new sql.Request(transaction);
    await updateRequest
      .input('order_no', sql.NVarChar, orderNo)
      .input('express_no', sql.NVarChar, express_no)
      .input('status', sql.TinyInt, 2)
      .query('UPDATE [orders] SET status = @status, express_no = @express_no WHERE order_no = @order_no');

    await transaction.commit();
    success(res);
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    next(error);
  }
});

app.get('/api/admin/reviews', adminAuth, async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT r.*, u.nickname, c.name as clothing_name FROM [review] r LEFT JOIN [user] u ON r.user_id = u.id LEFT JOIN [clothing] c ON r.clothing_id = c.id ORDER BY r.created_at DESC');
    success(res, result.recordset);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/reviews/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    await dbQuery(
      'DELETE FROM [review] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/banners', adminAuth, async (req, res, next) => {
  try {
    const { title, image_url, target_link, sort_order, status } = req.body;
    await dbQuery(
      'INSERT INTO [banner] (title, image_url, target_link, sort_order, status) VALUES (@title, @image_url, @target_link, @sort_order, @status)',
      [
        { name: 'title', type: sql.NVarChar, value: title },
        { name: 'image_url', type: sql.NVarChar, value: image_url },
        { name: 'target_link', type: sql.NVarChar, value: target_link },
        { name: 'sort_order', type: sql.Int, value: sort_order },
        { name: 'status', type: sql.TinyInt, value: status }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/banners/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    await dbQuery(
      'DELETE FROM [banner] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: id }]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  fail(res, '接口不存在', 404);
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  fail(res, err.message || '服务器内部错误', 500);
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initPool();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
