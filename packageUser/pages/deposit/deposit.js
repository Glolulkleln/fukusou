const { callCloudApi } = require('../../../utils/cloudApi');

Page({
  data: {
    summary: { frozen: '0.00', refunded: '0.00' },
    records: []
  },

  onShow() {
    this.getDepositSummary();
    this.getDepositRecords();
  },

  getDepositSummary() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    callCloudApi('getDepositSummary')
      .then(res => {
        const summary = res || { frozen: 0, refunded: 0 };
        summary.frozen = parseFloat(summary.frozen).toFixed(2);
        summary.refunded = parseFloat(summary.refunded).toFixed(2);
        this.setData({ summary });
      })
      .catch(err => {
        console.error('获取押金汇总失败:', err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  getDepositRecords() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    callCloudApi('getDepositRecords')
      .then(res => {
        const list = res && res.list ? res.list : (res || []);
        const formatted = list.map(item => {
          item.amount = parseFloat(item.amount).toFixed(2);
          item.created_at = (item.createTime || item.created_at || '').replace('T', ' ').split('.')[0];
          return item;
        });
        this.setData({ records: formatted });
      })
      .catch(err => {
        console.error('获取押金记录失败:', err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  }
});