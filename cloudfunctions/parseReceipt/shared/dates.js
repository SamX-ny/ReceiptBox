// ⚠️ 自动生成：请修改仓库根目录 shared/ 下的源文件，然后运行 npm run sync
/**
 * 日期工具。所有小票日期都以本地日期字符串 'YYYY-MM-DD' 存储与比较，
 * 这样云函数（运行在 UTC+8）与身在澳洲的用户之间不会出现时区偏差。
 *
 * 周从周一开始。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PERIOD_TYPES = ['day', 'week', 'month', 'year'];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function toDateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDateStr(s);
  return toDateStr(d) === s;
}

function parseDateStr(s) {
  const p = String(s).split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function today() {
  return toDateStr(new Date());
}

function addDays(s, n) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function daysBetween(a, b) {
  // 用 UTC 计算以规避夏令时切换导致的 23/25 小时
  const pa = String(a).split('-').map(Number);
  const pb = String(b).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function lastDayOfMonth(y, m) {
  // m: 1-12
  return new Date(y, m, 0).getDate();
}

/** 返回包含日期 s 的周期范围 { type, start, end } */
function periodRange(type, s) {
  const date = s || today();
  const d = parseDateStr(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  switch (type) {
    case 'day':
      return { type: type, start: date, end: date };
    case 'week': {
      const offset = (d.getDay() + 6) % 7; // 周一 = 0
      const start = addDays(date, -offset);
      return { type: type, start: start, end: addDays(start, 6) };
    }
    case 'month':
      return { type: type, start: y + '-' + pad(m) + '-01', end: y + '-' + pad(m) + '-' + pad(lastDayOfMonth(y, m)) };
    case 'year':
      return { type: type, start: y + '-01-01', end: y + '-12-31' };
    default:
      throw new Error('unknown period type: ' + type);
  }
}

/** 将周期向前/向后平移 n 个单位，返回新周期 */
function shiftPeriod(type, s, n) {
  const d = parseDateStr(periodRange(type, s).start);
  if (type === 'day') d.setDate(d.getDate() + n);
  else if (type === 'week') d.setDate(d.getDate() + 7 * n);
  else if (type === 'month') d.setMonth(d.getMonth() + n);
  else if (type === 'year') d.setFullYear(d.getFullYear() + n);
  return periodRange(type, toDateStr(d));
}

function periodLabel(range) {
  const s = parseDateStr(range.start);
  const e = parseDateStr(range.end);
  switch (range.type) {
    case 'day':
      return (s.getMonth() + 1) + '月' + s.getDate() + '日 ' + WEEKDAYS[s.getDay()];
    case 'week':
      return (s.getMonth() + 1) + '/' + s.getDate() + ' - ' + (e.getMonth() + 1) + '/' + e.getDate();
    case 'month':
      return s.getFullYear() + '年' + (s.getMonth() + 1) + '月';
    case 'year':
      return s.getFullYear() + '年';
    default:
      return range.start + ' ~ ' + range.end;
  }
}

/** 趋势图的时间粒度：日视图不画趋势，周/月按天，年按月 */
function seriesGranularity(type) {
  if (type === 'year') return 'month';
  if (type === 'day') return null;
  return 'day';
}

/** 生成趋势图的空桶（key 与标签），保证没有消费的日期也会显示为 0 */
function seriesBuckets(range) {
  const g = seriesGranularity(range.type);
  const buckets = [];
  if (g === 'day') {
    const n = daysBetween(range.start, range.end);
    for (let i = 0; i <= n; i++) {
      const ds = addDays(range.start, i);
      const d = parseDateStr(ds);
      buckets.push({
        key: ds,
        label: range.type === 'week' ? WEEKDAYS[d.getDay()].slice(1) : String(d.getDate())
      });
    }
  } else if (g === 'month') {
    const y = range.start.slice(0, 4);
    for (let mi = 1; mi <= 12; mi++) {
      buckets.push({ key: y + '-' + pad(mi), label: mi + '月' });
    }
  }
  return buckets;
}

function bucketKey(dateStr, granularity) {
  return granularity === 'month' ? dateStr.slice(0, 7) : dateStr;
}

function weekdayName(s) {
  return WEEKDAYS[parseDateStr(s).getDay()];
}

/** 尝试把小票上的各种日期写法转换为 'YYYY-MM-DD'（澳洲习惯为 日/月/年） */
function normalizeReceiptDate(text, fallback) {
  if (!text) return fallback || null;
  const s = String(text).trim();
  let m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  let y, mo, d;
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else {
    m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // 兼容 月/日/年
    } else {
      const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      m = s.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{2,4})/i);
      if (!m) return fallback || null;
      d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
      if (y < 100) y += 2000;
    }
  }
  const out = y + '-' + pad(mo) + '-' + pad(d);
  return isDateStr(out) ? out : (fallback || null);
}

module.exports = {
  WEEKDAYS: WEEKDAYS,
  PERIOD_TYPES: PERIOD_TYPES,
  pad: pad,
  toDateStr: toDateStr,
  isDateStr: isDateStr,
  parseDateStr: parseDateStr,
  today: today,
  addDays: addDays,
  daysBetween: daysBetween,
  periodRange: periodRange,
  shiftPeriod: shiftPeriod,
  periodLabel: periodLabel,
  seriesGranularity: seriesGranularity,
  seriesBuckets: seriesBuckets,
  bucketKey: bucketKey,
  weekdayName: weekdayName,
  normalizeReceiptDate: normalizeReceiptDate
};
