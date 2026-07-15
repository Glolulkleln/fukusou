const BASE_URL = 'http://192.168.2.114:3000';

const getToken = () => {
  return wx.getStorageSync('token') || '';
};

const request = (url, method = 'GET', data = {}) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method: method,
      data: data,
      header: {
        'content-type': 'application/json',
        'Authorization': getToken() ? 'Bearer ' + getToken() : ''
      },
      success: (res) => {
        if (res.statusCode === 200) {
          if (res.data.code === 200 || res.data.success) {
            resolve(res.data);
          } else {
            reject(new Error(res.data.message || '请求失败'));
          }
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          reject(new Error('未登录或登录已过期'));
        } else {
          reject(new Error(
            (res.data && (res.data.message || res.data.msg)) ||
            ('请求失败（' + res.statusCode + '）')
          ));
        }
      },
      fail: (err) => {
        reject(new Error('网络连接失败'));
      }
    });
  });
};

module.exports = {
  request,
  BASE_URL
};
