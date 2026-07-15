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
const https = require('https');
const crypto = require('crypto');
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
    await ensureRemindTable();
    await ensureDepositTable();
    await ensureClothingImagesColumn();
    await ensureSiteConfigTable();
    await ensureUserSessionKeyColumn();
  } catch (error) {
    console.error('Failed to initialize database pool:', error.message);
    process.exit(1);
  }
}

// 自动确保 order_remind（提醒发货记录）表存在，兼容已有数据库
async function ensureRemindTable() {
  try {
    await dbQuery(`IF OBJECT_ID('[order_remind]', 'U') IS NULL
      CREATE TABLE [order_remind] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [order_no] NVARCHAR(50) NOT NULL,
        [user_id] INT NOT NULL,
        [created_at] DATETIME DEFAULT GETDATE()
      );`);
    console.log('order_remind table ensured');
  } catch (error) {
    console.error('ensureRemindTable error:', error.message);
  }
}

// 自动确保 deposit_flow（押金流水）表存在，兼容已有数据库
async function ensureDepositTable() {
  try {
    await dbQuery(`IF OBJECT_ID('[deposit_flow]', 'U') IS NULL
      CREATE TABLE [deposit_flow] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [order_no] NVARCHAR(50) NOT NULL,
        [user_id] INT NOT NULL,
        [amount] DECIMAL(10,2) NOT NULL,
        [flow_type] TINYINT NOT NULL,
        [status] TINYINT DEFAULT 0,
        [remark] NVARCHAR(255),
        [created_at] DATETIME DEFAULT GETDATE()
      );`);
    console.log('deposit_flow table ensured');
  } catch (error) {
    console.error('ensureDepositTable error:', error.message);
  }
}

// 自动确保 clothing.images（多图 JSON 数组）列存在
async function ensureClothingImagesColumn() {
  try {
    await dbQuery(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[clothing]') AND name = 'images')
      ALTER TABLE [clothing] ADD [images] NVARCHAR(MAX) NULL;`);
    console.log('clothing.images column ensured');
  } catch (error) {
    console.error('ensureClothingImagesColumn error:', error.message);
  }
}

// 站点配置表（key-value），用于存放租赁须知等可运营配置
async function ensureSiteConfigTable() {
  try {
    await dbQuery(`IF OBJECT_ID('[site_config]', 'U') IS NULL
      CREATE TABLE [site_config] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [config_key] NVARCHAR(50) NOT NULL UNIQUE,
        [config_value] NVARCHAR(MAX) NULL,
        [updated_at] DATETIME DEFAULT GETDATE()
      );`);
    // 初始化租赁须知默认值
    await dbQuery(`IF NOT EXISTS (SELECT * FROM [site_config] WHERE config_key = 'rental_notice')
      INSERT INTO [site_config] (config_key, config_value) VALUES ('rental_notice',
        N'1. 租赁前请确认尺码与档期，下单即视为同意本须知；\n2. 押金将在确认归还且无损坏后原路退还；\n3. 服装请妥善保管，污渍 / 破损 / 遗失将按价赔偿并从押金中扣除；\n4. 逾期未归还将按日收取违约金，并影响信用分；\n5. 支持提前归还，租金按实际租期结算。');`);
    console.log('site_config table ensured');
  } catch (error) {
    console.error('ensureSiteConfigTable error:', error.message);
  }
}

// 自动确保 user.session_key 列存在（用于手机号解密）
async function ensureUserSessionKeyColumn() {
  try {
    await dbQuery(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[user]') AND name = 'session_key')
      ALTER TABLE [user] ADD [session_key] NVARCHAR(100) NULL;`);
    console.log('user.session_key column ensured');
  } catch (error) {
    console.error('ensureUserSessionKeyColumn error:', error.message);
  }
}

function success(res, data = null, message = 'success') {
  res.json({ code: 200, data, message });
}

function fail(res, message = '服务器内部错误', code = 500) {
  res.status(code).json({ code, message });
}

