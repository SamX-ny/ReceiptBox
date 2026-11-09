const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const capture = require('../../utils/capture');
const dates = require('../../shared/dates');

Page({
  data: {
    loading: true,
    overview: null,
    recent: [],
    familyName: ''
  },

  onShow() {
    if (app.consumeDirty('home')) this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (app.ready) await app.ready;
    const today = dates.today();
    try {
      const [ov, recent] = await Promise.all([
        api.call('stats.overview', { today: today }),
        api.call('receipt.list', { limit: 5 })
      ]);
      const maxCat = ov.month.byCategory.length ? ov.month.byCategory[0].amount : 0;
      this.setData({
        loading: false,
        familyName: (app.globalData.family && app.globalData.family.name) || '',
        recent: recent.list,
        overview: {
          monthLabel: ov.month.label,
          monthTotal: format.money(ov.month.total),
          monthCount: ov.month.count,
          avgPerDay: format.money(ov.month.avgPerDay),
          today: format.money(ov.today.total),
          week: format.money(ov.week.total),
          lastMonth: format.money(ov.lastMonth.total),
          change: ov.lastMonth.change,
          changeText: format.percent(ov.lastMonth.change),
          series: ov.month.series.map((s) => ({ label: s.label, value: s.amount, title: format.friendlyDate(s.key) })),
          categories: ov.month.byCategory.map((c) => {
            const cat = format.category(c.id);
            return {
              id: c.id,
              icon: cat.icon,
              name: cat.name,
              amount: format.money(c.amount),
              percent: c.percent,
              width: maxCat > 0 ? Math.max(2, c.amount / maxCat * 100) : 0
            };
          })
        }
      });
    } catch (e) {
      this.setData({ loading: false });
      app.globalData.dirty.home = true;
    }
  },

  onCamera() {
    capture.captureReceipt('camera');
  },

  onAlbum() {
    capture.captureReceipt('album');
  },

  onManual() {
    wx.navigateTo({ url: '/pages/receipt-edit/index?mode=manual' });
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/index' });
  },

  goReceipts() {
    wx.switchTab({ url: '/pages/receipts/index' });
  },

  onShareAppMessage() {
    return { title: 'Receipt Box 收据箱：拍小票自动记账、比价', path: '/pages/index/index' };
  }
});
