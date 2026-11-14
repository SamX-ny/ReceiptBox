/**
 * 小票编辑 / 确认页。
 *   mode=create&jobId=xxx  核对后台识别任务的结果（识别失败的任务则带着照片手动填写）
 *   mode=manual            手动记一笔
 *   mode=edit&id=xxx  编辑已有小票
 */
const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const categories = require('../../shared/categories');
const dates = require('../../shared/dates');
const round = require('../../shared/product').round;

const UNITS = [
  { id: 'each', name: '件' },
  { id: 'kg', name: 'kg' },
  { id: 'g', name: 'g' },
  { id: 'L', name: 'L' },
  { id: 'ml', name: 'ml' }
];

let uid = 0;
function itemView(it) {
  const cat = categories.getCategory(it.category);
  const unitIdx = Math.max(0, UNITS.findIndex((u) => u.id === it.unit));
  return {
    key: 'k' + (++uid),
    name: it.name || '',
    productName: it.productName || '',
    brand: it.brand || '',
    spec: it.spec || '',
    quantity: it.quantity === undefined ? '1' : String(it.quantity),
    unitIndex: unitIdx,
    unitName: UNITS[unitIdx].name,
    unitPrice: it.unitPrice === undefined ? '' : String(it.unitPrice),
    totalPrice: it.totalPrice === undefined ? '' : String(it.totalPrice),
    discount: Number(it.discount) || 0,
    category: cat.id,
    catIcon: cat.icon,
    catTint: format.tint(cat.color),
    catName: cat.name,
    catIndex: categories.CATEGORY_IDS.indexOf(cat.id)
  };
}

