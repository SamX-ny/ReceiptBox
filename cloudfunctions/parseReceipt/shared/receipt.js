// ⚠️ 自动生成：请修改仓库根目录 shared/ 下的源文件，然后运行 npm run sync
/**
 * 小票数据的清洗、校验与派生（价格记录、分类分摊）。
 *
 * 规范化后的小票结构：
 * {
 *   merchant: { name, branch, address, type },
 *   date: 'YYYY-MM-DD', time: 'HH:mm' | '',
 *   currency: 'AUD',
 *   items: [{ name, productName, brand, spec, quantity, unit, unitPrice,
 *             totalPrice, discount, category, productKey }],
 *   subtotal, tax, discount, total, paymentMethod,
 *   category,            // 主分类（金额占比最高的分类）
 *   note, imageFileID, source
 * }
 */

const categories = require('./categories');
const product = require('./product');
const dates = require('./dates');

const round = product.round;
const ITEM_UNITS = ['each', 'kg', 'g', 'L', 'ml'];
const MAX_ITEMS = 200;

function num(v, def) {
  if (v === null || v === undefined || v === '') return def === undefined ? 0 : def;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : (def === undefined ? 0 : def);
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max || 100);
}

function normalizeUnit(u) {
  const s = String(u || '').toLowerCase();
  if (s === 'kg' || s === 'kgs' || s === '千克' || s === '公斤') return 'kg';
  if (s === 'g' || s === '克') return 'g';
  if (s === 'l' || s === 'lt' || s === 'litre' || s === '升') return 'L';
  if (s === 'ml' || s === '毫升') return 'ml';
  return 'each';
}

function sanitizeItem(raw, fallbackCategory) {
  const name = str(raw && (raw.name || raw.productName), 80);
  if (!name) return null;
  const unit = normalizeUnit(raw.unit);
  let quantity = num(raw.quantity, 1);
  if (!(quantity > 0)) quantity = 1;
  quantity = round(quantity, 3);

  let totalPrice = num(raw.totalPrice, NaN);
  let unitPrice = num(raw.unitPrice, NaN);
  const discount = Math.abs(num(raw.discount, 0));

  if (!isFinite(totalPrice) && isFinite(unitPrice)) totalPrice = unitPrice * quantity - discount;
  if (!isFinite(totalPrice)) totalPrice = 0;
  if (!isFinite(unitPrice) || unitPrice <= 0) unitPrice = quantity > 0 ? (totalPrice + discount) / quantity : totalPrice;

  const productName = str(raw.productName, 80) || product.stripSize(name) || name;
  const spec = str(raw.spec, 30) || ((product.parseSize(name) || {}).label || '');
  const category = categories.isCategory(raw.category)
    ? raw.category
    : categories.guessCategory(productName + ' ' + name, fallbackCategory);

  const item = {
    name: name,
    productName: productName,
    brand: str(raw.brand, 40),
    spec: spec,
    quantity: quantity,
    unit: unit,
    unitPrice: round(unitPrice),
    totalPrice: round(totalPrice),
    discount: round(discount),
    category: category
  };
  item.productKey = product.productKey(item);
  return item;
}

/**
 * 清洗来自识别结果或用户编辑表单的小票数据。
 * 不会抛错：无法识别的字段使用合理默认值；返回 { receipt, warnings }。
 */
function sanitizeReceipt(raw, opts) {
  raw = raw || {};
  opts = opts || {};
  const warnings = [];
  const merchantRaw = raw.merchant || {};
  const merchantName = str(merchantRaw.name || raw.merchantName, 60);
  const merchantType = categories.isMerchantType(merchantRaw.type)
    ? merchantRaw.type
    : categories.guessMerchantType(merchantName);
  const fallbackCategory = categories.defaultCategoryForMerchantType(merchantType);

  const items = [];
  (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).forEach(function (it) {
    const s = sanitizeItem(it, fallbackCategory);
    if (s) items.push(s);
  });

  const itemsSum = round(items.reduce(function (a, it) { return a + it.totalPrice; }, 0));
  let total = num(raw.total, NaN);
  if (!isFinite(total) || total < 0) {
    total = itemsSum;
    if (items.length) warnings.push('未识别到总金额，已按商品合计计算');
  }

  let date = dates.isDateStr(raw.date) ? raw.date : dates.normalizeReceiptDate(raw.date, null);
  if (!date) {
    date = opts.defaultDate || dates.today();
    warnings.push('未识别到日期，已默认为' + date);
  }
  const tm = String(raw.time || '').match(/^(\d{1,2}):(\d{2})/);
  const time = tm && +tm[1] < 24 && +tm[2] < 60 ? dates.pad(+tm[1]) + ':' + tm[2] : '';

  if (items.length && Math.abs(itemsSum - total) > Math.max(0.05, total * 0.02)) {
    warnings.push('商品合计 ' + itemsSum.toFixed(2) + ' 与小票总额 ' + total.toFixed(2) + ' 不一致，请核对');
  }

  const receipt = {
    merchant: {
      name: merchantName || '未知商户',
      branch: str(merchantRaw.branch, 60),
      address: str(merchantRaw.address, 120),
      type: merchantType
    },
    date: date,
    time: time,
    currency: str(raw.currency, 3).toUpperCase() || opts.currency || 'AUD',
    items: items,
    subtotal: round(num(raw.subtotal, itemsSum)),
    tax: round(num(raw.tax, 0)),
    discount: round(Math.abs(num(raw.discount, 0))),
    total: round(total),
    paymentMethod: str(raw.paymentMethod, 30),
    note: str(raw.note, 200),
    imageFileID: str(raw.imageFileID, 300),
    source: str(raw.source, 20) || 'manual'
  };
  if (categories.isCategory(raw.category) && !items.length) {
    receipt.category = raw.category;
  } else {
    receipt.category = primaryCategory(receipt, fallbackCategory);
  }
  return { receipt: receipt, warnings: warnings };
}

