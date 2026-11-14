/**
 * 小票列表行：商户、时间、商品数、主分类与金额。点击进入详情。
 */
const format = require('../../utils/format');

Component({
  properties: {
    receipt: { type: Object, value: null },
    showDate: { type: Boolean, value: false }
  },

  data: { view: null },

  observers: {
    'receipt, showDate': function (r, showDate) {
      if (!r) return;
      const mt = format.merchantType(r.merchant && r.merchant.type);
      const cat = format.category(r.category);
      const meta = [];
      if (showDate) meta.push(format.friendlyDate(r.date));
      if (r.time) meta.push(r.time);
      if (r.itemCount) meta.push(r.itemCount + ' 件商品');
      this.setData({
        view: {
          icon: mt.icon,
          tint: format.tint(mt.color),
          name: (r.merchant && r.merchant.name) || '未知商户',
          branch: (r.merchant && r.merchant.branch) || '',
          meta: meta.join(' · '),
          category: cat.icon + ' ' + cat.name,
          amount: format.money(r.total)
        }
      });
    }
  },

  methods: {
    onTap() {
      if (!this.properties.receipt) return;
      wx.navigateTo({ url: '/pages/receipt-detail/index?id=' + this.properties.receipt._id });
    }
  }
});
