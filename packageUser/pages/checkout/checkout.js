const { callCloudApi, mapAddressList } = require('../../../utils/cloudApi');

Page({
  data: {
    checkoutItems: [],
    totalRent: 0,
    totalDeposit: 0,
    totalAmount: 0,
    startDate: '',
    endDate: '',
    address: '江苏省南京市江宁区弘景大道1号 南京工程学院',
    addressId: '',
    payMethod: 'wechat',
    showPayPopup: false,
    orderNos: [],
    isPaying: false
  },

  onLoad() {
    this.initDates();
    this.loadCheckoutItems();
    this.loadDefaultAddress();
  },

  initDates() {
    const today = new Date();
    const future = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    this.setData({
      startDate: formatDate(today),
      endDate: formatDate(future)
    }, () => {
      this.updateRentDays();
      this.calculateTotals();
    });
  },

  updateRentDays() {
    const start = new Date(this.data.startDate);
    const end = new Date(this.data.endDate);
    const diffMs = end - start;
    const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    const items = this.data.checkoutItems.map(item => ({
      ...item,
      rent_days: diffDays
    }));

    this.setData({ checkoutItems: items });
  },

  calculateTotals() {
    let rent = 0;
    let deposit = 0;
    this.data.checkoutItems.forEach(item => {
      const days = item.rent_days || 1;
      rent += parseFloat(item.rent_price) * days;
      deposit += parseFloat(item.deposit_amount);
    });
    this.setData({
      totalRent: rent.toFixed(2),
      totalDeposit: deposit.toFixed(2),
      totalAmount: (rent + deposit).toFixed(2)
    });
  },

  loadCheckoutItems() {
    const cart = wx.getStorageSync('cart') || [];
    const selectedItems = cart.filter(item => item.selected);

    this.setData({ checkoutItems: selectedItems }, () => {
      this.updateRentDays();
      this.calculateTotals();
    });
  },

  loadDefaultAddress() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    callCloudApi('getAddresses')
      .then(res => {
        const list = mapAddressList(res || []);
        const defaultAddr = list.find(item => item.is_default === 1) || list[0];
        if (defaultAddr) {
          this.setData({
            addressId: defaultAddr.id,
            address: (defaultAddr.region || []).join('') + defaultAddr.detailed_address + ' (' + defaultAddr.consignee + ' ' + defaultAddr.phone + ')'
          });
        }
      })
      .catch(err => console.error(err));
  },

  bindStartDateChange(e) {
    const newDate = e.detail.value;
    if (new Date(newDate) >= new Date(this.data.endDate)) {
      wx.showToast({ title: '起租日期需早于归还日期', icon: 'none' });
      return;
    }
    this.setData({ startDate: newDate }, () => {
      this.updateRentDays();
      this.calculateTotals();
    });
  },

  bindEndDateChange(e) {
    const newDate = e.detail.value;
    if (new Date(newDate) <= new Date(this.data.startDate)) {
      wx.showToast({ title: '归还日期需晚于起租日期', icon: 'none' });
      return;
    }
    this.setData({ endDate: newDate }, () => {
      this.updateRentDays();
      this.calculateTotals();
    });
  },

  selectAddress() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/address/address?selectMode=1'
    });
  },

  onAddressSelected(addr) {
    if (!addr) return;
    const region = addr.region || [];
    const addrStr = (Array.isArray(region) ? region.join('') : region) +
      (addr.detailed_address || '') +
      ' (' + (addr.consignee || '') + ' ' + (addr.phone || '') + ')';
    this.setData({
      addressId: addr.id,
      address: addrStr
    });
  },

  selectPayMethod(e) {
    const method = e.currentTarget.dataset.method;
    this.setData({ payMethod: method });
  },

  submitOrder() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先在"我的"页面授权登录', icon: 'none' });
      return;
    }

    if (this.data.checkoutItems.length === 0) return;
    if (!this.data.addressId) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交订单中...', mask: true });

    const items = this.data.checkoutItems.map(item => ({
      clothing_id: item.clothing_id,
      spec: item.spec,
      rent_days: item.rent_days || 1,
      deposit_amount: item.deposit_amount || 0
    }));

    callCloudApi('createOrder', {
      items: items,
      rent_start_time: this.data.startDate,
      rent_end_time: this.data.endDate,
      address_id: this.data.addressId
    }).then(result => {
      wx.hideLoading();
      let orderNos = [];
      if (Array.isArray(result)) {
        orderNos = result;
      } else if (result && Array.isArray(result.orderNumbers)) {
        orderNos = result.orderNumbers;
      } else if (result && result.order_no) {
        orderNos = [result.order_no];
      }
      this.setData({
        orderNos: orderNos,
        showPayPopup: true
      });
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({
        title: err.message || '下单失败，请重试',
        icon: 'none',
        duration: 3000
      });
    });
  },

  closePayPopup() {
    if (this.data.isPaying) return;
    this.setData({ showPayPopup: false });
  },

  confirmPayment() {
    if (this.data.isPaying) return;
    if (this.data.orderNos.length === 0) return;

    this.setData({ isPaying: true });
    wx.showLoading({ title: '支付中...', mask: true });

    const payPromises = this.data.orderNos.map(orderNo => {
      return callCloudApi('payOrder', { orderNo, payMethod: this.data.payMethod });
    });

    Promise.all(payPromises)
      .then(() => {
        wx.hideLoading();
        this.setData({ showPayPopup: false, isPaying: false });

        let cart = wx.getStorageSync('cart') || [];
        cart = cart.filter(item => !item.selected);
        wx.setStorageSync('cart', cart);

        wx.showToast({ title: '支付成功', icon: 'success', duration: 2000 });
        setTimeout(() => {
          wx.redirectTo({ url: '/packageUser/pages/order/order?tab=2' });
        }, 2000);
      })
      .catch(err => {
        wx.hideLoading();
        this.setData({ isPaying: false });
        wx.showToast({
          title: err.message || '支付失败，请重试',
          icon: 'none',
          duration: 3000
        });
      });
  }
});
