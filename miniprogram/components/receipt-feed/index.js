/**
 * 按日期分组的小票流，支持筛选与分页。
 *   <rb-receipt-feed id="feed" filter="{{filter}}" />
 *   页面 onReachBottom 中调用 this.selectComponent('#feed').loadMore()
 *
 * filter: { start, end, category, merchant, merchantType, keyword }
 */
const api = require('../../utils/api');
const format = require('../../utils/format');

const PAGE_SIZE = 20;

Component({
  properties: {
    filter: { type: Object, value: {} },
    emptyText: { type: String, value: '没有找到小票' }
  },

  data: {
    groups: [],
    loading: false,
    hasMore: true,
    loaded: false
  },

  observers: {
    filter: function () {
      this.reload();
    }
  },

  methods: {
    reload() {
      this._list = [];
      this._skip = 0;
      this._seq = (this._seq || 0) + 1;
      this.setData({ groups: [], hasMore: true, loaded: false });
      return this.loadMore();
    },

    async loadMore() {
      if (this.data.loading || !this.data.hasMore) return;
      const seq = this._seq;
      this.setData({ loading: true });
      try {
        const res = await api.call('receipt.list', Object.assign({}, this.properties.filter, { skip: this._skip || 0, limit: PAGE_SIZE }));
        if (seq !== this._seq) return; // 筛选条件已变化，丢弃旧结果
        this._list = (this._list || []).concat(res.list);
        this._skip = res.nextSkip;
        this.setData({ groups: this.group(this._list), hasMore: res.hasMore, loaded: true });
      } catch (e) {
        if (seq === this._seq) this.setData({ loaded: true });
      } finally {
        if (seq === this._seq) this.setData({ loading: false });
      }
    },

    group(list) {
      const out = [];
      let cur = null;
      list.forEach((r) => {
        if (!cur || cur.date !== r.date) {
          cur = { date: r.date, label: format.friendlyDate(r.date), total: 0, receipts: [] };
          out.push(cur);
        }
        cur.total += Number(r.total) || 0;
        cur.receipts.push(r);
      });
      out.forEach((g) => { g.totalText = format.money(g.total); });
      return out;
    }
  }
});
