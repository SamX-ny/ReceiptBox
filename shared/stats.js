/**
 * 开销统计：按日 / 周 / 月 / 年，从分类、商户、商品、趋势多个维度汇总。
 * 纯函数，云函数与小程序端都可以调用（云函数端用于汇总，单测覆盖）。
 */

const receiptLib = require('./receipt');
const dates = require('./dates');
const round = require('./product').round;

function sortDesc(arr, key) {
  return arr.sort(function (a, b) { return b[key] - a[key]; });
}

/**
 * @param {Array} receipts 已规范化的小票（必须包含 date、total、items、merchant）
 * @param {Object} range   { type, start, end }，来自 dates.periodRange
 * @param {Object} [opts]  { topN }
 */
function summarize(receipts, range, opts) {
  opts = opts || {};
  const topN = opts.topN || 10;
  const granularity = dates.seriesGranularity(range.type);
  const buckets = dates.seriesBuckets(range);
  const seriesMap = {};
  buckets.forEach(function (b) { seriesMap[b.key] = 0; });

  const byCategory = {};
  const byMerchant = {};
  const byMerchantType = {};
  const byItem = {};
  const activeDays = {};
  let total = 0;
  let count = 0;
  let itemCount = 0;

  (receipts || []).forEach(function (r) {
    if (!r || r.date < range.start || r.date > range.end) return;
    const amount = Number(r.total) || 0;
    total += amount;
    count += 1;
    activeDays[r.date] = true;

    if (granularity) {
      const k = dates.bucketKey(r.date, granularity);
      if (seriesMap[k] !== undefined) seriesMap[k] += amount;
    }

    const alloc = receiptLib.allocateByCategory(r);
    Object.keys(alloc).forEach(function (c) {
      byCategory[c] = (byCategory[c] || 0) + alloc[c];
    });

    const mName = (r.merchant && r.merchant.name) || '未知商户';
    if (!byMerchant[mName]) byMerchant[mName] = { name: mName, type: (r.merchant && r.merchant.type) || 'other', amount: 0, count: 0 };
    byMerchant[mName].amount += amount;
    byMerchant[mName].count += 1;

    const mType = (r.merchant && r.merchant.type) || 'other';
    byMerchantType[mType] = (byMerchantType[mType] || 0) + amount;

    (r.items || []).forEach(function (it) {
      itemCount += 1;
      const key = it.productKey || it.name;
      if (!key) return;
      if (!byItem[key]) {
        byItem[key] = { productKey: it.productKey || '', name: it.productName || it.name, spec: it.spec || '', category: it.category, amount: 0, quantity: 0, times: 0 };
      }
      byItem[key].amount += Number(it.totalPrice) || 0;
      byItem[key].quantity += Number(it.quantity) || 0;
      byItem[key].times += 1;
    });
  });

  total = round(total);
  const pct = function (v) { return total > 0 ? round(v / total * 100, 1) : 0; };
  const days = dates.daysBetween(range.start, range.end) + 1;

  return {
    range: range,
    total: total,
    count: count,
    itemCount: itemCount,
    days: days,
    activeDays: Object.keys(activeDays).length,
    avgPerDay: round(total / days),
    avgPerReceipt: count ? round(total / count) : 0,
    byCategory: sortDesc(Object.keys(byCategory).map(function (c) {
      return { id: c, amount: round(byCategory[c]), percent: pct(byCategory[c]) };
    }), 'amount'),
    byMerchant: sortDesc(Object.keys(byMerchant).map(function (k) {
      const m = byMerchant[k];
      return { name: m.name, type: m.type, amount: round(m.amount), count: m.count, percent: pct(m.amount) };
    }), 'amount').slice(0, topN),
    byMerchantType: sortDesc(Object.keys(byMerchantType).map(function (t) {
      return { id: t, amount: round(byMerchantType[t]), percent: pct(byMerchantType[t]) };
    }), 'amount'),
    topItems: sortDesc(Object.keys(byItem).map(function (k) {
      const it = byItem[k];
      return { productKey: it.productKey, name: it.name, spec: it.spec, category: it.category, amount: round(it.amount), quantity: round(it.quantity, 3), times: it.times };
    }), 'amount').slice(0, topN),
    series: buckets.map(function (b) {
      return { key: b.key, label: b.label, amount: round(seriesMap[b.key]) };
    })
  };
}

/** 与上一周期对比的变化百分比；上期为 0 时返回 null */
function changePercent(current, previous) {
  if (!(previous > 0)) return null;
  return round((current - previous) / previous * 100, 1);
}

/**
 * 商品价格历史汇总：最低/最高/平均价、最近价格、各商户比较。
 * records: priceRecords（同一 productKey），任意顺序。
 */
function priceSummary(records) {
  const list = (records || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (!list.length) return null;
  let min = list[0];
  let max = list[0];
  let sum = 0;
  const stores = {};
  list.forEach(function (r) {
    if (r.unitPrice < min.unitPrice) min = r;
    if (r.unitPrice > max.unitPrice) max = r;
    sum += r.unitPrice;
    const s = r.merchantName || '未知商户';
    if (!stores[s]) stores[s] = { name: s, count: 0, sum: 0, min: Infinity, last: null, lastDate: '' };
    stores[s].count += 1;
    stores[s].sum += r.unitPrice;
    stores[s].min = Math.min(stores[s].min, r.unitPrice);
    if (r.date >= stores[s].lastDate) { stores[s].last = r.unitPrice; stores[s].lastDate = r.date; }
  });
  const latest = list[list.length - 1];
  const avg = sum / list.length;
  return {
    count: list.length,
    first: { price: list[0].unitPrice, date: list[0].date, merchant: list[0].merchantName },
    latest: { price: latest.unitPrice, date: latest.date, merchant: latest.merchantName, measurePrice: latest.measurePrice, measureUnit: latest.measureUnit },
    min: { price: min.unitPrice, date: min.date, merchant: min.merchantName },
    max: { price: max.unitPrice, date: max.date, merchant: max.merchantName },
    avg: round(avg),
    latestVsAvg: changePercent(latest.unitPrice, avg),
    stores: Object.keys(stores).map(function (k) {
      const s = stores[k];
      return { name: s.name, count: s.count, avg: round(s.sum / s.count), min: round(s.min), last: s.last, lastDate: s.lastDate };
    }).sort(function (a, b) { return a.avg - b.avg; }),
    history: list.map(function (r) {
      return {
        date: r.date,
        price: r.unitPrice,
        quantity: r.quantity,
        unit: r.unit,
        merchant: r.merchantName,
        branch: r.merchantBranch || '',
        measurePrice: r.measurePrice,
        measureUnit: r.measureUnit,
        receiptId: r.receiptId
      };
    })
  };
}

module.exports = {
  summarize: summarize,
  changePercent: changePercent,
  priceSummary: priceSummary
};
