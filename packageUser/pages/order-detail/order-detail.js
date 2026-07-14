const { callCloudApi, mapOrder, getAccessibleImageUrl } = require('../../../utils/cloudApi');

Page({
  data: {
    orderDetail: null,
    timeline: [],
    showPayPopup: false,
    payMethod: 'wechat',
    isPaying: false
  },

  onLoad(options) {
    const orderNo = options.order_no;
    this.getOrderDetail(orderNo);
  },

  async getOrderDetail(orderNo) {
    try {
      const res = await callCloudApi('getOrderDetail', { orderNo });
      let order = mapOrder(res);
      if (order.main_image && order.main_image.startsWith('cloud://')) {
        order.main_image = await getAccessibleImageUrl(order.main_image);
      }
      let statusText = '未知状态';
      if (order.status === 0) statusText = '待支付';
      if (order.status === 1) statusText = '待发货';
      if (order.status === 2) statusText = '租赁中';
      if (order.status === 3) statusText = '待归还';
      if (order.status === 4) statusText = '已完成';
      if (order.status === 5) statusText = '已取消';

      order.statusText = statusText;
      order.rent_start_time = order.rent_start_time ? String(order.rent_start_time).split('T')[0] : '';
      order.rent_end_time = order.rent_end_time ? String(order.rent_end_time).split('T')[0] : '';
      order.created_at = order.created_at ? String(order.created_at).replace('T', ' ').split('.')[0] : '';

      const start = new Date(order.rent_start_time);
      const end = new Date(order.rent_end_time);
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
      order.rent_days = diffDays;

      if (order.express_no) {
        order.express_company = this.getExpressCompany(order.express_no);
      }

      const timeline = this.buildTimeline(order.status, order.express_no, order.express_company);
      this.setData({ orderDetail: order, timeline });
    } catch (err) {
      console.error(err);
    }
  },

  selectPayMethod(e) {
    const method = e.currentTarget.dataset.method;
    this.setData({ payMethod: method });
  },

  showPayPopup() {
    if (!this.data.orderDetail || this.data.orderDetail.status !== 0) return;
    this.setData({ showPayPopup: true });
  },

  closePayPopup() {
    if (this.data.isPaying) return;
    this.setData({ showPayPopup: false });
  },

  confirmPayment() {
    if (this.data.isPaying) return;
    if (!this.data.orderDetail) return;

    const orderNo = this.data.orderDetail.order_no;
    this.setData({ isPaying: true });
    wx.showLoading({ title: '支付中...', mask: true });

    // TODO: 真实微信支付接入位置
    // 真实场景中，这里应该：
    // 1. 调用后端接口获取微信支付参数
    // 2. 调用 wx.requestPayment 发起微信支付
    // 3. 支付成功后再调用后端确认接口

    // 当前使用云函数模拟支付
    callCloudApi('payOrder', { orderNo, payMethod: this.data.payMethod })
      .then(() => {
        wx.hideLoading();
        this.setData({ showPayPopup: false, isPaying: false });
        wx.showToast({ title: '支付成功', icon: 'success', duration: 2000 });
        this.getOrderDetail(orderNo);
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
  },

  changeStatus(e) {
    const orderNo = e.currentTarget.dataset.no;
    const nextStatus = e.currentTarget.dataset.status;

    if (nextStatus === 1) {
      this.showPayPopup();
      return;
    }

    let title = '操作确认';
    let content = '确定要执行此操作吗？';
    if (nextStatus === 5) content = '确定要取消该笔租赁订单吗？';
    if (nextStatus === 3) content = '确定要申请归还该服装吗？';

    wx.showModal({
      title: title,
      content: content,
      success: (res) => {
        if (res.confirm) {
          const action = nextStatus === 5 ? 'cancelOrder' : (nextStatus === 3 ? 'confirmReturn' : null);
          if (!action) {
            wx.showToast({ title: '暂不支持该操作', icon: 'none' });
            return;
          }
          callCloudApi(action, { orderNo })
            .then(() => {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.getOrderDetail(orderNo);
            })
            .catch(err => {
              wx.showToast({ title: err.message || '操作失败', icon: 'none' });
            });
        }
      }
    });
  },

  remindShip() {
    wx.showToast({ title: '已提醒商家发货', icon: 'success' });
  },

  goToReview() {
    const order = this.data.orderDetail;
    wx.navigateTo({
      url: `/packageUser/pages/review/review?order_no=${order.order_no}&clothing_id=${order.clothing_id}`
    });
  },

  getExpressCompany(expressNo) {
    if (!expressNo) return '快递';
    const no = expressNo.toUpperCase();
    if (no.startsWith('SF')) return '顺丰速运';
    if (no.startsWith('YT')) return '圆通速递';
    if (no.startsWith('ZT')) return '中通快递';
    if (no.startsWith('YD')) return '韵达快递';
    if (no.startsWith('JD')) return '京东物流';
    if (no.startsWith('EMS')) return 'EMS';
    if (no.startsWith('STO')) return '申通快递';
    if (no.startsWith('HTKY')) return '百世快递';
    if (no.startsWith('YZPY')) return '邮政快递';
    if (/^\d+$/.test(expressNo)) {
      if (expressNo.length === 12 && expressNo.startsWith('1')) return '顺丰速运';
      if (expressNo.length === 13) return '圆通速递';
      if (expressNo.length === 15 && expressNo.startsWith('7')) return '中通快递';
    }
    return '快递';
  },

  buildTimeline(status, expressNo, expressCompany) {
    if (status === 5) {
      return [
        { title: '提交订单', done: true },
        { title: '订单已取消', done: true, cancel: true }
      ];
    }
    const steps = [
      { title: '提交订单', done: true },
      { title: '完成支付', done: status >= 1 },
      { title: '商家发货', done: status >= 2, desc: (status >= 2 && expressNo) ? (expressCompany + ' ' + expressNo) : '' },
      { title: '租赁中', done: status === 2 },
      { title: '申请归还', done: status >= 3 },
      { title: '租赁完成', done: status === 4 }
    ];
    return steps;
  },

  copyExpressNo() {
    const order = this.data.orderDetail;
    if (!order || !order.express_no) return;
    wx.setClipboardData({
      data: order.express_no,
      success: () => {
        wx.showToast({
          title: '快递单号已复制',
          icon: 'success',
          duration: 2000
        });
      }
    });
  }
});