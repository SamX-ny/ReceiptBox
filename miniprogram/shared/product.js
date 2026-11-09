// ⚠️ 自动生成：请修改仓库根目录 shared/ 下的源文件，然后运行 npm run sync
/**
 * 商品规格解析与归一化：用于“同一商品在不同时间、不同地点的价格追踪”。
 *
 * - parseSize('Coca-Cola Classic 2L')      -> { amount: 2000, base: 'ml', count: 1, label: '2L' }
 * - parseSize('Coke 24 x 375ml')           -> { amount: 9000, base: 'ml', count: 24, label: '24×375ml' }
 * - productKey({ productName: 'Coca-Cola Classic', spec: '2L' }) -> 'coca-cola-classic|2l'
 * - measurePrice(4, parseSize('2L'))       -> { value: 2, unit: 'L' }   // 每升 $2
 *
 * 源文件位于 shared/，`npm run sync` 会复制到小程序与云函数中。
 */

const UNIT_ALIASES = {
  ml: ['ml', 'mls', 'millilitre', 'milliliter', '毫升'],
  l: ['l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters', '升'],
  g: ['g', 'gm', 'gms', 'gram', 'grams', 'gr', '克'],
  kg: ['kg', 'kgs', 'kilo', 'kilogram', 'kilograms', '千克', '公斤'],
  pc: ['pk', 'pack', 'pcs', 'pc', 'piece', 'pieces', 'ea', 'each', 'ct', 'count', 'sheets', 'rolls', '个', '只', '片', '卷', '包', '支', '瓶', '罐', '袋', '盒']
};

const UNIT_LOOKUP = {};
Object.keys(UNIT_ALIASES).forEach(function (u) {
  UNIT_ALIASES[u].forEach(function (a) { UNIT_LOOKUP[a] = u; });
});

const UNIT_PATTERN = Object.keys(UNIT_LOOKUP)
  .sort(function (a, b) { return b.length - a.length; })
  .map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
  .join('|');

// 数字后紧跟单位；英文单位后面不能再接字母（避免把 "2lemons" 识别成 2L）
const SINGLE_RE = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_PATTERN + ')(?![a-z])', 'i');
const MULTI_RE = new RegExp('(\\d+)\\s*[x×*]\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_PATTERN + ')(?![a-z])', 'i');
const MULTI_REV_RE = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_PATTERN + ')\\s*[x×*]\\s*(\\d+)(?![a-z0-9])', 'i');

function round(n, d) {
  const p = Math.pow(10, d === undefined ? 2 : d);
  return Math.round((Number(n) + Number.EPSILON) * p) / p;
}

function toBase(value, unit) {
  switch (unit) {
    case 'ml': return { amount: value, base: 'ml' };
    case 'l': return { amount: value * 1000, base: 'ml' };
    case 'g': return { amount: value, base: 'g' };
    case 'kg': return { amount: value * 1000, base: 'g' };
    default: return { amount: value, base: 'pc' };
  }
}

function formatSingle(amount, base) {
  if (base === 'ml') return amount >= 1000 ? round(amount / 1000, 3) + 'L' : round(amount, 1) + 'ml';
  if (base === 'g') return amount >= 1000 ? round(amount / 1000, 3) + 'kg' : round(amount, 1) + 'g';
  return round(amount, 0) + '个';
}

/**
 * 从商品名称或规格文本中解析容量/重量/件数。
 * 返回 null 表示没有可识别的规格。
 */
function parseSize(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/，/g, ',');

  let m = s.match(MULTI_RE);
  if (m) {
    const count = parseInt(m[1], 10);
    const unit = UNIT_LOOKUP[m[3].toLowerCase()];
    const each = toBase(parseFloat(m[2]), unit);
    if (count > 0 && each.amount > 0) {
      return {
        amount: each.amount * count,
        base: each.base,
        count: count,
        label: count + '×' + formatSingle(each.amount, each.base)
      };
    }
  }

  m = s.match(MULTI_REV_RE);
  if (m) {
    const unit = UNIT_LOOKUP[m[2].toLowerCase()];
    const count = parseInt(m[3], 10);
    const each = toBase(parseFloat(m[1]), unit);
    if (count > 0 && each.amount > 0 && each.base !== 'pc') {
      return {
        amount: each.amount * count,
        base: each.base,
        count: count,
        label: count + '×' + formatSingle(each.amount, each.base)
      };
    }
  }

  m = s.match(SINGLE_RE);
  if (m) {
    const unit = UNIT_LOOKUP[m[2].toLowerCase()];
    const v = toBase(parseFloat(m[1]), unit);
    if (v.amount > 0) {
      return { amount: v.amount, base: v.base, count: v.base === 'pc' ? v.amount : 1, label: formatSingle(v.amount, v.base) };
    }
  }
  return null;
}

/** 去掉名称里的规格文本，例如 "Coca-Cola Classic 2L" -> "Coca-Cola Classic" */
function stripSize(name) {
  let s = String(name || '');
  s = s.replace(MULTI_RE, ' ').replace(MULTI_REV_RE, ' ').replace(SINGLE_RE, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** 生成用于比较的 slug：小写、仅保留字母数字与中文，其余字符折叠成 '-' */
function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 生成商品唯一键：名称（去规格）+ 规格。
 * 同一种商品在不同超市、不同日期购买会得到相同的 key，从而可以追踪价格。
 */
function productKey(item) {
  if (!item) return '';
  const rawName = item.productName || item.name || '';
  let base = slug(stripSize(rawName));
  const brandSlug = slug(item.brand);
  if (brandSlug && base.indexOf(brandSlug) !== 0) base = brandSlug + '-' + base;
  if (!base) return '';
  const size = parseSize(item.spec) || parseSize(rawName);
  // 规格标签由 parseSize 生成（只含数字、小数点与单位），保留小数点便于阅读，如 'coca-cola-classic|1.25l'
  return size ? base + '|' + size.label.replace('×', 'x').toLowerCase() : base;
}

/**
 * 计算按容量/重量折算的单价，便于不同规格之间横向比较。
 * - 称重商品（unit 为 kg/g/L/ml）直接使用其单价换算
 * - 其他商品根据规格计算：每升 / 每千克 / 每个
 */
function measurePrice(item) {
  if (!item) return null;
  const unit = String(item.unit || '').toLowerCase();
  const unitPrice = Number(item.unitPrice);
  if (unitPrice > 0) {
    if (unit === 'kg') return { value: round(unitPrice), unit: 'kg' };
    if (unit === 'g') return { value: round(unitPrice * 1000), unit: 'kg' };
    if (unit === 'l') return { value: round(unitPrice), unit: 'L' };
    if (unit === 'ml') return { value: round(unitPrice * 1000), unit: 'L' };
  }
  const size = parseSize(item.spec) || parseSize(item.productName) || parseSize(item.name);
  const price = unitPrice > 0 ? unitPrice : (Number(item.totalPrice) / (Number(item.quantity) || 1));
  if (!size || !(price > 0)) return null;
  if (size.base === 'ml') return { value: round(price / (size.amount / 1000)), unit: 'L' };
  if (size.base === 'g') return { value: round(price / (size.amount / 1000)), unit: 'kg' };
  if (size.count > 1) return { value: round(price / size.count), unit: '个' };
  return null;
}

module.exports = {
  parseSize: parseSize,
  stripSize: stripSize,
  slug: slug,
  productKey: productKey,
  measurePrice: measurePrice,
  round: round
};
