const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const capture = require('../../utils/capture');
const dates = require('../../shared/dates');
const categories = require('../../shared/categories');

Page({
  data: {
    anchor: dates.today(),
    label: '',
    isCurrent: true,
    total: '',
    count: 0,
    keyword: '',
    category: '',
    chips: [],
    filter: null
  },

  onLoad() {
    this.setPeriod(dates.today());
  },

  onShow() {
    if (app.consumeDirty('receipts') && this._shown) this.refresh();
    this._shown = true;
  },

  setPeriod(anchor) {
    const range = dates.periodRange('month', anchor);
    this.setData({
      anchor: range.start,
      range: range,
      label: dates.periodLabel(range),
      isCurrent: range.end >= dates.today()
    });
    this.refresh();
  },

  refresh() {
    const range = this.data.range;
    this.setData({
      filter: { start: range.start, end: range.end, category: this.data.category, keyword: this.data.keyword }
    });
    return this.loadSummary();
  },

  async loadSummary() {
    try {
      const s = await api.call('stats.summary', { type: 'month', date: this.data.range.start }, { silent: true });
      const chips = [{ id: '', label: '全部' }].concat(s.byCategory.map((c) => {
        const cat = categories.getCategory(c.id);
        return { id: c.id, label: cat.icon + ' ' + cat.name };
      }));
      // 当前选中的分类即使本月没有数据也保留
      if (this.data.category && !chips.some((c) => c.id === this.data.category)) {
        const cat = categories.getCategory(this.data.category);
        chips.push({ id: cat.id, label: cat.icon + ' ' + cat.name });
      }
      const catAmount = this.data.category ? (s.byCategory.find((c) => c.id === this.data.category) || { amount: 0 }).amount : null;
      this.setData({
        total: format.money(catAmount === null ? s.total : catAmount),
        count: s.count,
        chips: chips
      });
    } catch (e) {}
  },

  onPrev() {
    this.setPeriod(dates.shiftPeriod('month', this.data.anchor, -1).start);
  },

  onNext() {
    if (this.data.isCurrent) return;
    this.setPeriod(dates.shiftPeriod('month', this.data.anchor, 1).start);
  },

  onChip(e) {
    this.setData({ category: e.currentTarget.dataset.id });
    this.refresh();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.refresh(), 400);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.refresh();
  },

  onAdd() {
    capture.chooseEntry();
  },

  onReachBottom() {
    this.selectComponent('#feed').loadMore();
  },

  onPullDownRefresh() {
    Promise.all([this.selectComponent('#feed').reload(), this.loadSummary()]).finally(() => wx.stopPullDownRefresh());
  }
});
