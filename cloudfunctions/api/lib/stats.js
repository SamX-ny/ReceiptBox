/**
 * 统计接口：首页概览、按日/周/月/年的多维度统计。
 */

const { db, _, $, AppError, fetchAll } = require('./db');
const statsLib = require('../shared/stats');
const dates = require('../shared/dates');

const STATS_FIELDS = {
  date: true, time: true, total: true, merchant: true, category: true, items: true
};

function checkRange(type, anchor) {
  if (dates.PERIOD_TYPES.indexOf(type) < 0) throw new AppError('INVALID_ARGUMENT', '统计周期错误');
  if (!dates.isDateStr(anchor)) throw new AppError('INVALID_ARGUMENT', '日期格式错误');
  return dates.periodRange(type, anchor);
}

function loadReceipts(familyId, range) {
  return fetchAll(
    db.collection('receipts').where({ familyId: familyId, date: _.gte(range.start).and(_.lte(range.end)) }),
    { field: STATS_FIELDS, max: 20000 }
  );
}

async function sumRange(familyId, range) {
  const res = await db.collection('receipts').aggregate()
    .match({ familyId: familyId, date: _.gte(range.start).and(_.lte(range.end)) })
    .group({ _id: null, total: $.sum('$total'), count: $.sum(1) })
    .end();
  const row = res.list[0];
  return { total: row ? Math.round(row.total * 100) / 100 : 0, count: row ? row.count : 0 };
}

/**
 * 入参：{ type: 'day'|'week'|'month'|'year', date: 'YYYY-MM-DD' }
 * 返回：统计汇总 + 上一周期对比
 */
async function summary(ctx, params) {
  const range = checkRange(params.type, params.date);
  const prevRange = dates.shiftPeriod(range.type, range.start, -1);
  const results = await Promise.all([loadReceipts(ctx.family._id, range), sumRange(ctx.family._id, prevRange)]);
  const s = statsLib.summarize(results[0], range, { topN: 10 });
  s.label = dates.periodLabel(range);
  s.previous = { range: prevRange, label: dates.periodLabel(prevRange), total: results[1].total, count: results[1].count };
  s.change = statsLib.changePercent(s.total, results[1].total);
  return s;
}

/** 首页概览：今日、本周、本月（含分类）与上月对比 */
async function overview(ctx, params) {
  const today = dates.isDateStr(params.today) ? params.today : dates.today();
  const month = dates.periodRange('month', today);
  const week = dates.periodRange('week', today);
  const lastMonth = dates.shiftPeriod('month', today, -1);
  const results = await Promise.all([
    loadReceipts(ctx.family._id, month),
    sumRange(ctx.family._id, week),
    sumRange(ctx.family._id, lastMonth)
  ]);
  const monthStats = statsLib.summarize(results[0], month, { topN: 5 });
  const todayTotal = results[0]
    .filter(function (r) { return r.date === today; })
    .reduce(function (a, r) { return a + (Number(r.total) || 0); }, 0);
  return {
    today: { date: today, total: Math.round(todayTotal * 100) / 100 },
    week: { range: week, total: results[1].total, count: results[1].count },
    month: {
      range: month,
      label: dates.periodLabel(month),
      total: monthStats.total,
      count: monthStats.count,
      avgPerDay: monthStats.avgPerDay,
      byCategory: monthStats.byCategory.slice(0, 5),
      series: monthStats.series
    },
    lastMonth: { range: lastMonth, total: results[2].total, change: statsLib.changePercent(monthStats.total, results[2].total) }
  };
}

module.exports = {
  actions: {
    'stats.summary': summary,
    'stats.overview': overview
  }
};
