/**
 * 商品列表页面定义：比价 tab（pages/products）与合并选择页（pages/product-pick）共用。
 *
 * 商品比价：所有买过的商品，按最近购买/购买次数排序，可搜索、按分类筛选。
 * 合并模式（从商品详情进入，?mergeFrom=key）：选择要并入的目标商品。
 */
const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const categories = require('../../shared/categories');

const SORTS = [
  { id: 'recent', name: '最近购买' },
  { id: 'frequent', name: '购买次数' },
  { id: 'name', name: '名称' }
];

module.exports = function createProductsPage() {
  return {
    data: {
      sorts: SORTS,
      sort: 'recent',
      keyword: '',
      category: '',
      chips: [{ id: '', label: '全部' }].concat(categories.CATEGORIES.map((c) => ({ id: c.id, label: c.icon + ' ' + c.name }))),
      list: [],
      loading: false,
      hasMore: true,
      loaded: false,
      mergeFrom: '',
      mergeName: ''
    },

    onLoad(q) {
      if (q.mergeFrom) {
        this.setData({ mergeFrom: decodeURIComponent(q.mergeFrom), mergeName: decodeURIComponent(q.mergeName || '') });
        wx.setNavigationBarTitle({ title: '选择合并到的商品' });
        this.reload();
      }
    },

    onShow() {
      if (this.data.mergeFrom) return;
      if (app.consumeDirty('products') || !this.data.loaded) this.reload();
    },

    onPullDownRefresh() {
      this.reload().finally(() => wx.stopPullDownRefresh());
    },

    onReachBottom() {
      this.loadMore();
    },

    reload() {
      this._skip = 0;
      this._seq = (this._seq || 0) + 1;
      this.setData({ list: [], hasMore: true, loading: false });
      return this.loadMore();
    },

    async loadMore() {
      if (this.data.loading || !this.data.hasMore) return;
      const seq = this._seq;
      this.setData({ loading: true });
      try {
        const res = await api.call('product.list', {
          keyword: this.data.keyword,
          category: this.data.category,
          sort: this.data.sort,
          skip: this._skip,
          limit: 30
        });
        if (seq !== this._seq) return;
        this._skip = res.nextSkip;
        const rows = res.list
          .filter((p) => p.productKey !== this.data.mergeFrom)
          .map((p) => {
            const cat = format.category(p.category);
            const unit = p.lastUnit && p.lastUnit !== 'each' ? '/' + p.lastUnit : '';
            return {
              key: p.productKey,
              name: p.productName,
              spec: p.spec,
              icon: cat.icon,
              lastPrice: format.money(p.lastPrice) + unit,
              lastWhere: p.lastMerchant + ' · ' + format.friendlyDate(p.lastDate),
              range: p.minPrice !== p.maxPrice ? format.money(p.minPrice) + ' ~ ' + format.money(p.maxPrice) : '',
              measure: p.measurePrice ? format.money(p.measurePrice) + '/' + p.measureUnit : '',
              count: p.count,
              storeCount: p.storeCount,
              trend: p.lastPrice > p.minPrice ? 'up' : ''
            };
          });
        this.setData({ list: this.data.list.concat(rows), hasMore: res.hasMore, loaded: true });
      } catch (e) {
        if (seq === this._seq) this.setData({ loaded: true });
      } finally {
        if (seq === this._seq) this.setData({ loading: false });
      }
    },

    onSort(e) {
      this.setData({ sort: e.currentTarget.dataset.id });
      this.reload();
    },

    onChip(e) {
      this.setData({ category: e.currentTarget.dataset.id });
      this.reload();
    },

    onSearchInput(e) {
      this.setData({ keyword: e.detail.value });
      clearTimeout(this._t);
      this._t = setTimeout(() => this.reload(), 400);
    },

    onSearchClear() {
      this.setData({ keyword: '' });
      this.reload();
    },

    onTap(e) {
      const key = e.currentTarget.dataset.key;
      const name = e.currentTarget.dataset.name;
      if (!this.data.mergeFrom) {
        wx.navigateTo({ url: '/pages/product-detail/index?key=' + encodeURIComponent(key) });
        return;
      }
      wx.showModal({
        title: '合并商品',
        content: '把「' + this.data.mergeName + '」的价格记录合并到「' + name + '」？以后识别到前者也会自动归入后者。',
        confirmText: '合并',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await api.call('product.merge', { fromKey: this.data.mergeFrom, toKey: key }, { loading: '合并中' });
            app.markDirty();
            const pages = getCurrentPages();
            const prev = pages[pages.length - 2];
            if (prev && prev.onMerged) prev.onMerged(key);
            wx.navigateBack();
          } catch (err) {}
        }
      });
    }
  };
};
