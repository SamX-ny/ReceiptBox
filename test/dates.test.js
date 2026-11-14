const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../shared/dates');

test('periodRange: 周从周一开始', () => {
  // 2026-11-09 是周一，2026-11-15 是周日
  assert.deepEqual(dates.periodRange('week', '2026-11-12'), { type: 'week', start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(dates.periodRange('week', '2026-11-15'), { type: 'week', start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(dates.periodRange('week', '2026-11-09'), { type: 'week', start: '2026-11-09', end: '2026-11-15' });
});

test('periodRange: 月与年', () => {
  assert.deepEqual(dates.periodRange('month', '2028-02-10'), { type: 'month', start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(dates.periodRange('year', '2026-06-01'), { type: 'year', start: '2026-01-01', end: '2026-12-31' });
});

test('shiftPeriod', () => {
  assert.equal(dates.shiftPeriod('month', '2026-03-31', -1).start, '2026-02-01');
  assert.equal(dates.shiftPeriod('week', '2026-11-12', -1).start, '2026-11-02');
  assert.equal(dates.shiftPeriod('day', '2026-01-01', -1).start, '2025-12-31');
  assert.equal(dates.shiftPeriod('year', '2026-05-05', 1).start, '2027-01-01');
});

test('seriesBuckets', () => {
  assert.equal(dates.seriesBuckets(dates.periodRange('month', '2026-11-01')).length, 30);
  const week = dates.seriesBuckets(dates.periodRange('week', '2026-11-12'));
  assert.equal(week.length, 7);
  assert.equal(week[0].label, '一');
  assert.equal(dates.seriesBuckets(dates.periodRange('year', '2026-11-01'))[10].key, '2026-11');
  assert.deepEqual(dates.seriesBuckets(dates.periodRange('day', '2026-11-01')), []);
});

test('daysBetween 跨夏令时', () => {
  assert.equal(dates.daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.equal(dates.daysBetween('2026-04-01', '2026-04-10'), 9);
});

test('normalizeReceiptDate: 澳洲 日/月/年', () => {
  assert.equal(dates.normalizeReceiptDate('08/11/2026 18:32'), '2026-11-08');
  assert.equal(dates.normalizeReceiptDate('8/11/26'), '2026-11-08');
  assert.equal(dates.normalizeReceiptDate('2026-11-08'), '2026-11-08');
  assert.equal(dates.normalizeReceiptDate('2026年11月8日'), '2026-11-08');
  assert.equal(dates.normalizeReceiptDate('Sun 8 Nov 2026'), '2026-11-08');
  assert.equal(dates.normalizeReceiptDate('31/02/2026', 'x'), 'x');
  assert.equal(dates.normalizeReceiptDate('no date here'), null);
});
