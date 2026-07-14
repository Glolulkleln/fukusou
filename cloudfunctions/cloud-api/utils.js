const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function success(data) {
  return { success: true, data };
}

function fail(message, code = 500) {
  return { success: false, message, code };
}

function signToken(payload, secret, expiresIn = '7d') {
  return jwt.sign(payload, secret, { expiresIn });
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

function getOpenId(context) {
  return context && context.OPENID ? context.OPENID : null;
}

async function paginate(db, collectionName, whereConditions, page, pageSize, orderField = 'createTime', orderDirection = 'desc') {
  const collection = db.collection(collectionName);
  const query = whereConditions ? collection.where(whereConditions) : collection;

  const totalRes = await query.count();
  const total = totalRes.total || 0;

  const listRes = await query
    .orderBy(orderField, orderDirection)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const list = listRes.data || [];
  const totalPages = Math.ceil(total / pageSize) || 0;

  return { list, total, page, pageSize, totalPages };
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

module.exports = {
  success,
  fail,
  signToken,
  verifyToken,
  getOpenId,
  paginate,
  formatDate,
  hashPassword,
  verifyPassword
};
