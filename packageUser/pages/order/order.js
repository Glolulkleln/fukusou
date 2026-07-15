const { callCloudApi, mapOrder } = require('../../../utils/cloudApi');

// 分栏索引 -> 订单状态码（0=待支付 1=待发货 2=租赁中 3=待归还 4=已完成）
const TAB_STATUS = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };

Page({
  data: {
    tabs: ['全部', '待支付', '待发货', '租赁中', '待归还', '已完成'],
    currentTab: 0,
    orderList: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false
  },

  onShow() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.getOrderList(true);
  },

  switchTab(e) {
    const index = e.currentTarget.dataset.index;
    if (index === this.data.currentTab) return;
    this.setData({ currentTab: index }, () => {
      this.getOrderList(true);
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.getOrderList(false);
    }
  },

  formatOrder(order) {
    const mapped = mapOrder(order);
    let statusText = '未知状态';
    if (mapped.status === 0) statusText = '待支付';
    if (mapped.status === 1) statusText = '待发货';
    if (mapped.status === 2) statusText = '租赁中';
    if (mapped.status === 3) statusText = '待归还';
    if (mapped.status === 4) statusText = '已完成';
    if (mapped.status === 5) statusText = '已取消';
    mapped.statusText = statusText;
    mapped.rent_start_time = mapped.rent_start_time ? String(mapped.rent_start_time).split('T')[0] : '';
    mapped.rent_end_time = mapped.rent_end_time ? String(mapped.rent_end_time).split('T')[0] : '';
    return mapped;
  },

  getOrderList(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    const status = this.data.currentTab === 0 ? '' : TAB_STATUS[this.data.currentTab];
    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...' });
    callCloudApi('getOrders', { page, page_size: this.data.pageSize, status })
      .then(res => {
        wx.hideLoading();
        const list = (res && res.list) || [];
        const formatted = list.map(order => this.formatOrder(order));
        const orderList = reset ? formatted : this.data.orderList.concat(formatted);
        const total = (res && res.total) || 0;
        this.setData({
          orderList,
          page: page + 1,
          hasMore: total > orderList.length,
          loading: false
        });
      })
      .catch(err => {
        wx.hideLoading();
        this.setData({ loading: false });
        console.error('getOrderList error:', err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  changeStatus(e) {
    const orderNo = e.currentTarget.dataset.no;
    const nextStatus = parseInt(e.currentTarget.dataset.status, 10);
    if (!orderNo) return;

    let content = '确定要执行此操作吗？';
    if (nextStatus === 5) content = '确定要取消该笔租赁订单吗？';
    if (nextStatus === 3) content = '确定要申请归还该服装吗？';

    wx.showModal({
      title: '操作确认',
      content: content,
      success: (res) => {
        if (res.confirm) {
          let action = 'cancelOrder';
          if (nextStatus === 3) action = 'confirmReturn';
          callCloudApi(action, { orderNo: orderNo })
            .then(() => {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.getOrderList(true);
            })
            .catch(err => {
              console.error('changeStatus error:', err);
              wx.showToast({ title: err.message || '操作失败', icon: 'none' });
            });
        }
      }
    });
  },

  goToPay(e) {
    const orderNo = e.currentTarget.dataset.no;
    if (!orderNo) return;
    wx.navigateTo({
      url: `/packageUser/pages/order-detail/order-detail?order_no=${orderNo}&pay=1`
    });
  },

  remindDelivery(e) {
    const orderNo = e.currentTarget.dataset.no;
    if (!orderNo) return;
    callCloudApi('remindShip', { orderNo })
      .then(() => wx.showToast({ title: '已提醒商家尽快发货', icon: 'success' }))
      .catch(err => wx.showToast({ title: err.message || '提醒失败，请重试', icon: 'none' }));
  },

  goToReview(e) {
    const order = e.currentTarget.dataset.item;
    if (!order || !order.order_no || !order.clothing_id) return;
    wx.navigateTo({
      url: `/packageUser/pages/review/review?order_no=${order.order_no}&clothing_id=${order.clothing_id}`
    });
  },

  viewOrderDetail(e) {
    const orderNo = e.currentTarget.dataset.no;
    if (!orderNo) return;
    wx.navigateTo({
      url: `/packageUser/pages/order-detail/order-detail?order_no=${orderNo}`
    });
  }
});