/**
 * 把小票总额按商品分类分摊（含折扣、附加费、找零舍入等差额），
 * 保证各分类之和等于小票实付总额。无商品明细时整单计入小票分类。
 */
function allocateByCategory(receipt) {
  const out = {};
  const total = num(receipt.total, 0);
  const items = receipt.items || [];
  const sums = {};
  let itemsSum = 0;
  items.forEach(function (it) {
    const v = Math.max(0, num(it.totalPrice, 0));
    sums[it.category || 'other'] = (sums[it.category || 'other'] || 0) + v;
    itemsSum += v;
  });
  if (!items.length || itemsSum <= 0) {
    out[receipt.category || 'other'] = round(total);
    return out;
  }
  const keys = Object.keys(sums);
  let allocated = 0;
  keys.forEach(function (k, i) {
    if (i === keys.length - 1) {
      out[k] = round(total - allocated);
    } else {
      out[k] = round(sums[k] / itemsSum * total);
      allocated += out[k];
    }
  });
  return out;
}

function primaryCategory(receipt, fallback) {
  if (!receipt.items || !receipt.items.length) return receipt.category || fallback || 'other';
  const alloc = allocateByCategory(receipt);
  let best = fallback || 'other';
  let bestV = -Infinity;
  Object.keys(alloc).forEach(function (k) {
    if (alloc[k] > bestV) { bestV = alloc[k]; best = k; }
  });
  return best;
}

/**
 * 由一张小票生成价格记录（每个商品一行），写入 priceRecords 集合用于价格追踪。
 * aliases: { productKey: canonicalKey | { productKey, productName, brand, category } }，用于用户合并过的同类商品。
 */
function buildPriceRecords(receipt, ctx) {
  ctx = ctx || {};
  const aliases = ctx.aliases || {};
  const records = [];
  (receipt.items || []).forEach(function (it, idx) {
    if (!it.productKey || !(it.unitPrice > 0)) return;
    // 别名：用户合并过的商品，统一使用目标商品的键、名称与分类
    let alias = aliases[it.productKey];
    if (typeof alias === 'string') alias = { productKey: alias };
    alias = alias || {};
    const measure = product.measurePrice(it);
    records.push({
      familyId: ctx.familyId,
      receiptId: ctx.receiptId,
      itemIndex: idx,
      productKey: alias.productKey || it.productKey,
      productName: alias.productName || it.productName || it.name,
      rawName: it.name,
      brand: alias.productName ? (alias.brand || '') : (it.brand || ''),
      spec: it.spec || '',
      category: alias.category || it.category,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
      discount: it.discount || 0,
      measurePrice: measure ? measure.value : null,
      measureUnit: measure ? measure.unit : '',
      merchantName: receipt.merchant.name,
      merchantBranch: receipt.merchant.branch || '',
      merchantType: receipt.merchant.type,
      date: receipt.date,
      currency: receipt.currency
    });
  });
  return records;
}

/**
 * 商户名的比较键：只忽略大小写、空格和标点这类写法差异。
 * 'Woolworths' 与 'WOOLWORTHS ' 相同；'Woolworths' 与 'Woolworths Metro' 是不同商户。
 */
function merchantKey(name) {
  return product.slug(name).replace(/-/g, '');
}

/**
 * 两张小票是否可能是同一张：同一天、金额相同、商户相同；
 * 两边都有时间时，时间也必须相同。a、b 需要有 date / total / time / merchant.name。
 */
function isSameReceipt(a, b) {
  if (!a || !b) return false;
  if (a.date !== b.date) return false;
  if (round(num(a.total, NaN)) !== round(num(b.total, NaN))) return false;
  if (merchantKey(a.merchant && a.merchant.name) !== merchantKey(b.merchant && b.merchant.name)) return false;
  if (a.time && b.time && a.time !== b.time) return false;
  return true;
}

module.exports = {
  merchantKey: merchantKey,
  isSameReceipt: isSameReceipt,
  ITEM_UNITS: ITEM_UNITS,
  num: num,
  sanitizeItem: sanitizeItem,
  sanitizeReceipt: sanitizeReceipt,
  allocateByCategory: allocateByCategory,
  primaryCategory: primaryCategory,
  buildPriceRecords: buildPriceRecords
};
