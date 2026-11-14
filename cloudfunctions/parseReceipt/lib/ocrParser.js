/**
 * 默认识别方案：微信 OCR（通用印刷体识别）得到的文字块 → 按行合并 → 规则解析为小票草稿。
 * 不依赖外部服务；商品名不做规范化，识别结果可在确认页手动修正。
 */

const categories = require('../shared/categories');
const dates = require('../shared/dates');

const PRICE_AT_END = /(-?)\s*\$?\s*(\d{1,5}(?:[.,]\d{2}))\s*(-?)\s*[A-Z^#*]{0,2}\s*$/;
const TOTAL_RE = /\b(total|amount\s*due|balance\s*due|to\s*pay|grand\s*total)\b|合计|总计|应付|实付|应收|实收/i;
const SUBTOTAL_RE = /sub\s*-?\s*total|小计/i;
const TAX_RE = /\bgst\b|\btax\b|税/i;
const DISCOUNT_RE = /\bless\b|saving|discount|promo|member\s*price|multi\s*-?buy|voucher|coupon|优惠|折扣|立减|满减/i;
const SKIP_RE = /eftpos|visa|mastercard|amex|debit|credit|cash\b|change\b|rounding|tendered|approved|card\s*no|account|terminal|auth|merchant\s*id|\babn\b|tel\b|phone|www\.|http|receipt\s*(no|#)|invoice\s*(no|#)|trans|ref\b|rewards|points|everyday\s*rewards|flybuys|balance\b|找零|现金|支付宝|微信支付|银行卡|会员|积分|电话|地址|单号|收银/i;
const QTY_AT_RE = /^(?:qty\s*)?(\d+(?:\.\d+)?)\s*(kg|g)?\s*(?:net\s*)?(?:@|x|×)\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:\/\s*(kg|g)|each|ea)?/i;
const PAYMENT_RE = /(eftpos|visa|mastercard|amex|apple\s*pay|google\s*pay|cash|支付宝|微信支付)/i;

function toNum(s) {
  return parseFloat(String(s).replace(',', '.'));
}

function cleanName(s) {
  return s.replace(/^[\s*#^]+|[\s*#^]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * @param {string[]} lines OCR 文本行（从上到下）
 * @param {Object} [opts] { defaultDate }
 */
function parseLines(lines, opts) {
  opts = opts || {};
  const clean = (lines || []).map(function (l) { return String(l || '').trim(); }).filter(Boolean);

  const draft = {
    merchant: { name: '', branch: '', address: '', type: 'other' },
    date: '',
    time: '',
    currency: /¥|元|rmb|cny/i.test(clean.join(' ')) ? 'CNY' : 'AUD',
    items: [],
    subtotal: null,
    tax: null,
    discount: null,
    total: null,
    paymentMethod: '',
    notes: '由 OCR 规则解析生成，请仔细核对'
  };

  // 商户：前 5 行中第一条包含字母/汉字且不像日期/地址的行
  for (let i = 0; i < Math.min(5, clean.length); i++) {
    const l = clean[i];
    if (/[a-z一-龥]{2,}/i.test(l) && !/\d{2}[/.-]\d{2}/.test(l) && !SKIP_RE.test(l) && !/tax\s*invoice/i.test(l)) {
      draft.merchant.name = cleanName(l).slice(0, 60);
      break;
    }
  }
  const head = clean.slice(0, 8).join(' ');
  draft.merchant.type = categories.guessMerchantType(draft.merchant.name + ' ' + head);
  const fallbackCategory = categories.defaultCategoryForMerchantType(draft.merchant.type);

  let pendingName = null;
  let inItems = true;

  clean.forEach(function (line) {
    if (!draft.date) {
      const d = dates.normalizeReceiptDate(line, null);
      if (d) draft.date = d;
    }
    if (!draft.time) {
      const t = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?\s*(am|pm)?\b/i);
      if (t) {
        let h = parseInt(t[1], 10);
        if (t[3] && /pm/i.test(t[3]) && h < 12) h += 12;
        if (t[3] && /am/i.test(t[3]) && h === 12) h = 0;
        draft.time = dates.pad(h) + ':' + t[2];
      }
    }
    if (!draft.paymentMethod) {
      const pm = line.match(PAYMENT_RE);
      if (pm) draft.paymentMethod = pm[1].toUpperCase() === pm[1] ? pm[1] : pm[1].replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    const pm = line.match(PRICE_AT_END);
    const price = pm ? toNum(pm[2]) * (pm[1] || pm[3] ? -1 : 1) : null;

    if (SUBTOTAL_RE.test(line)) {
      if (price !== null) draft.subtotal = Math.abs(price);
      inItems = false;
      return;
    }
    if (TOTAL_RE.test(line) && !TAX_RE.test(line)) {
      if (price !== null && draft.total === null) draft.total = Math.abs(price);
      inItems = false;
      return;
    }
    if (TAX_RE.test(line)) {
      if (price !== null && draft.tax === null) draft.tax = Math.abs(price);
      return;
    }
    if (SKIP_RE.test(line) || !inItems) return;

    // 数量/称重行：属于上一行商品
    const qty = line.match(QTY_AT_RE);
    if (qty) {
      const target = pendingName ? null : draft.items[draft.items.length - 1];
      let quantity = toNum(qty[1]);
      let unit = (qty[2] || qty[4] || '').toLowerCase();
      let unitPrice = toNum(qty[3]);
      if (unit === 'g') { quantity = quantity / 1000; unit = 'kg'; }
      const item = {
        name: pendingName || (target && target.name) || '',
        quantity: quantity,
        unit: unit === 'kg' ? 'kg' : 'each',
        unitPrice: unitPrice,
        totalPrice: price !== null ? Math.abs(price) : Math.round(quantity * unitPrice * 100) / 100,
        discount: 0
      };
      if (pendingName && item.name) {
        draft.items.push(finishItem(item, fallbackCategory));
        pendingName = null;
      } else if (target) {
        Object.assign(target, finishItem(Object.assign({}, target, item), fallbackCategory));
      }
      return;
    }

    if (price !== null && (price < 0 || DISCOUNT_RE.test(line))) {
      const last = draft.items[draft.items.length - 1];
      if (last) {
        const d = Math.abs(price);
        last.discount = Math.round((last.discount + d) * 100) / 100;
        last.totalPrice = Math.round((last.totalPrice - d) * 100) / 100;
      } else {
        draft.discount = (draft.discount || 0) + Math.abs(price);
      }
      return;
    }

    if (price !== null) {
      const name = cleanName(line.replace(PRICE_AT_END, ''));
      if (name && /[a-z一-龥]/i.test(name)) {
        draft.items.push(finishItem({ name: name, quantity: 1, unit: 'each', unitPrice: price, totalPrice: price, discount: 0 }, fallbackCategory));
        pendingName = null;
      } else if (pendingName) {
        draft.items.push(finishItem({ name: pendingName, quantity: 1, unit: 'each', unitPrice: price, totalPrice: price, discount: 0 }, fallbackCategory));
        pendingName = null;
      }
      return;
    }

    // 只有名字没有价格的行：可能是称重商品的名称，等待下一行
    if (/[a-z一-龥]{2,}/i.test(line) && line !== draft.merchant.name) {
      pendingName = cleanName(line).slice(0, 80);
    }
  });

  if (draft.total === null && draft.items.length) {
    draft.total = Math.round(draft.items.reduce(function (a, it) { return a + it.totalPrice; }, 0) * 100) / 100;
  }
  if (!draft.date && opts.defaultDate) draft.date = opts.defaultDate;
  return draft;
}

/**
 * 把 OCR 返回的文字块按坐标合并成“视觉上的一行”。
 * 小票上左边的商品名和右边的价格常被识别成两个独立的块，合并后才能正确配对。
 * items: [{ text, pos: { left_top: {x,y}, right_top, right_bottom, left_bottom } }]
 * 若任一文字块缺少坐标，按原顺序逐条返回。
 */
function linesFromOcrItems(items) {
  const texts = [];
  const boxes = [];
  let allHavePos = true;
  (items || []).forEach(function (it) {
    const text = String((it && it.text) || '').trim();
    if (!text) return;
    texts.push(text);
    const p = it.pos;
    const corners = p ? [p.left_top, p.right_top, p.right_bottom, p.left_bottom].filter(Boolean) : [];
    if (corners.length < 2) { allHavePos = false; return; }
    const ys = corners.map(function (c) { return Number(c.y) || 0; });
    const xs = corners.map(function (c) { return Number(c.x) || 0; });
    const top = Math.min.apply(null, ys);
    const bottom = Math.max.apply(null, ys);
    boxes.push({ text: text, top: top, bottom: bottom, mid: (top + bottom) / 2, h: Math.max(1, bottom - top), left: Math.min.apply(null, xs) });
  });
  if (!allHavePos || !boxes.length) return texts;

  boxes.sort(function (a, b) { return a.mid - b.mid; });
  const rows = [];
  boxes.forEach(function (b) {
    const row = rows[rows.length - 1];
    // 垂直中心相差不超过半个字高，视为同一行
    if (row && Math.abs(b.mid - row.mid) <= Math.min(b.h, row.h) * 0.5) {
      row.boxes.push(b);
      row.mid = (row.mid * (row.boxes.length - 1) + b.mid) / row.boxes.length;
      row.h = Math.max(row.h, b.h);
    } else {
      rows.push({ mid: b.mid, h: b.h, boxes: [b] });
    }
  });
  return rows.map(function (r) {
    return r.boxes.sort(function (a, b) { return a.left - b.left; }).map(function (b) { return b.text; }).join('   ');
  });
}

function finishItem(item, fallbackCategory) {
  item.productName = item.productName || '';
  item.brand = item.brand || '';
  item.spec = item.spec || '';
  item.category = categories.guessCategory(item.name, fallbackCategory);
  return item;
}

module.exports = {
  parseLines: parseLines,
  linesFromOcrItems: linesFromOcrItems
};
