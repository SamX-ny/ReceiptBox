const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLines, linesFromOcrItems } = require('../cloudfunctions/parseReceipt/lib/ocrParser');
const receiptLib = require('../shared/receipt');

const WOOLWORTHS = [
  'Woolworths',
  'Chatswood Chase',
  'TAX INVOICE ABN 88 000 014 675',
  '08/11/2026 18:32',
  'COCA-COLA CLASSIC 2L          4.00',
  'BANANAS CAVENDISH',
  '0.856 kg NET @ $3.90/kg       3.34',
  'TIM TAM ORIGINAL 200G         5.50',
  'Less Promotion               -1.25',
  'WW FULL CREAM MILK 3L',
  '2 @ $4.65 each                9.30',
  'SUBTOTAL                     20.89',
  'TOTAL                       $20.89',
  'GST INCLUDED IN TOTAL         0.39',
  'EFTPOS                       20.89',
  'Everyday Rewards points 21'
];

test('parseLines: 澳洲超市小票', () => {
  const d = parseLines(WOOLWORTHS);
  assert.equal(d.merchant.name, 'Woolworths');
  assert.equal(d.merchant.type, 'supermarket');
  assert.equal(d.date, '2026-11-08');
  assert.equal(d.time, '18:32');
  assert.equal(d.total, 20.89);
  assert.equal(d.subtotal, 20.89);
  assert.equal(d.tax, 0.39);
  assert.equal(d.paymentMethod, 'EFTPOS');
  assert.equal(d.items.length, 4);

  const [coke, banana, timtam, milk] = d.items;
  assert.equal(coke.name, 'COCA-COLA CLASSIC 2L');
  assert.equal(coke.totalPrice, 4);
  assert.equal(coke.category, 'beverages');
  assert.deepEqual([banana.name, banana.quantity, banana.unit, banana.unitPrice, banana.totalPrice], ['BANANAS CAVENDISH', 0.856, 'kg', 3.9, 3.34]);
  assert.equal(banana.category, 'produce');
  assert.equal(timtam.discount, 1.25);
  assert.equal(timtam.totalPrice, 4.25);
  assert.equal(timtam.category, 'snacks');
  assert.deepEqual([milk.quantity, milk.unitPrice, milk.totalPrice], [2, 4.65, 9.3]);

  const { receipt, warnings } = receiptLib.sanitizeReceipt(d);
  assert.equal(receipt.items[0].productKey, 'coca-cola-classic|2l');
  assert.deepEqual(warnings, []);
});

test('parseLines: 中文餐厅小票', () => {
  const d = parseLines([
    '小肥羊火锅（悉尼店）',
    '2026年11月01日 19:20',
    '肥牛卷 x1   28.00',
    '鲜虾滑     22.00',
    '可乐       4.50',
    '合计       54.50',
    '微信支付   54.50'
  ]);
  assert.equal(d.merchant.type, 'restaurant');
  assert.equal(d.date, '2026-11-01');
  assert.equal(d.total, 54.5);
  assert.equal(d.items.length, 3);
  assert.equal(d.items.every(it => it.category === 'dining' || it.category === 'beverages' || it.category === 'meat'), true);
});

test('linesFromOcrItems: 同一行的文字块按从左到右合并', () => {
  const box = (text, x, y) => ({ text, pos: { left_top: { x, y }, right_top: { x: x + 50, y }, right_bottom: { x: x + 50, y: y + 20 }, left_bottom: { x, y: y + 20 } } });
  assert.deepEqual(linesFromOcrItems([box('4.00', 300, 41), box('MILK 2L', 10, 40), box('Coles', 10, 0), box('', 0, 0)]), ['Coles', 'MILK 2L   4.00']);
  // 缺少坐标时按原顺序返回
  assert.deepEqual(linesFromOcrItems([{ text: 'A' }, box('B', 0, 0)]), ['A', 'B']);
  assert.deepEqual(linesFromOcrItems(undefined), []);
});
