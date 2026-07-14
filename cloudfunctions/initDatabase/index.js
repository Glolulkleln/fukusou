const cloud = require('wx-server-sdk');
const { hashPassword } = require('./utils.js');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    // -502003 或 -502001 表示集合已存在，忽略
    if (err && (err.errCode === -502003 || err.errCode === -502001)) {
      return;
    }
    console.error('createCollection error:', name, err);
  }
}

async function seedCategories() {
  const defaultCategories = [
    { name: '女装', sortOrder: 1, status: 1 },
    { name: '男装', sortOrder: 2, status: 1 },
    { name: '童装', sortOrder: 3, status: 1 },
    { name: '汉服', sortOrder: 4, status: 1 },
    { name: '礼服', sortOrder: 5, status: 1 }
  ];

  for (const item of defaultCategories) {
    try {
      const exist = await db.collection('categories').where({ name: item.name }).count();
      if (exist.total === 0) {
        await db.collection('categories').add({
          data: {
            ...item,
            createTime: db.serverDate()
          }
        });
      }
    } catch (err) {
      // 忽略重复或查询异常，避免阻断初始化
      console.error('seed category error:', err);
    }
  }
}

async function seedAdmin() {
  try {
    const exist = await db.collection('admins').where({ username: 'admin' }).count();
    if (exist.total === 0) {
      await db.collection('admins').add({
        data: {
          username: 'admin',
          password: hashPassword('061009'),
          nickname: '管理员',
          role: 1,
          status: 1,
          createTime: db.serverDate()
        }
      });
    }
  } catch (err) {
    console.error('seed admin error:', err);
  }
}

exports.main = async (event, context) => {
  try {
    const collections = [
      'categories',
      'clothings',
      'banners',
      'users',
      'addresses',
      'favorites',
      'orders',
      'reviews',
      'admins'
    ];

    for (const name of collections) {
      await ensureCollection(name);
    }

    await seedCategories();
    await seedAdmin();

    return { success: true, message: '数据库初始化完成' };
  } catch (err) {
    return { success: false, message: err.message || '数据库初始化失败' };
  }
};
