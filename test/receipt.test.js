const test = require('node:test');
const assert = require('node:assert/strict');
const receiptLib = require('../shared/receipt');

const SAMPLE = {
  merchant: { name: 'Woolworths', branch: 'Chatswood', type: 'supermarket' },
  date: '2026-11-08',
  time: '9:05',
  items: [
    { name: 'COCA-COLA CLASSIC 2L', productName: 'Coca-Cola Classic', spec: '2L', quantity: 1, unitPrice: 4, totalPrice: 4, category: 'beverages' },
    { name: 'BANANAS CAVENDISH', quantity: 0.856, unit: 'kg', unitPrice: 3.9, totalPrice: 3.34 },
    { name: 'WW FULL CREAM MILK 3L', quantity: 2, unitPrice: 4.65, totalPrice: 8.3, discount: 1 },
    { name: '' }
  ],
  total: '$15.64',
  tax: 0.36
};

test('sanitizeReceipt: 清洗字段并补全分类、规格与商品键', () => {
  const { receipt, warnings } = receiptLib.sanitizeReceipt(SAMPLE);
  assert.equal(receipt.items.length, 3);
  assert.equal(receipt.time, '09:05');
  assert.equal(receipt.total, 15.64);
  assert.equal(receipt.currency, 'AUD');
  assert.equal(receipt.items[0].productKey, 'coca-cola-classic|2l');
  assert.equal(receipt.items[1].category, 'produce');
  assert.equal(receipt.items[1].unit, 'kg');
  assert.equal(receipt.items[2].category, 'dairy');
  assert.equal(receipt.items[2].spec, '3L');
  assert.equal(receipt.items[2].productName, 'WW FULL CREAM MILK');
  assert.equal(receipt.category, 'dairy');
  assert.deepEqual(warnings, []);
});

test('sanitizeReceipt: 缺失总额与日期时给出提示', () => {
  const { receipt, warnings } = receiptLib.sanitizeReceipt({ merchant: { name: 'Coles' }, items: [{ name: 'Tim Tam', totalPrice: 5.5 }] }, { defaultDate: '2026-11-09' });
  assert.equal(receipt.total, 5.5);
  assert.equal(receipt.date, '2026-11-09');
  assert.equal(receipt.merchant.type, 'supermarket');
  assert.equal(receipt.items[0].category, 'snacks');
  assert.equal(warnings.length, 2);
});

test('sanitizeReceipt: 餐厅小票默认归入餐饮', () => {
  const { receipt } = receiptLib.sanitizeReceipt({ merchant: { name: 'Golden Dragon Restaurant' }, total: 88, items: [{ name: 'Peking Duck', totalPrice: 60 }, { name: 'Fried Rice', totalPrice: 28 }] });
  assert.equal(receipt.merchant.type, 'restaurant');
  assert.equal(receipt.category, 'dining');
});

test('sanitizeReceipt: 商品合计与总额不一致时提示', () => {
  const { warnings } = receiptLib.sanitizeReceipt({ date: '2026-01-01', total: 50, items: [{ name: 'A', totalPrice: 10 }] });
  assert.match(warnings[0], /不一致/);
});

test('allocateByCategory: 分类分摊之和等于实付总额', () => {
  const alloc = receiptLib.allocateByCategory({
    total: 9,
    items: [
      { category: 'snacks', totalPrice: 5 },
      { category: 'dairy', totalPrice: 3 },
      { category: 'snacks', totalPrice: 2 }
    ]
  });
  assert.equal(alloc.snacks + alloc.dairy, 9);
  assert.equal(alloc.snacks, 6.3);
  assert.deepEqual(receiptLib.allocateByCategory({ total: 20, category: 'dining', items: [] }), { dining: 20 });
});

test('buildPriceRecords: 应用商品别名', () => {
  const { receipt } = receiptLib.sanitizeReceipt(SAMPLE);
  const records = receiptLib.buildPriceRecords(receipt, {
    familyId: 'f1', receiptId: 'r1',
    aliases: { 'coca-cola-classic|2l': 'coke|2l' }
  });
  assert.equal(records.length, 3);
  assert.equal(records[0].productKey, 'coke|2l');
  assert.equal(records[0].merchantName, 'Woolworths');
  assert.equal(records[0].measurePrice, 2);
  assert.equal(records[0].measureUnit, 'L');
  assert.equal(records[1].measurePrice, 3.9);
  assert.equal(records[2].measurePrice, 1.55);
});
