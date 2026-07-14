const { callCloudApi, mapAddressList } = require('../../../utils/cloudApi');

Page({
  data: {
    id: '',
    consignee: '',
    phone: '',
    detailed_address: '',
    is_default: 0
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ id: options.id });
      this.getAddressDetail(options.id);
    }
  },

  getAddressDetail(id) {
    callCloudApi('getAddressDetail', { id })
      .then(res => {
        const addr = mapAddressList([res])[0];
        if (addr) {
          this.setData({
            consignee: addr.consignee,
            phone: addr.phone,
            detailed_address: addr.detailed_address,
            is_default: addr.is_default
          });
        }
      })
      .catch(err => {
        console.error(err);
      });
  },

  inputConsignee(e) {
    this.setData({ consignee: e.detail.value });
  },

  inputPhone(e) {
    this.setData({ phone: e.detail.value });
  },

  inputAddress(e) {
    this.setData({ detailed_address: e.detail.value });
  },

  switchDefault(e) {
    this.setData({ is_default: e.detail.value ? 1 : 0 });
  },

  saveAddress() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    if (!this.data.consignee.trim() || !this.data.phone.trim() || !this.data.detailed_address.trim()) {
      wx.showToast({ title: '请完整填写表单信息', icon: 'none' });
      return;
    }

    const data = {
      consignee: this.data.consignee,
      phone: this.data.phone,
      detailedAddress: this.data.detailed_address,
      isDefault: !!this.data.is_default
    };

    if (this.data.id) {
      data.id = this.data.id;
      callCloudApi('updateAddress', data)
        .then(() => {
          wx.showToast({ title: '修改成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        })
        .catch(err => {
          wx.showToast({ title: err.message || '修改失败', icon: 'none' });
        });
    } else {
      callCloudApi('addAddress', data)
        .then(() => {
          wx.showToast({ title: '添加成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        })
        .catch(err => {
          wx.showToast({ title: err.message || '添加失败', icon: 'none' });
        });
    }
  }
});