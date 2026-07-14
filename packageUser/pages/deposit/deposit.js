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
        console.error('押金汇总需在 cloud-api 中实现对应 action:', err);
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
        console.error('押金记录需在 cloud-api 中实现对应 action:', err);
      });
  }
});