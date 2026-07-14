const { callCloudApi, uploadCloudFile } = require('../../../utils/cloudApi');

Page({
  data: {
    orderNo: '',
    clothingId: '',
    rating: 5,
    content: '',
    imageList: []
  },

  onLoad(options) {
    this.setData({
      orderNo: options.order_no || '',
      clothingId: options.clothing_id || ''
    });
  },

  setRating(e) {
    this.setData({
      rating: e.currentTarget.dataset.val
    });
  },

  inputContent(e) {
    this.setData({
      content: e.detail.value || ''
    });
  },

  chooseImage() {
    const remainCount = 3 - this.data.imageList.length;
    if (remainCount <= 0) {
      wx.showToast({ title: '最多上传3张图片', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: remainCount,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = (res.tempFiles || [])
          .map(f => f.tempFilePath)
          .filter(Boolean);
        if (tempFilePaths.length === 0) return;
        this.doUpload(tempFilePaths);
      },
      fail: (err) => {
        console.error('chooseMedia fail:', err);
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  doUpload(filePaths) {
    wx.showLoading({ title: '上传中...', mask: true });

    const uploadOne = (filePath) => {
      return new Promise((resolve) => {
        if (!filePath) {
          resolve('');
          return;
        }
        uploadCloudFile(filePath)
          .then((url) => {
            let result = '';
            if (typeof url === 'string') {
              result = url;
            } else if (url && typeof url.url === 'string') {
              result = url.url;
            } else if (url && typeof url.data === 'string') {
              result = url.data;
            }
            resolve(result);
          })
          .catch((err) => {
            console.error('uploadOne fail:', err);
            resolve('');
          });
      });
    };

    const results = [];
    const uploadNext = (index) => {
      if (index >= filePaths.length) {
        const validUrls = results.filter(u => u && u.length > 0);
        if (validUrls.length === 0) {
          wx.hideLoading();
          wx.showToast({ title: '图片上传失败', icon: 'none' });
          return;
        }
        const newList = this.data.imageList.concat(validUrls);
        this.setData({ imageList: newList }, () => {
          wx.hideLoading();
          if (validUrls.length < filePaths.length) {
            wx.showToast({
              title: '成功' + validUrls.length + '张，失败' + (filePaths.length - validUrls.length) + '张',
              icon: 'none'
            });
          }
        });
        return;
      }

      uploadOne(filePaths[index]).then((url) => {
        results.push(url);
        uploadNext(index + 1);
      });
    };

    try {
      uploadNext(0);
    } catch (e) {
      console.error('doUpload error:', e);
      wx.hideLoading();
      wx.showToast({ title: '上传出错', icon: 'none' });
    }
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.imageList.slice();
    list.splice(index, 1);
    this.setData({ imageList: list });
  },

  submitReview() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const content = (this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '请输入评价内容', icon: 'none' });
      return;
    }

    if (!this.data.orderNo || !this.data.clothingId) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }

    callCloudApi('submitReview', {
      orderNo: this.data.orderNo,
      clothingId: this.data.clothingId,
      rating: this.data.rating,
      content: content,
      images: this.data.imageList || []
    }).then(() => {
      wx.showToast({ title: '评价提交成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/packageUser/pages/order/order' });
        }
      }, 1500);
    }).catch(err => {
      wx.showToast({ title: err.message || '评价提交失败', icon: 'none' });
    });
  }
});