const config = require('../config');
const dates = require('../shared/dates');
const categories = require('../shared/categories');

function money(n, opts) {
  opts = opts || {};
  const v = Number(n) || 0;
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + (opts.symbol === false ? '' : config.currencySymbol) + s;
}

/** 大数字简写，用于图表坐标轴 */
function shortMoney(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return config.currencySymbol + (v / 1000).toFixed(0) + 'k';
  if (v >= 1000) return config.currencySymbol + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return config.currencySymbol + Math.round(v);
}

function percent(p) {
  if (p === null || p === undefined) return '';
  return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
}

/** 'YYYY-MM-DD' → 今天 / 昨天 / 11月8日 周日 */
function friendlyDate(s) {
  if (!s) return '';
  const t = dates.today();
  if (s === t) return '今天';
  if (s === dates.addDays(t, -1)) return '昨天';
  const d = dates.parseDateStr(s);
  const sameYear = s.slice(0, 4) === t.slice(0, 4);
  return (sameYear ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + dates.weekdayName(s);
}

function shortDate(s) {
  if (!s) return '';
  const d = dates.parseDateStr(s);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function category(id) {
  return categories.getCategory(id);
}

function merchantType(id) {
  return categories.getMerchantType(id);
}

module.exports = {
  money: money,
  shortMoney: shortMoney,
  percent: percent,
  friendlyDate: friendlyDate,
  shortDate: shortDate,
  category: category,
  merchantType: merchantType
};
