Page({
  data: {
    cartList: [],
    totalRent: 0,
    totalDeposit: 0,
    totalAmount: 0,
    isAllSelected: true
  },

  onShow() {
    this.loadCart();
  },

  loadCart() {
    const cart = wx.getStorageSync('cart') || [];
    this.setData({ cartList: cart }, () => {
      this.calculateTotal();
    });
  },

  calculateTotal() {
    let rent = 0;
    let deposit = 0;
    let allSelected = this.data.cartList.length > 0;

    this.data.cartList.forEach(item => {
      if (item.selected) {
        const days = item.rent_days || 1;
        rent += parseFloat(item.rent_price) * days;
        deposit += parseFloat(item.deposit_amount);
      } else {
        allSelected = false;
      }
    });

    this.setData({
      totalRent: rent.toFixed(2),
      totalDeposit: deposit.toFixed(2),
      totalAmount: (rent + deposit).toFixed(2),
      isAllSelected: allSelected
    });
  },

  toggleSelect(e) {
    const index = e.currentTarget.dataset.index;
    const cartList = this.data.cartList;
    cartList[index].selected = !cartList[index].selected;
    
    this.setData({ cartList }, () => {
      wx.setStorageSync('cart', cartList);
      this.calculateTotal();
    });
  },

  toggleAll() {
    const newStatus = !this.data.isAllSelected;
    const cartList = this.data.cartList.map(item => {
      item.selected = newStatus;
      return item;
    });
    
    this.setData({ cartList }, () => {
      wx.setStorageSync('cart', cartList);
      this.calculateTotal();
    });
  },

  deleteItem(e) {
    const index = e.currentTarget.dataset.index;
    const cartList = this.data.cartList;
    cartList.splice(index, 1);
    
    this.setData({ cartList }, () => {
      wx.setStorageSync('cart', cartList);
      this.calculateTotal();
    });
  },

  increaseDays(e) {
    const index = e.currentTarget.dataset.index;
    const cartList = this.data.cartList;
    const current = cartList[index].rent_days || 1;
    cartList[index].rent_days = current + 1;
    
    this.setData({ cartList }, () => {
      wx.setStorageSync('cart', cartList);
      this.calculateTotal();
    });
  },

  decreaseDays(e) {
    const index = e.currentTarget.dataset.index;
    const cartList = this.data.cartList;
    const current = cartList[index].rent_days || 1;
    if (current <= 1) return;
    cartList[index].rent_days = current - 1;
    
    this.setData({ cartList }, () => {
      wx.setStorageSync('cart', cartList);
      this.calculateTotal();
    });
  },

  goToCheckout() {
    const selectedItems = this.data.cartList.filter(item => item.selected);
    if (selectedItems.length === 0) {
      wx.showToast({ title: '请选择要租赁的服装', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/packageUser/pages/checkout/checkout'
    });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/packageGoods/pages/detail/detail?id=${id}`
    });
  }
});