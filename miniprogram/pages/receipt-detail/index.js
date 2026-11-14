const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const product = require('../../shared/product');

Page({
  data: {
    id: '',
    loading: true,
    r: null,
    view: null
  },

  onLoad(query) {
    this.setData({ id: query.id });
    if (query.saved) wx.showToast({ title: '已保存', icon: 'success' });
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const r = await api.call('receipt.get', { id: this.data.id });
      const mt = format.merchantType(r.merchant.type);
      const groups = {};
      (r.items || []).forEach((it, i) => {
        const cat = format.category(it.category);
        if (!groups[cat.id]) groups[cat.id] = { id: cat.id, icon: cat.icon, tint: format.tint(cat.color), name: cat.name, amount: 0, items: [] };
        const measure = product.measurePrice(it);
        groups[cat.id].amount += it.totalPrice;
        groups[cat.id].items.push({
          i: i,
          name: it.productName || it.name,
          rawName: it.productName && it.productName !== it.name ? it.name : '',
          spec: it.spec,
          productKey: it.productKey,
          qty: it.unit === 'each' ? (it.quantity !== 1 ? it.quantity + ' × ' + format.money(it.unitPrice) : '') : it.quantity + it.unit + ' × ' + format.money(it.unitPrice) + '/' + it.unit,
          measure: measure ? format.money(measure.value) + '/' + measure.unit : '',
          discount: it.discount ? format.money(it.discount) : '',
          total: format.money(it.totalPrice)
        });
      });
      const catGroups = Object.keys(groups).map((k) => Object.assign(groups[k], { amountText: format.money(groups[k].amount) }))
        .sort((a, b) => b.amount - a.amount);
      this.setData({
        loading: false,
        r: r,
        view: {
          merchantIcon: mt.icon,
          merchantTint: format.tint(mt.color),
          merchantType: mt.name,
          merchantName: r.merchant.name,
          branch: r.merchant.branch,
          address: r.merchant.address,
          date: format.friendlyDate(r.date) + (r.time ? ' ' + r.time : ''),
          total: format.money(r.total),
          tax: r.tax ? format.money(r.tax) : '',
          discount: r.discount ? format.money(r.discount) : '',
          paymentMethod: r.paymentMethod,
          note: r.note,
          createdByName: r.createdByName,
          source: r.source === 'qwen' || r.source === 'claude' ? 'AI 识别' : r.source === 'wechat-ocr' ? 'OCR 识别' : '手动录入',
          category: format.category(r.category),
          groups: catGroups,
          itemCount: (r.items || []).length
        }
      });
    } catch (e) {
      this.setData({ loading: false });
      if (e.code === 'NOT_FOUND') setTimeout(() => wx.navigateBack(), 1200);
    }
  },

  onPreview() {
    if (this.data.r && this.data.r.imageUrl) wx.previewImage({ urls: [this.data.r.imageUrl] });
  },

  onItemTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key) wx.navigateTo({ url: '/pages/product-detail/index?key=' + encodeURIComponent(key) });
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/receipt-edit/index?mode=edit&id=' + this.data.id });
  },

  onDelete() {
    wx.showModal({
      title: '删除小票',
      content: '删除后这张小票及其商品价格记录都会移除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.call('receipt.delete', { id: this.data.id }, { loading: '删除中' });
          app.markDirty();
          wx.navigateBack();
        } catch (e) {}
      }
    });
  },

  onMerchantTap() {
    const name = this.data.r && this.data.r.merchant.name;
    if (name) wx.navigateTo({ url: '/pages/receipt-list/index?merchant=' + encodeURIComponent(name) });
  }
});
