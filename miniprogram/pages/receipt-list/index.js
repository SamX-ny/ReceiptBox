/**
 * 筛选后的小票列表（从统计、详情页跳转）。
 * 参数：merchant / category / merchantType / start / end / title
 */
const format = require('../../utils/format');
const dates = require('../../shared/dates');

Page({
  data: {
    filter: null,
    title: ''
  },

  onLoad(q) {
    const filter = {};
    ['merchant', 'category', 'merchantType', 'start', 'end', 'keyword'].forEach((k) => {
      if (q[k]) filter[k] = decodeURIComponent(q[k]);
    });
    const parts = [];
    if (filter.merchant) parts.push(filter.merchant);
    if (filter.category) parts.push(format.category(filter.category).name);
    if (filter.merchantType) parts.push(format.merchantType(filter.merchantType).name);
    let title = q.title ? decodeURIComponent(q.title) : parts.join(' · ') || '小票';
    let range = '';
    if (filter.start && filter.end) {
      range = filter.start === filter.end ? format.friendlyDate(filter.start) : format.shortDate(filter.start) + ' - ' + format.shortDate(filter.end) + (filter.start.slice(0, 4) !== dates.today().slice(0, 4) ? ' ' + filter.start.slice(0, 4) : '');
    }
    wx.setNavigationBarTitle({ title: title });
    this.setData({ filter: filter, title: title, range: range });
  },

  onReachBottom() {
    this.selectComponent('#feed').loadMore();
  },

  onPullDownRefresh() {
    this.selectComponent('#feed').reload().finally(() => wx.stopPullDownRefresh());
  }
});