function toNumber(s) {
  const n = parseFloat(String(s === undefined ? '' : s).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

Page({
  data: {
    mode: 'create',
    id: '',
    jobId: '',
    duplicateOf: '',
    loading: false,
    saving: false,
    warnings: [],
    engine: '',
    engineHint: '点击查看原图',
    imageFileID: '',
    imageUrl: '',
    source: 'manual',
    merchantTypes: categories.MERCHANT_TYPES,
    merchantTypeNames: categories.MERCHANT_TYPES.map((m) => m.icon + ' ' + m.name),
    categoryNames: categories.CATEGORIES.map((c) => c.icon + ' ' + c.name),
    unitNames: UNITS.map((u) => u.name),
    form: {
      merchantName: '',
      branch: '',
      merchantTypeIndex: categories.MERCHANT_TYPE_IDS.indexOf('other'),
      date: dates.today(),
      time: '',
      total: '',
      tax: '',
      paymentMethod: '',
      note: '',
      category: 'other',
      categoryIndex: categories.CATEGORY_IDS.indexOf('other')
    },
    items: [],
    itemsSum: '0.00',
    diffText: '',
    today: dates.today()
  },

  onLoad(query) {
    // create 模式必须来自一个识别任务；没有任务时按手动记账处理
    const jobId = query.jobId || '';
    const mode = query.mode === 'edit' ? 'edit' : jobId ? 'create' : 'manual';
    this.setData({ mode: mode, id: query.id || '', jobId: jobId });
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑小票' : mode === 'manual' ? '记一笔' : '确认小票' });

    if (mode === 'edit') this.loadExisting(query.id);
    else if (mode === 'create') this.loadJob(jobId);
    else this.addItem();
  },

  /** 从后台识别任务载入草稿。没保存就返回也不会丢：任务还在首页“待确认小票”里 */
  async loadJob(jobId) {
    this.setData({ loading: true });
    try {
      const job = await api.call('scan.get', { id: jobId }, { loading: '加载中' });
      const engine = job.engine;
      this.fill(job.draft);
      this.setData({
        imageUrl: job.imageUrl || '',
        duplicateOf: job.duplicateOf || '',
        warnings: job.warnings || [],
        engine: engine,
        engineHint: engine === 'qwen' || engine === 'claude' ? 'AI 识别结果，请核对后保存'
          : engine === 'wechat-ocr' ? 'OCR 规则识别，建议仔细核对' : '识别未成功，请对照照片手动填写'
      });
      if (!this.data.items.length) this.addItem();
    } catch (e) {
      if (e.code === 'NOT_FOUND') setTimeout(() => wx.navigateBack(), 1200);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadExisting(id) {
    this.setData({ loading: true });
    try {
      const r = await api.call('receipt.get', { id: id }, { loading: '加载中' });
      this.fill(r);
      this.setData({ imageUrl: r.imageUrl || '' });
    } finally {
      this.setData({ loading: false });
    }
  },

  fill(r) {
    const m = r.merchant || {};
    const mtIdx = categories.MERCHANT_TYPE_IDS.indexOf(m.type);
    const cat = categories.getCategory(r.category);
    this.setData({
      imageFileID: r.imageFileID || '',
      source: r.source || 'manual',
      form: {
        merchantName: m.name === '未知商户' ? '' : (m.name || ''),
        branch: m.branch || '',
        merchantTypeIndex: mtIdx >= 0 ? mtIdx : categories.MERCHANT_TYPE_IDS.indexOf('other'),
        date: r.date || dates.today(),
        time: r.time || '',
        total: r.total === undefined || r.total === null ? '' : String(r.total),
        tax: r.tax ? String(r.tax) : '',
        paymentMethod: r.paymentMethod || '',
        note: r.note || '',
        category: cat.id,
        categoryIndex: categories.CATEGORY_IDS.indexOf(cat.id)
      },
      items: (r.items || []).map(itemView)
    });
    this.recalc();
  },

  recalc() {
    const sum = this.data.items.reduce((a, it) => a + toNumber(it.totalPrice), 0);
    const total = toNumber(this.data.form.total);
    const diff = round(total - sum);
    let diffText = '';
    if (this.data.items.length && Math.abs(diff) >= 0.01) {
      diffText = diff > 0 ? '比商品合计多 ' + format.money(diff) + '（如附加费、找零舍入）' : '比商品合计少 ' + format.money(-diff) + '（如整单折扣）';
    }
    this.setData({ itemsSum: format.money(sum), diffText: diffText });
  },

  // ===== 小票字段 =====
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
    if (field === 'total') this.recalc();
  },

  onMerchantType(e) {
    this.setData({ 'form.merchantTypeIndex': Number(e.detail.value) });
  },

  onReceiptCategory(e) {
    const idx = Number(e.detail.value);
    this.setData({ 'form.categoryIndex': idx, 'form.category': categories.CATEGORY_IDS[idx] });
  },

  onDate(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onTime(e) {
    this.setData({ 'form.time': e.detail.value });
  },

  useItemsSum() {
    const sum = this.data.items.reduce((a, it) => a + toNumber(it.totalPrice), 0);
    this.setData({ 'form.total': String(round(sum)) });
    this.recalc();
  },

  // ===== 商品 =====
  addItem() {
    const mtIdx = this.data.form.merchantTypeIndex;
    const fallback = categories.defaultCategoryForMerchantType(categories.MERCHANT_TYPE_IDS[mtIdx]);
    this.setData({ items: this.data.items.concat([itemView({ category: fallback, quantity: 1 })]) });
  },

  removeItem(e) {
    const idx = e.currentTarget.dataset.index;
    const items = this.data.items.slice();
    items.splice(idx, 1);
    this.setData({ items: items });
    this.recalc();
  },

  onItemInput(e) {
    const idx = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const it = Object.assign({}, this.data.items[idx], { [field]: value });

    if (field === 'name') {
      // 名称修改后，productName 以新名称为准；未手动选过分类时自动推断
      it.productName = '';
      if (!it.categoryTouched) {
        const mtIdx = this.data.form.merchantTypeIndex;
        const fallback = categories.defaultCategoryForMerchantType(categories.MERCHANT_TYPE_IDS[mtIdx]);
        const cat = categories.getCategory(categories.guessCategory(value, fallback));
        Object.assign(it, { category: cat.id, catIcon: cat.icon, catTint: format.tint(cat.color), catName: cat.name, catIndex: categories.CATEGORY_IDS.indexOf(cat.id) });
      }
    }
    if (field === 'quantity' || field === 'unitPrice') {
      const q = toNumber(it.quantity);
      const p = toNumber(it.unitPrice);
      if (q > 0 && p > 0) it.totalPrice = String(round(q * p - (it.discount || 0)));
    }
    if (field === 'totalPrice' && toNumber(it.quantity) > 0 && !toNumber(it.unitPrice)) {
      it.unitPrice = String(round((toNumber(value) + (it.discount || 0)) / toNumber(it.quantity)));
    }
    this.setData({ ['items[' + idx + ']']: it });
    if (field === 'totalPrice' || field === 'quantity' || field === 'unitPrice') this.recalc();
  },

  onItemCategory(e) {
    const idx = e.currentTarget.dataset.index;
    const cat = categories.CATEGORIES[Number(e.detail.value)];
    this.setData({
      ['items[' + idx + '].category']: cat.id,
      ['items[' + idx + '].catIcon']: cat.icon,
      ['items[' + idx + '].catTint']: format.tint(cat.color),
      ['items[' + idx + '].catName']: cat.name,
      ['items[' + idx + '].catIndex']: Number(e.detail.value),
      ['items[' + idx + '].categoryTouched']: true
    });
  },

  onItemUnit(e) {
    const idx = e.currentTarget.dataset.index;
    const u = Number(e.detail.value);
    this.setData({ ['items[' + idx + '].unitIndex']: u, ['items[' + idx + '].unitName']: UNITS[u].name });
  },

  onPreviewImage() {
    if (this.data.imageUrl) wx.previewImage({ urls: [this.data.imageUrl] });
    else if (this.data.imageFileID) wx.previewImage({ urls: [this.data.imageFileID] });
  },

  // ===== 保存 =====
  buildPayload() {
    const f = this.data.form;
    return {
      merchant: {
        name: f.merchantName.trim(),
        branch: f.branch.trim(),
        type: categories.MERCHANT_TYPE_IDS[f.merchantTypeIndex] || 'other'
      },
      date: f.date,
      time: f.time,
      total: f.total === '' ? null : toNumber(f.total),
      tax: toNumber(f.tax),
      paymentMethod: f.paymentMethod.trim(),
      note: f.note.trim(),
      category: f.category,
      imageFileID: this.data.imageFileID,
      source: this.data.source,
      currency: 'AUD',
      items: this.data.items
        .filter((it) => it.name.trim())
        .map((it) => ({
          name: it.name.trim(),
          productName: it.productName,
          brand: it.brand,
          spec: it.spec.trim(),
          quantity: toNumber(it.quantity) || 1,
          unit: UNITS[it.unitIndex].id,
          unitPrice: toNumber(it.unitPrice),
          totalPrice: toNumber(it.totalPrice),
          discount: it.discount || 0,
          category: it.category
        }))
    };
  },

  validate(p) {
    if (!p.merchant.name) return '请填写商户名称';
    if (!(p.total > 0) && !p.items.length) return '请填写金额或至少一个商品';
    if (p.date > dates.addDays(dates.today(), 1)) return '日期不能晚于今天';
    return '';
  },

  async onSave(force) {
    if (this.data.saving) return;
    const payload = this.buildPayload();
    const msg = this.validate(payload);
    if (msg) {
      api.toast(msg);
      return;
    }
    this.setData({ saving: true });
    try {
      if (this.data.mode === 'edit') {
        const updated = await api.call('receipt.update', { id: this.data.id, receipt: payload, force: force === true }, { loading: '保存中' });
        if (updated.duplicateOf) {
          this.askDuplicate(updated.duplicateOf);
          return;
        }
        this.done();
        wx.navigateBack();
        return;
      }
      const res = await api.call('receipt.create', {
        receipt: payload,
        today: dates.today(),
        force: force === true,
        jobId: this.data.jobId || undefined
      }, { loading: '保存中' });
      if (res.duplicateOf) {
        this.askDuplicate(res.duplicateOf);
        return;
      }
      this.done();
      wx.redirectTo({ url: '/pages/receipt-detail/index?id=' + res._id + '&saved=1' });
    } catch (e) {
      // api.call 已提示错误
    } finally {
      this.setData({ saving: false });
    }
  },

  /** 保存时发现可能重复：让用户决定仍然保存，还是去看已有的那张 */
  askDuplicate(duplicateId) {
    wx.showModal({
      title: '可能重复',
      content: '同一天已有一张相同商户、相同金额的小票，仍然保存吗？',
      confirmText: '仍然保存',
      cancelText: '去看看',
      success: (r) => {
        if (r.confirm) this.onSave(true);
        else if (r.cancel) wx.navigateTo({ url: '/pages/receipt-detail/index?id=' + duplicateId });
      }
    });
  },

  onViewDuplicate() {
    wx.navigateTo({ url: '/pages/receipt-detail/index?id=' + this.data.duplicateOf });
  },

  done() {
    app.markDirty();
  },

  onSaveTap() {
    return this.onSave(false);
  }
});
