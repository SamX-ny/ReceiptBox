/**
 * 商品价格追踪：同一商品在不同时间、不同地点的价格。
 */
const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const categories = require('../../shared/categories');

Page({
  data: {
    key: '',
    loading: true,
    p: null,
    v: null,
    categoryNames: categories.CATEGORIES.map((c) => c.icon + ' ' + c.name)
  },

  onLoad(q) {
    this.setData({ key: decodeURIComponent(q.key || '') });
    this.load();
  },

  async load() {
    try {
      const res = await api.call('product.history', { productKey: this.data.key });
      const s = res.summary;
      const cat = format.category(res.product.category);
      const unitSuffix = res.product.unit && res.product.unit !== 'each' ? '/' + res.product.unit : '';
      const cheapest = s.stores[0];
      wx.setNavigationBarTitle({ title: res.product.productName.slice(0, 16) });
      this.setData({
        loading: false,
        p: res.product,
        v: {
          icon: cat.icon,
          tint: format.tint(cat.color),
          catName: cat.name,
          catIndex: categories.CATEGORY_IDS.indexOf(cat.id),
          unitSuffix: unitSuffix,
          latest: format.money(s.latest.price) + unitSuffix,
          latestWhere: s.latest.merchant + ' · ' + format.friendlyDate(s.latest.date),
          latestMeasure: s.latest.measurePrice ? format.money(s.latest.measurePrice) + '/' + s.latest.measureUnit : '',
          latestVsAvg: s.latestVsAvg,
          latestVsAvgText: format.percent(s.latestVsAvg),
          min: format.money(s.min.price),
          minWhere: s.min.merchant + ' · ' + format.shortDate(s.min.date),
          max: format.money(s.max.price),
          maxWhere: s.max.merchant + ' · ' + format.shortDate(s.max.date),
          avg: format.money(s.avg),
          count: s.count,
          cheapestStore: s.stores.length > 1 ? cheapest.name : '',
          chart: s.history.map((h) => ({
            date: h.date,
            label: format.shortDate(h.date),
            value: h.price,
            title: format.friendlyDate(h.date),
            sub: h.merchant
          })),
          stores: s.stores.map((st, i) => ({
            name: st.name,
            count: st.count,
            avg: format.money(st.avg),
            min: format.money(st.min),
            last: format.money(st.last),
            lastDate: format.shortDate(st.lastDate),
            best: i === 0 && s.stores.length > 1
          })),
          history: s.history.slice().reverse().map((h) => ({
            receiptId: h.receiptId,
            date: format.friendlyDate(h.date),
            merchant: h.merchant + (h.branch ? ' · ' + h.branch : ''),
            price: format.money(h.price) + unitSuffix,
            qty: h.unit === 'each' ? (h.quantity !== 1 ? '× ' + h.quantity : '') : h.quantity + h.unit,
            measure: h.measurePrice ? format.money(h.measurePrice) + '/' + h.measureUnit : ''
          })),
          variants: res.variants.map((x) => ({
            key: x.productKey,
            spec: x.spec || '未标规格',
            last: format.money(x.lastPrice),
            measure: x.measurePrice ? format.money(x.measurePrice) + '/' + x.measureUnit : '',
            where: x.lastMerchant + ' · ' + format.shortDate(x.lastDate)
          }))
        }
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  openReceipt(e) {
    wx.navigateTo({ url: '/pages/receipt-detail/index?id=' + e.currentTarget.dataset.id });
  },

  openVariant(e) {
    wx.redirectTo({ url: '/pages/product-detail/index?key=' + encodeURIComponent(e.currentTarget.dataset.key) });
  },

  onRename() {
    wx.showModal({
      title: '重命名商品',
      editable: true,
      placeholderText: '商品名称',
      content: this.data.p.productName,
      success: async (res) => {
        const name = (res.content || '').trim();
        if (!res.confirm || !name || name === this.data.p.productName) return;
        await api.call('product.rename', { productKey: this.data.key, productName: name }, { loading: '保存中' });
        app.markDirty();
        this.load();
      }
    });
  },

  async onCategory(e) {
    const cat = categories.CATEGORIES[Number(e.detail.value)];
    await api.call('product.rename', { productKey: this.data.key, productName: this.data.p.productName, category: cat.id }, { loading: '保存中' });
    app.markDirty();
    this.load();
  },

  onMerge() {
    wx.navigateTo({
      url: '/pages/product-pick/index?mergeFrom=' + encodeURIComponent(this.data.key) + '&mergeName=' + encodeURIComponent(this.data.p.productName)
    });
  },

  /** 合并完成后由选择页回调 */
  onMerged(toKey) {
    this.setData({ key: toKey, loading: true });
    this.load();
  }
});
