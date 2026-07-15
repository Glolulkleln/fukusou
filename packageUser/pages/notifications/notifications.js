const { callCloudApi } = require('../../../utils/cloudApi');

Page({
  data: {
    list: []
  },

  onShow() {
    this.loadNotifications();
  },

  async loadNotifications() {
    try {
      const res = await callCloudApi('getNotifications');
      const list = (res && res.list) || res || [];
      list.forEach(item => {
        item.remind_at_str = item.remind_at ? String(item.remind_at).replace('T', ' ').split('.')[0] : '';
        item.content = `您的订单 ${item.order_no}（${item.clothing_name || '服装'}）将于 ${item.remind_at_str} 到期，请按时归还并完成核验，避免产生违约金。`;
      });
      this.setData({ list });
    } catch (e) {
      console.error('加载提醒失败:', e);
    }
  },

  async markRead(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await callCloudApi('markNotificationRead', { id });
      this.loadNotifications();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  goOrder(e) {
    const no = e.currentTarget.dataset.no;
    wx.navigateTo({
      url: `/packageUser/pages/order-detail/order-detail?order_no=${no}`
    });
  }
});
