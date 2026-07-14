const cloud = require('wx-server-sdk');
const { success, fail, signToken } = require('./utils.js');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-change-in-production';

exports.main = async (event, context) => {
  const { code, userInfo } = event;

  if (!code) {
    return fail('缺少必填参数 code', 400);
  }

  let sessionRes;
  try {
    sessionRes = await cloud.openapi.auth.code2Session({
      js_code: code
    });
  } catch (err) {
    console.error('code2Session 调用失败：', err);
    return fail(`微信登录凭证校验失败：${err.errMsg || err.message || '未知错误'}`, 401);
  }

  const { openid, session_key } = sessionRes;
  if (!openid) {
    return fail('无法获取用户 openid，请检查 code 是否有效', 401);
  }

 
  const usersCollection = db.collection('users');
  const userQuery = usersCollection.where({
    _openid: openid
  });

  const existingRes = await userQuery.get();
  let userRecord;

  if (existingRes.data && existingRes.data.length > 0) {

    const nickname = userInfo && userInfo.nickName ? userInfo.nickName : '';
    const avatarUrl = userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : '';

    await userQuery.update({
      data: {
        nickname,
        avatarUrl,
        updateTime: db.serverDate()
      }
    });


    const refreshedRes = await usersCollection.where({ _openid: openid }).get();
    userRecord = refreshedRes.data[0];
  } else {

    const newUser = {
      _openid: openid,
      nickname: userInfo && userInfo.nickName ? userInfo.nickName : '',
      avatarUrl: userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : '',
      status: 1,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    const addRes = await usersCollection.add({
      data: newUser
    });

    userRecord = {
      _id: addRes._id,
      ...newUser
    };
  }

  const token = signToken({ openid }, JWT_SECRET, '7d');

  return success({
    token,
    openid,
    userInfo: userRecord
  });
};