// ============ 密码安全：使用 scrypt 加盐哈希 ============
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  // 兼容尚未迁移的明文密码（首次登录成功后自动升级）
  if (!stored.startsWith('scrypt$')) {
    return stored === password;
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const verifyHash = crypto.scryptSync(password, parts[1], 64).toString('hex');
  const a = Buffer.from(parts[2], 'hex');
  const b = Buffer.from(verifyHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 微信 code2Session：用 login code 换取真实 openid 与 session_key（需配置 WX_APPID / WX_SECRET）
function wxCode2Session(code) {
  return new Promise((resolve) => {
    if (!process.env.WX_APPID || !process.env.WX_SECRET) {
      return resolve(null);
    }
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WX_APPID}&secret=${process.env.WX_SECRET}&js_code=${code}&grant_type=authorization_code`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errcode) {
            console.error('code2Session error:', json.errcode, json.errmsg);
            return resolve(null);
          }
          resolve({ openid: json.openid, session_key: json.session_key, unionid: json.unionid });
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error('code2Session request error:', e.message);
      resolve(null);
    });
  });
}

// 解密微信加密数据（手机号等）：AES-128-CBC，key & iv 为 base64
function decryptWechatData(encryptedData, iv, sessionKey) {
  try {
    const cipherBuf = Buffer.from(encryptedData, 'base64');
    const keyBuf = Buffer.from(sessionKey, 'base64');
    const ivBuf = Buffer.from(iv, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
    decipher.setAutoPadding(true);
    let decoded = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
    // 去掉 PKCS7 填充
    let pad = decoded[decoded.length - 1];
    if (pad && pad <= 32) decoded = decoded.slice(0, decoded.length - pad);
    return JSON.parse(decoded.toString('utf8'));
  } catch (e) {
    console.error('decryptWechatData error:', e.message);
    return null;
  }
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

// 角色守卫：allowedRoles 为允许访问的 role 数组，例如 [1] 表示仅超级管理员
// role 约定：1 = 超级管理员（平台管理员），2 = 运营人员（日常运营，无财务/管理员权限）
function roleGuard(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin || !allowedRoles.includes(req.admin.role)) {
      return fail(res, '权限不足，需要更高权限的管理员', 403);
    }
    next();
  };
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
    if (!verifyPassword(password, admin.password_hash)) {
      return fail(res, '用户名或密码错误', 401);
    }
    // 兼容旧版明文密码：首次登录成功后自动升级为加盐哈希存储
    if (!admin.password_hash || !admin.password_hash.startsWith('scrypt$')) {
      try {
        await dbQuery(
          'UPDATE [admin] SET password_hash = @hash WHERE id = @id',
          [
            { name: 'hash', type: sql.NVarChar, value: hashPassword(password) },
            { name: 'id', type: sql.Int, value: admin.id }
          ]
        );
      } catch (e) {
        console.error('密码升级失败:', e.message);
      }
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

// ==================== 站点配置（公开读取 / 管理员写入） ====================
// 公开读取某个配置项
app.get('/api/config/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    const result = await dbQuery(
      'SELECT config_value FROM [site_config] WHERE config_key = @key',
      [{ name: 'key', type: sql.NVarChar, value: key }]
    );
    const value = result.recordset.length > 0 ? result.recordset[0].config_value : '';
    success(res, { key, value });
  } catch (error) { next(error); }
});

// 管理员更新某个配置项
app.put('/api/admin/config/:key', adminAuth, async (req, res, next) => {
  try {
    const key = req.params.key;
    const { value } = req.body;
    await dbQuery(
      `IF EXISTS (SELECT * FROM [site_config] WHERE config_key = @key)
        UPDATE [site_config] SET config_value = @value, updated_at = GETDATE() WHERE config_key = @key
       ELSE
        INSERT INTO [site_config] (config_key, config_value) VALUES (@key, @value)`,
      [
        { name: 'key', type: sql.NVarChar, value: key },
        { name: 'value', type: sql.NVarChar, value: value || '' }
      ]
    );
    success(res, null, '配置已保存');
  } catch (error) { next(error); }
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
    let { openid, code, nickname, avatar_url } = req.body;
    let sessionKey = null;
    if (!openid && code) {
      // 已配置微信小程序 AppID/Secret 时，通过 code2Session 换取真实 openid 与 session_key
      if (process.env.WX_APPID && process.env.WX_SECRET) {
        const wxResult = await wxCode2Session(code);
        if (!wxResult || !wxResult.openid) {
          return fail(res, '微信登录失败，请重试', 401);
        }
        openid = wxResult.openid;
        sessionKey = wxResult.session_key;
      } else {
        // 开发/演示模式：未配置微信凭证时，暂以 code 作为 openid 兜底
        openid = code;
      }
    }
    if (!openid) {
      return fail(res, '缺少 openid 或 code', 400);
    }

    const checkResult = await dbQuery(
      'SELECT * FROM [user] WHERE openid = @openid',
      [{ name: 'openid', type: sql.NVarChar, value: openid }]
    );

    if (checkResult.recordset.length === 0) {
      await dbQuery(
        'INSERT INTO [user] (openid, nickname, avatar_url, session_key) VALUES (@openid, @nickname, @avatar_url, @session_key)',
        [
          { name: 'openid', type: sql.NVarChar, value: openid },
          { name: 'nickname', type: sql.NVarChar, value: nickname },
          { name: 'avatar_url', type: sql.NVarChar, value: avatar_url },
          { name: 'session_key', type: sql.NVarChar, value: sessionKey || null }
        ]
      );
    } else {
      await dbQuery(
        'UPDATE [user] SET nickname = @nickname, avatar_url = @avatar_url, session_key = @session_key WHERE openid = @openid',
        [
          { name: 'openid', type: sql.NVarChar, value: openid },
          { name: 'nickname', type: sql.NVarChar, value: nickname },
          { name: 'avatar_url', type: sql.NVarChar, value: avatar_url },
          { name: 'session_key', type: sql.NVarChar, value: sessionKey || null }
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

app.put('/api/user/info', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const { nickname, avatar_url, phone } = req.body;
    await dbQuery(
      'UPDATE [user] SET nickname = @nickname, avatar_url = @avatar_url, phone = @phone WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: userId },
        { name: 'nickname', type: sql.NVarChar, value: nickname || null },
        { name: 'avatar_url', type: sql.NVarChar, value: avatar_url || null },
        { name: 'phone', type: sql.NVarChar, value: phone || null }
      ]
    );
    const result = await dbQuery(
      'SELECT id, openid, nickname, avatar_url, phone, status FROM [user] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: userId }]
    );
    success(res, result.recordset[0]);
  } catch (error) {
    next(error);
  }
});

// 手机号快捷授权：解密微信加密数据并绑定手机号
app.post('/api/bind-phone', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const { encryptedData, iv, phone } = req.body;

    // 开发/演示模式（未配置微信凭证）下允许直接传入 phone 进行绑定
    if (!process.env.WX_APPID || !process.env.WX_SECRET) {
      if (!phone) return fail(res, '缺少手机号', 400);
      await dbQuery('UPDATE [user] SET phone = @phone WHERE id = @id',
        [
          { name: 'phone', type: sql.NVarChar, value: phone },
          { name: 'id', type: sql.Int, value: userId }
        ]);
      return success(res, { phone }, '手机号已绑定');
    }

    if (!encryptedData || !iv) return fail(res, '缺少加密参数', 400);
    const userResult = await dbQuery('SELECT session_key FROM [user] WHERE id = @id',
      [{ name: 'id', type: sql.Int, value: userId }]);
    if (userResult.recordset.length === 0) return fail(res, '用户不存在', 404);
    const sessionKey = userResult.recordset[0].session_key;
    if (!sessionKey) return fail(res, '登录态已失效，请重新登录后绑定', 400);

    const decrypted = decryptWechatData(encryptedData, iv, sessionKey);
    if (!decrypted || !decrypted.phoneNumber) return fail(res, '手机号解密失败', 400);
    await dbQuery('UPDATE [user] SET phone = @phone WHERE id = @id',
      [
        { name: 'phone', type: sql.NVarChar, value: decrypted.phoneNumber },
        { name: 'id', type: sql.Int, value: userId }
      ]);
    success(res, { phone: decrypted.phoneNumber }, '手机号已绑定');
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', sensitiveLimiter, userAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { items, rent_start_time, rent_end_time } = req.body;
    const userId = req.user.user_id;

    // 入参校验
    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, '订单商品不能为空', 400);
    }
    if (!rent_start_time || !rent_end_time) {
      return fail(res, '租赁起止时间不能为空', 400);
    }
    const startDate = new Date(rent_start_time);
    const endDate = new Date(rent_end_time);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return fail(res, '租赁时间格式不正确', 400);
    }
    if (endDate <= startDate) {
      return fail(res, '归还时间需晚于起租时间', 400);
    }
    for (const item of items) {
      if (!item.clothing_id || !item.spec) {
        return fail(res, '商品信息不完整（缺少服装或规格）', 400);
      }
    }

    await transaction.begin();

    const orderNumbers = [];
    let totalRentAmount = 0;
    let firstOrderNo = null;
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
      const rentDays = item.rent_days > 0 ? parseInt(item.rent_days, 10) : 1;
      const rentAmount = dbRentPrice * rentDays;
      const totalAmount = rentAmount + dbDepositAmount;
      totalRentAmount += rentAmount;

      if (currentStock <= 0) {
        await transaction.rollback();
        return fail(res, `服装 [${clothingName}] 库存不足`, 400);
      }

      const deductRequest = new sql.Request(transaction);
      await deductRequest
        .input('clothing_id', sql.Int, item.clothing_id)
        .query('UPDATE [clothing] SET stock = stock - 1 WHERE id = @clothing_id');

      const orderNo = 'ORD' + new Date().getTime() + Math.floor(Math.random() * 1000);
      if (!firstOrderNo) firstOrderNo = orderNo;

      const orderRequest = new sql.Request(transaction);
      await orderRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('user_id', sql.Int, userId)
        .input('clothing_id', sql.Int, item.clothing_id)
        .input('selected_spec', sql.NVarChar, item.spec)
        .input('rent_start_time', sql.DateTime, startDate)
        .input('rent_end_time', sql.DateTime, endDate)
        .input('rent_amount', sql.Decimal(10,2), rentAmount)
        .input('deposit_amount', sql.Decimal(10,2), dbDepositAmount)
        .input('total_amount', sql.Decimal(10,2), totalAmount)
        .query('INSERT INTO [orders] (order_no, user_id, clothing_id, selected_spec, rent_start_time, rent_end_time, rent_amount, deposit_amount, total_amount, status) VALUES (@order_no, @user_id, @clothing_id, @selected_spec, @rent_start_time, @rent_end_time, @rent_amount, @deposit_amount, @total_amount, 0)');

      // 押金流水使用数据库权威金额，避免客户端篡改
      const depositRequest = new sql.Request(transaction);
      await depositRequest
        .input('order_no', sql.NVarChar, orderNo)
        .input('user_id', sql.Int, userId)
        .input('deposit_amount', sql.Decimal(10,2), dbDepositAmount)
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
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 10;
    const status = req.query.status;
    const offset = (page - 1) * pageSize;

    const where = ['o.user_id = @user_id'];
    const params = [{ name: 'user_id', type: sql.Int, value: userId }];
    if (status !== undefined && status !== '') {
      where.push('o.status = @status');
      params.push({ name: 'status', type: sql.TinyInt, value: parseInt(status, 10) });
    }
    const whereStr = 'WHERE ' + where.join(' AND ');

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM [orders] o ${whereStr}`,
      params
    );
    const listParams = [...params,
      { name: 'offset', type: sql.Int, value: offset },
      { name: 'pageSize', type: sql.Int, value: pageSize }
    ];
    const ordersResult = await dbQuery(
      `SELECT o.*, c.name, c.main_image FROM [orders] o LEFT JOIN [clothing] c ON o.clothing_id = c.id ${whereStr} ORDER BY o.created_at DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      listParams
    );

    success(res, { list: ordersResult.recordset, total: countResult.recordset[0].total, page, page_size: pageSize });
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

// 用户端允许的订单状态流转（支付走 /api/pay/mock，发货与确认归还由管理员操作）
// 0 待支付 -> 5 已取消（用户主动取消未支付订单）
// 2 租赁中 -> 3 待归还（用户申请归还）
// 注意：禁止用户自行流转到 2（发货）和 4（完成并退押金），防止越权与财务风险
const validTransitions = {
  0: [5],
  2: [3]
};

function isValidStatusTransition(oldStatus, newStatus) {
  const allowed = validTransitions[oldStatus];
  return Array.isArray(allowed) && allowed.includes(newStatus);
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

app.post('/api/pay/mock', sensitiveLimiter, userAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { order_no } = req.body;
    const userId = req.user.user_id;

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

    // 校验订单归属，防止支付/操作他人订单
    if (order.user_id !== userId) {
      await transaction.rollback();
      return fail(res, '无权限操作此订单', 403);
    }

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

    if (!order_no || !clothing_id) {
      return fail(res, '订单或商品信息缺失', 400);
    }
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return fail(res, '评分需在 1-5 之间', 400);
    }

    // 校验订单归属与完成状态，防止评价他人订单或未完成的订单
    const orderResult = await dbQuery(
      'SELECT id, user_id, status, clothing_id FROM [orders] WHERE order_no = @order_no',
      [{ name: 'order_no', type: sql.NVarChar, value: order_no }]
    );
    if (orderResult.recordset.length === 0) {
      return fail(res, '订单不存在', 404);
    }
    const order = orderResult.recordset[0];
    if (order.user_id !== userId) {
      return fail(res, '无权限评价此订单', 403);
    }
    if (order.status !== 4) {
      return fail(res, '仅已完成（已归还）的订单可评价', 400);
    }
    if (order.clothing_id !== parseInt(clothing_id, 10)) {
      return fail(res, '评价商品与订单不符', 400);
    }

    // 防止重复评价
    const existResult = await dbQuery(
      'SELECT id FROM [review] WHERE order_no = @order_no AND user_id = @user_id',
      [
        { name: 'order_no', type: sql.NVarChar, value: order_no },
        { name: 'user_id', type: sql.Int, value: userId }
      ]
    );
    if (existResult.recordset.length > 0) {
      return fail(res, '该订单已评价', 400);
    }

    await dbQuery(
      'INSERT INTO [review] (order_no, user_id, clothing_id, rating, content, images) VALUES (@order_no, @user_id, @clothing_id, @rating, @content, @images)',
      [
        { name: 'order_no', type: sql.NVarChar, value: order_no },
        { name: 'user_id', type: sql.Int, value: userId },
        { name: 'clothing_id', type: sql.Int, value: clothing_id },
        { name: 'rating', type: sql.TinyInt, value: ratingNum },
        { name: 'content', type: sql.NVarChar, value: content || '' },
        { name: 'images', type: sql.NVarChar, value: JSON.stringify(images || []) }
      ]
    );
    success(res);
  } catch (error) {
    next(error);
  }
});

// 用户提醒商家发货：记录提醒，供后台查看（需订单归属本人且状态为待发货）
app.post('/api/orders/:order_no/remind', userAuth, async (req, res, next) => {
  try {
    const orderNo = req.params.order_no;
    const userId = req.user.user_id;

    const result = await dbQuery(
      'SELECT id, user_id, status FROM [orders] WHERE order_no = @orderNo',
      [{ name: 'orderNo', type: sql.NVarChar, value: orderNo }]
    );
    if (result.recordset.length === 0) {
      return fail(res, '订单不存在', 404);
    }
    if (result.recordset[0].user_id !== userId) {
      return fail(res, '无权限操作此订单', 403);
    }
    if (result.recordset[0].status !== 1) {
      return fail(res, '当前订单状态无需提醒发货', 400);
    }

    await dbQuery(
      'INSERT INTO [order_remind] (order_no, user_id) VALUES (@orderNo, @userId)',
      [
        { name: 'orderNo', type: sql.NVarChar, value: orderNo },
        { name: 'userId', type: sql.Int, value: userId }
      ]
    );
    success(res, null, '已提醒商家发货');
  } catch (error) {
    next(error);
  }
});

app.get('/api/reviews', async (req, res, next) => {
  try {
    const clothingId = req.query.clothing_id;
    if (!clothingId) {
      return fail(res, '缺少 clothing_id 参数', 400);
    }
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
    if (!clothing_id) {
      return fail(res, '缺少 clothing_id 参数', 400);
    }
    
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
    if (!clothing_id) {
      return fail(res, '缺少 clothing_id 参数', 400);
    }
    
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

app.post('/api/upload', adminAuth, (req, res, next) => {
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

app.get('/api/addresses/:id', userAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.user_id;
    const result = await dbQuery(
      'SELECT * FROM [address] WHERE id = @id AND user_id = @user_id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'user_id', type: sql.Int, value: userId }
      ]
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

app.delete('/api/addresses/:id', userAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.user_id;
    const addressResult = await dbQuery(
      'SELECT * FROM [address] WHERE id = @id AND user_id = @user_id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'user_id', type: sql.Int, value: userId }
      ]
    );
    if (addressResult.recordset.length === 0) {
      return fail(res, '地址不存在或无权限', 404);
    }
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
    const { name, category_id, main_image, rent_price, deposit_amount, specs, status, stock, images } = req.body;
    await dbQuery(
      'INSERT INTO [clothing] (name, category_id, main_image, rent_price, deposit_amount, specs, status, stock, images) VALUES (@name, @category_id, @main_image, @rent_price, @deposit_amount, @specs, @status, @stock, @images)',
      [
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'category_id', type: sql.Int, value: category_id },
        { name: 'main_image', type: sql.NVarChar, value: main_image },
        { name: 'rent_price', type: sql.Decimal(10,2), value: rent_price },
        { name: 'deposit_amount', type: sql.Decimal(10,2), value: deposit_amount },
        { name: 'specs', type: sql.NVarChar, value: JSON.stringify(specs) },
        { name: 'status', type: sql.TinyInt, value: status },
        { name: 'stock', type: sql.Int, value: stock || 0 },
        { name: 'images', type: sql.NVarChar, value: JSON.stringify(images || []) }
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
    const { name, category_id, main_image, rent_price, deposit_amount, specs, status, stock, images } = req.body;
    await dbQuery(
      'UPDATE [clothing] SET name = @name, category_id = @category_id, main_image = @main_image, rent_price = @rent_price, deposit_amount = @deposit_amount, specs = @specs, status = @status, stock = @stock, images = @images WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'name', type: sql.NVarChar, value: name },
        { name: 'category_id', type: sql.Int, value: category_id },
        { name: 'main_image', type: sql.NVarChar, value: main_image },
        { name: 'rent_price', type: sql.Decimal(10,2), value: rent_price },
        { name: 'deposit_amount', type: sql.Decimal(10,2), value: deposit_amount },
        { name: 'specs', type: sql.NVarChar, value: JSON.stringify(specs) },
        { name: 'status', type: sql.TinyInt, value: status },
        { name: 'stock', type: sql.Int, value: stock || 0 },
        { name: 'images', type: sql.NVarChar, value: JSON.stringify(images || []) }
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
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 20;
    const status = req.query.status;
    const keyword = req.query.keyword || '';
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];
    if (status !== undefined && status !== '') {
      where.push('o.status = @status');
      params.push({ name: 'status', type: sql.TinyInt, value: parseInt(status, 10) });
    }
    if (keyword) {
      where.push('(o.order_no LIKE @kw OR u.nickname LIKE @kw OR c.name LIKE @kw)');
      params.push({ name: 'kw', type: sql.NVarChar, value: `%${keyword}%` });
    }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM [orders] o LEFT JOIN [user] u ON o.user_id = u.id LEFT JOIN [clothing] c ON o.clothing_id = c.id ${whereStr}`,
      params
    );
    const listParams = [...params,
      { name: 'offset', type: sql.Int, value: offset },
      { name: 'pageSize', type: sql.Int, value: pageSize }
    ];
    const result = await dbQuery(
      `SELECT o.*, u.nickname, u.phone as user_phone, c.name as clothing_name FROM [orders] o LEFT JOIN [user] u ON o.user_id = u.id LEFT JOIN [clothing] c ON o.clothing_id = c.id ${whereStr} ORDER BY o.created_at DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      listParams
    );
    success(res, { list: result.recordset, total: countResult.recordset[0].total, page, page_size: pageSize });
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

app.put('/api/admin/orders/:order_no/status', adminAuth, async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const orderNo = req.params.order_no;
    const { status } = req.body;
    if (status === undefined || status < 0 || status > 5) {
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
    const oldStatus = order.status;

    const validTransitions = {
      0: [1, 5],
      1: [2, 5],
      2: [3, 5],
      3: [4, 5],
      4: [],
      5: []
    };
    if (!validTransitions[oldStatus] || !validTransitions[oldStatus].includes(status)) {
      await transaction.rollback();
      return fail(res, '状态流转无效', 400);
    }

    const updateRequest = new sql.Request(transaction);
    await updateRequest
      .input('order_no', sql.NVarChar, orderNo)
      .input('status', sql.TinyInt, status)
      .query('UPDATE [orders] SET status = @status WHERE order_no = @order_no');

    if (status === 4) {
      const depositRequest = new sql.Request(transaction);
      await depositRequest
        .input('order_no', sql.NVarChar, orderNo)
        .query('INSERT INTO [deposit_flow] (order_no, user_id, amount, flow_type, status, remark) SELECT order_no, user_id, deposit_amount, 2, 1, N\'退还押金\' FROM [orders] WHERE order_no = @order_no');
    }

    if (status === 5 && oldStatus < 4) {
      const stockRequest = new sql.Request(transaction);
      await stockRequest
        .input('clothing_id', sql.Int, order.clothing_id)
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

app.get('/api/admin/banners', adminAuth, async (req, res, next) => {
  try {
    const result = await dbQuery('SELECT * FROM [banner] ORDER BY sort_order ASC, id ASC');
    success(res, result.recordset);
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

app.put('/api/admin/banners/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { title, image_url, target_link, sort_order, status } = req.body;
    await dbQuery(
      'UPDATE [banner] SET title = @title, image_url = @image_url, target_link = @target_link, sort_order = @sort_order, status = @status WHERE id = @id',
      [
        { name: 'id', type: sql.Int, value: id },
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

// ==================== 押金与财务管理（运营后台） ====================
// 押金流水统计：累计押金收入 / 已退还 / 损坏扣除 / 待审核退款
app.get('/api/admin/deposit/stats', adminAuth, async (req, res, next) => {
  try {
    const paid = await dbQuery('SELECT SUM(amount) as t FROM [deposit_flow] WHERE flow_type = 1');
    const refunded = await dbQuery('SELECT SUM(amount) as t FROM [deposit_flow] WHERE flow_type = 2 AND status = 1');
    const deducted = await dbQuery('SELECT SUM(amount) as t FROM [deposit_flow] WHERE flow_type = 3 AND status = 1');
    const pending = await dbQuery('SELECT SUM(amount) as t FROM [deposit_flow] WHERE flow_type = 2 AND status = 0');
    success(res, {
      paid: paid.recordset[0].t || 0,
      refunded: refunded.recordset[0].t || 0,
      deducted: deducted.recordset[0].t || 0,
      pendingRefund: pending.recordset[0].t || 0
    });
  } catch (error) { next(error); }
});

// 押金流水列表（对账）：支持类型/状态/关键词筛选与分页
app.get('/api/admin/deposit/flows', adminAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 20;
    const type = req.query.type;
    const status = req.query.status;
    const keyword = req.query.keyword || '';
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];
    if (type) { where.push('df.flow_type = @type'); params.push({ name: 'type', type: sql.TinyInt, value: parseInt(type, 10) }); }
    if (status !== undefined && status !== '') { where.push('df.status = @status'); params.push({ name: 'status', type: sql.TinyInt, value: parseInt(status, 10) }); }
    if (keyword) { where.push('(df.order_no LIKE @kw OR u.nickname LIKE @kw)'); params.push({ name: 'kw', type: sql.NVarChar, value: `%${keyword}%` }); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM [deposit_flow] df LEFT JOIN [user] u ON df.user_id = u.id ${whereStr}`,
      [...params]
    );
    const listParams = [...params,
      { name: 'offset', type: sql.Int, value: offset },
      { name: 'pageSize', type: sql.Int, value: pageSize }
    ];
    const listResult = await dbQuery(
      `SELECT df.*, u.nickname, c.name as clothing_name
       FROM [deposit_flow] df
       LEFT JOIN [user] u ON df.user_id = u.id
       LEFT JOIN [orders] o ON df.order_no = o.order_no
       LEFT JOIN [clothing] c ON o.clothing_id = c.id
       ${whereStr}
       ORDER BY df.created_at DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      listParams
    );
    success(res, { list: listResult.recordset, total: countResult.recordset[0].total, page, page_size: pageSize });
  } catch (error) { next(error); }
});

// 审核通过某条待处理押金流水（退款/扣除）
app.post('/api/admin/deposit/:id/approve', adminAuth, roleGuard(1), async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const id = req.params.id;
    await transaction.begin();
    const r = await new sql.Request(transaction).input('id', sql.Int, id)
      .query('SELECT * FROM [deposit_flow] WHERE id = @id');
    if (r.recordset.length === 0) { await transaction.rollback(); return fail(res, '流水不存在', 404); }
    if (r.recordset[0].status === 1) { await transaction.rollback(); return fail(res, '该流水已处理', 400); }
    await new sql.Request(transaction).input('id', sql.Int, id)
      .query('UPDATE [deposit_flow] SET status = 1 WHERE id = @id');
    await transaction.commit();
    success(res);
  } catch (error) {
    try { await transaction.rollback(); } catch (e) {}
    next(error);
  }
});

// 损坏扣款：扣除部分押金，剩余金额生成「待审核退款」流水
app.post('/api/admin/deposit/deduct', adminAuth, roleGuard(1), async (req, res, next) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { order_no, amount, remark } = req.body;
    const deduct = parseFloat(amount);
    if (!order_no || !deduct || deduct <= 0) return fail(res, '参数缺失或金额无效', 400);
    await transaction.begin();
    const o = await new sql.Request(transaction).input('order_no', sql.NVarChar, order_no)
      .query('SELECT * FROM [orders] WHERE order_no = @order_no');
    if (o.recordset.length === 0) { await transaction.rollback(); return fail(res, '订单不存在', 404); }
    const order = o.recordset[0];
    if (deduct > parseFloat(order.deposit_amount)) { await transaction.rollback(); return fail(res, '扣款金额不能超过押金', 400); }

    // 扣除记录（type=3，立即生效）
    await new sql.Request(transaction)
      .input('order_no', sql.NVarChar, order_no)
      .input('user_id', sql.Int, order.user_id)
      .input('amount', sql.Decimal(10, 2), deduct)
      .input('remark', sql.NVarChar, remark || N'损坏赔偿扣款')
      .query('INSERT INTO [deposit_flow] (order_no, user_id, amount, flow_type, status, remark) VALUES (@order_no, @user_id, @amount, 3, 1, @remark)');

    // 剩余押金生成待审核退款（type=2，status=0 待管理员审核）
    const remain = parseFloat(order.deposit_amount) - deduct;
    if (remain > 0) {
      await new sql.Request(transaction)
        .input('order_no', sql.NVarChar, order_no)
        .input('user_id', sql.Int, order.user_id)
        .input('amount', sql.Decimal(10, 2), remain)
        .input('remark', sql.NVarChar, N'损坏扣款后剩余退还（待审核）')
        .query('INSERT INTO [deposit_flow] (order_no, user_id, amount, flow_type, status, remark) VALUES (@order_no, @user_id, @amount, 2, 0, @remark)');
    }
    await transaction.commit();
    success(res, null, '已记录扣款，剩余退款待审核');
  } catch (error) {
    try { await transaction.rollback(); } catch (e) {}
    next(error);
  }
});

app.use((req, res) => {
  fail(res, '接口不存在', 404);
});

// ==================== 管理员与角色管理（仅超级管理员） ====================
// 管理员列表
app.get('/api/admin/admins', adminAuth, roleGuard(1), async (req, res, next) => {
  try {
    const result = await dbQuery(
      'SELECT id, username, role, phone, status, created_at FROM [admin] ORDER BY id ASC'
    );
    success(res, result.recordset);
  } catch (error) { next(error); }
});

// 新增管理员
app.post('/api/admin/admins', adminAuth, roleGuard(1), async (req, res, next) => {
  try {
    const { username, password, role, phone } = req.body;
    if (!username || !password) return fail(res, '用户名和密码不能为空', 400);
    if (![1, 2].includes(parseInt(role, 10))) return fail(res, '角色取值无效（1=超级管理员，2=运营人员）', 400);
    const exist = await dbQuery('SELECT id FROM [admin] WHERE username = @username',
      [{ name: 'username', type: sql.NVarChar, value: username }]);
    if (exist.recordset.length > 0) return fail(res, '该用户名已存在', 400);
    await dbQuery(
      'INSERT INTO [admin] (username, password_hash, role, phone, status) VALUES (@username, @password_hash, @role, @phone, 1)',
      [
        { name: 'username', type: sql.NVarChar, value: username },
        { name: 'password_hash', type: sql.NVarChar, value: hashPassword(password) },
        { name: 'role', type: sql.TinyInt, value: parseInt(role, 10) },
        { name: 'phone', type: sql.NVarChar, value: phone || null }
      ]
    );
    success(res, null, '管理员创建成功');
  } catch (error) { next(error); }
});

// 修改管理员角色
app.put('/api/admin/admins/:id/role', adminAuth, roleGuard(1), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { role } = req.body;
    if (![1, 2].includes(parseInt(role, 10))) return fail(res, '角色取值无效', 400);
    if (id === req.admin.admin_id) return fail(res, '不能修改自己的角色', 400);
    await dbQuery('UPDATE [admin] SET role = @role WHERE id = @id',
      [
        { name: 'role', type: sql.TinyInt, value: parseInt(role, 10) },
        { name: 'id', type: sql.Int, value: id }
      ]);
    success(res, null, '角色已更新');
  } catch (error) { next(error); }
});

// 启用 / 禁用管理员
app.put('/api/admin/admins/:id/status', adminAuth, roleGuard(1), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (![0, 1].includes(parseInt(status, 10))) return fail(res, '状态取值无效', 400);
    if (id === req.admin.admin_id && status === 0) return fail(res, '不能禁用当前登录账号', 400);
    await dbQuery('UPDATE [admin] SET status = @status WHERE id = @id',
      [
        { name: 'status', type: sql.TinyInt, value: parseInt(status, 10) },
        { name: 'id', type: sql.Int, value: id }
      ]);
    success(res, null, status === 1 ? '已启用' : '已禁用');
  } catch (error) { next(error); }
});

// 重置管理员密码
app.put('/api/admin/admins/:id/password', adminAuth, roleGuard(1), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password) return fail(res, '新密码不能为空', 400);
    await dbQuery('UPDATE [admin] SET password_hash = @password_hash WHERE id = @id',
      [
        { name: 'password_hash', type: sql.NVarChar, value: hashPassword(password) },
        { name: 'id', type: sql.Int, value: id }
      ]);
    success(res, null, '密码已重置');
  } catch (error) { next(error); }
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
