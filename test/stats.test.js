const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../shared/stats');
const dates = require('../shared/dates');
const receiptLib = require('../shared/receipt');

function r(raw) { return receiptLib.sanitizeReceipt(raw).receipt; }

const receipts = [
  r({ merchant: { name: 'Woolworths' }, date: '2026-11-02', total: 10, items: [{ name: 'Coca-Cola 2L', totalPrice: 4 }, { name: 'Milk 2L', totalPrice: 6 }] }),
  r({ merchant: { name: 'Coles' }, date: '2026-11-03', total: 4.5, items: [{ name: 'Coca-Cola 2L', totalPrice: 4.5 }] }),
  r({ merchant: { name: 'Din Tai Fung Restaurant' }, date: '2026-11-03', total: 60, items: [] }),
  r({ merchant: { name: 'Woolworths' }, date: '2026-10-30', total: 99, items: [] })
];

test('summarize: 月度统计', () => {
  const s = stats.summarize(receipts, dates.periodRange('month', '2026-11-05'));
  assert.equal(s.total, 74.5);
  assert.equal(s.count, 3);
  assert.equal(s.days, 30);
  assert.equal(s.series.length, 30);
  assert.equal(s.series[2].amount, 64.5);
  assert.equal(s.byCategory[0].id, 'dining');
  assert.equal(s.byCategory.find(c => c.id === 'beverages').amount, 8.5);
  assert.equal(s.byMerchant[0].name, 'Din Tai Fung Restaurant');
  assert.equal(s.byMerchant.find(m => m.name === 'Woolworths').count, 1);
  assert.equal(s.topItems[0].name, 'Coca-Cola');
  assert.equal(s.topItems[0].times, 2);
});

test('summarize: 周统计与日统计', () => {
  const week = stats.summarize(receipts, dates.periodRange('week', '2026-11-03'));
  assert.equal(week.total, 74.5);
  assert.equal(week.series[1].amount, 64.5);
  const day = stats.summarize(receipts, dates.periodRange('day', '2026-10-30'));
  assert.equal(day.total, 99);
  assert.deepEqual(day.series, []);
});

test('changePercent', () => {
  assert.equal(stats.changePercent(110, 100), 10);
  assert.equal(stats.changePercent(10, 0), null);
});

test('priceSummary: 同一商品不同时间不同地点', () => {
  const p = stats.priceSummary([
    { date: '2026-11-03', unitPrice: 4.5, merchantName: 'Coles' },
    { date: '2026-10-01', unitPrice: 4, merchantName: 'Woolworths' },
    { date: '2026-11-08', unitPrice: 3.5, merchantName: 'Woolworths' }
  ]);
  assert.equal(p.count, 3);
  assert.equal(p.first.price, 4);
  assert.equal(p.latest.price, 3.5);
  assert.equal(p.min.merchant, 'Woolworths');
  assert.equal(p.max.merchant, 'Coles');
  assert.equal(p.avg, 4);
  assert.equal(p.stores[0].name, 'Woolworths');
  assert.equal(p.stores[0].last, 3.5);
  assert.deepEqual(p.history.map(h => h.date), ['2026-10-01', '2026-11-03', '2026-11-08']);
  assert.equal(stats.priceSummary([]), null);
});
