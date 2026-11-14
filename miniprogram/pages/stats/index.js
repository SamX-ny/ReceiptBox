/**
 * 统计：按日 / 周 / 月 / 年切换，展示总额、环比、趋势、分类、商户、商品排行。
 * 日视图额外列出当天每张小票的购买地点与商品类型。
 */
const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const dates = require('../../shared/dates');

const TYPES = [
  { id: 'day', name: '日' },
  { id: 'week', name: '周' },
  { id: 'month', name: '月' },
  { id: 'year', name: '年' }
];
const PREV_NAME = { day: '前一天', week: '上周', month: '上月', year: '去年' };

function rank(list, mapFn) {
  const max = list.length ? list[0].amount : 0;
  return list.map((x) => Object.assign(mapFn(x), {
    amountText: format.money(x.amount),
    percent: x.percent,
    width: max > 0 ? Math.max(2, x.amount / max * 100) : 0
  }));
}

Page({
  data: {
    types: TYPES,
    type: 'month',
    anchor: dates.today(),
    today: dates.today(),
    label: '',
    isCurrent: true,
    loading: true,
    s: null,
    dayReceipts: []
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (app.consumeDirty('stats') && this._shown) this.load();
    this._shown = true;
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onType(e) {
    const type = e.currentTarget.dataset.id;
    if (type === this.data.type) return;
    this.setData({ type: type });
    this.load();
  },

  onPrev() {
    this.setData({ anchor: dates.shiftPeriod(this.data.type, this.data.anchor, -1).start });
    this.load();
  },

  onNext() {
    if (this.data.isCurrent) return;
    const next = dates.shiftPeriod(this.data.type, this.data.anchor, 1);
    this.setData({ anchor: next.start > dates.today() ? dates.today() : next.start });
    this.load();
  },

  onPickDate(e) {
    // fields=year/month 时返回 'YYYY' / 'YYYY-MM'
    const v = e.detail.value;
    this.setData({ anchor: v.length === 4 ? v + '-01-01' : v.length === 7 ? v + '-01' : v });
    this.load();
  },

  async load() {
    const type = this.data.type;
    const range = dates.periodRange(type, this.data.anchor);
    this.setData({ loading: true, label: dates.periodLabel(range), isCurrent: range.end >= dates.today(), range: range });
    const seq = (this._seq = (this._seq || 0) + 1);
    try {
      const tasks = [api.call('stats.summary', { type: type, date: this.data.anchor })];
      if (type === 'day') tasks.push(api.call('receipt.list', { start: range.start, end: range.end, withItems: true, limit: 50 }));
      const [s, day] = await Promise.all(tasks);
      if (seq !== this._seq) return;
      this.setData({
        loading: false,
        s: this.view(s, type),
        dayReceipts: day ? this.dayView(day.list) : []
      });
    } catch (e) {
      if (seq === this._seq) this.setData({ loading: false });
    }
  },

  view(s, type) {
    return {
      total: format.money(s.total),
      count: s.count,
      itemCount: s.itemCount,
      avgPerDay: format.money(s.avgPerDay),
      avgPerReceipt: format.money(s.avgPerReceipt),
      activeDays: s.activeDays,
      days: s.days,
      prevName: PREV_NAME[type],
      prevTotal: format.money(s.previous.total),
      change: s.change,
      changeText: format.percent(s.change),
      series: s.series.map((p) => ({
        label: p.label,
        value: p.amount,
        title: type === 'year' ? p.label : format.friendlyDate(p.key)
      })),
      categories: rank(s.byCategory, (c) => {
        const cat = format.category(c.id);
        return { id: c.id, icon: cat.icon, tint: format.tint(cat.color), name: cat.name };
      }),
      merchants: rank(s.byMerchant, (m) => ({
        name: m.name,
        icon: format.merchantType(m.type).icon,
        tint: format.tint(format.merchantType(m.type).color),
        count: m.count
      })),
      merchantTypes: rank(s.byMerchantType, (m) => {
        const mt = format.merchantType(m.id);
        return { id: m.id, icon: mt.icon, tint: format.tint(mt.color), name: mt.name };
      }),
      topItems: s.topItems.map((it) => ({
        productKey: it.productKey,
        name: it.name,
        spec: it.spec,
        icon: format.category(it.category).icon,
        tint: format.tint(format.category(it.category).color),
        times: it.times,
        amountText: format.money(it.amount)
      }))
    };
  },

  dayView(list) {
    return list.map((r) => ({
      _id: r._id,
      icon: format.merchantType(r.merchant.type).icon,
      tint: format.tint(format.merchantType(r.merchant.type).color),
      merchant: r.merchant.name + (r.merchant.branch ? ' · ' + r.merchant.branch : ''),
      time: r.time,
      total: format.money(r.total),
      items: (r.items || []).map((it) => ({
        name: it.productName || it.name,
        spec: it.spec,
        icon: format.category(it.category).icon,
        cat: format.category(it.category).name,
        price: format.money(it.totalPrice)
      }))
    }));
  },

  openCategory(e) {
    const r = this.data.range;
    wx.navigateTo({ url: '/pages/receipt-list/index?category=' + e.currentTarget.dataset.id + '&start=' + r.start + '&end=' + r.end });
  },

  openMerchant(e) {
    const r = this.data.range;
    wx.navigateTo({ url: '/pages/receipt-list/index?merchant=' + encodeURIComponent(e.currentTarget.dataset.name) + '&start=' + r.start + '&end=' + r.end });
  },

  openMerchantType(e) {
    const r = this.data.range;
    wx.navigateTo({ url: '/pages/receipt-list/index?merchantType=' + e.currentTarget.dataset.id + '&start=' + r.start + '&end=' + r.end });
  },

  openItem(e) {
    const key = e.currentTarget.dataset.key;
    if (key) wx.navigateTo({ url: '/pages/product-detail/index?key=' + encodeURIComponent(key) });
  },

  openReceipt(e) {
    wx.navigateTo({ url: '/pages/receipt-detail/index?id=' + e.currentTarget.dataset.id });
  }
});
