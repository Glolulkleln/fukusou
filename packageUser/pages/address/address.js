const { callCloudApi, mapAddressList } = require('../../../utils/cloudApi');

Page({
  data: {
    addresses: [],
    loading: true,
    selectMode: false
  },

  onLoad(options) {
    if (options.selectMode === '1') {
      this.setData({ selectMode: true });
    }
  },

  onShow() {
    this.getAddressList();
  },

  getAddressList() {
    this.setData({ loading: true });
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ loading: false });
      return;
    }

    callCloudApi('getAddresses')
      .then(res => {
        const list = mapAddressList(res || []);
        this.setData({
          addresses: list,
          loading: false
        });
      })
      .catch(err => {
        console.error(err);
        this.setData({ loading: false });
      });
  },

  addAddress() {
    wx.navigateTo({
      url: '/packageUser/pages/address-edit/address-edit'
    });
  },

  selectAddress(e) {
    const id = Number(e.currentTarget.dataset.id);
    const addr = this.data.addresses.find(item => item.id === id);
    if (this.data.selectMode && addr) {
      const pages = getCurrentPages();
      const prevPage = pages[pages.length - 2];
      if (prevPage && prevPage.onAddressSelected) {
        prevPage.onAddressSelected(addr);
      }
      wx.navigateBack();
    }
  },

  editAddress(e) {
    if (this.data.selectMode) {
      this.selectAddress(e);
      return;
    }
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageUser/pages/address-edit/address-edit?id=${id}`
    });
  },

  deleteAddress(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '提示',
      content: '确定要删除该地址吗？',
      success: (res) => {
        if (res.confirm) {
          callCloudApi('deleteAddress', { id })
            .then(() => {
              wx.showToast({ title: '删除成功', icon: 'success' });
              this.getAddressList();
            })
            .catch(err => {
              wx.showToast({ title: err.message || '删除失败', icon: 'none' });
            });
        }
      }
    });
  }
});
