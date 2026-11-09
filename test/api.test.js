/**
 * 在内存数据库上端到端运行 api 云函数：家庭、小票、统计、价格追踪。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-cloud');

fake.install();
const api = require('../cloudfunctions/api/index');

async function call(user, action, params) {
  fake.setOpenid(user);
  const res = await api.main({ action: action, params: params || {} });
  if (!res.ok) {
    const err = new Error(res.code + ': ' + res.message);
    err.code = res.code;
    throw err;
  }
  return res.data;
}

function receipt(merchant, date, items, extra) {
  return Object.assign({
    merchant: { name: merchant, type: 'supermarket' },
    date: date,
    items: items,
    total: items.reduce((a, it) => a + it.totalPrice, 0)
  }, extra || {});
}

const coke = (price) => ({ name: 'COCA-COLA CLASSIC 2L', productName: 'Coca-Cola Classic', spec: '2L', quantity: 1, unitPrice: price, totalPrice: price, category: 'beverages' });

test('家庭、小票、统计与价格追踪全流程', async () => {
  fake.reset();

  // —— 首次登录自动创建个人家庭 ——
  const login = await call('A', 'user.login');
  assert.equal(login.family.isPersonal, true);
  assert.match(login.family.inviteCode, /^[A-Z2-9]{6}$/);
  await call('A', 'user.updateProfile', { nickName: '妈妈' });

  // —— 保存小票（同一瓶可乐：10/1 在 Woolworths $4，11/3 在 Coles $4.5） ——
  const r1 = await call('A', 'receipt.create', {
    receipt: receipt('Woolworths', '2026-10-01', [coke(4), { name: 'Bananas', quantity: 1.2, unit: 'kg', unitPrice: 3.5, totalPrice: 4.2 }])
  });
  assert.ok(r1._id);
  const r2 = await call('A', 'receipt.create', { receipt: receipt('Coles', '2026-11-03', [coke(4.5)]) });
  await call('A', 'receipt.create', {
    receipt: { merchant: { name: 'Din Tai Fung', type: 'restaurant' }, date: '2026-11-03', time: '19:30', total: 86.5, items: [] }
  });
  await call('A', 'receipt.create', {
    receipt: receipt('Woolworths', '2026-11-05', [{ name: 'Coca-Cola Classic 1.25L', unitPrice: 3.2, totalPrice: 3.2, category: 'beverages' }])
  });

  // —— 重复检测 ——
  const dup = await call('A', 'receipt.create', { receipt: receipt('Coles', '2026-11-03', [coke(4.5)]) });
  assert.equal(dup.duplicateOf, r2._id);
  assert.equal(fake.dump('receipts').length, 4);

  // —— 列表与筛选 ——
  const nov = await call('A', 'receipt.list', { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(nov.list.length, 3);
  assert.equal(nov.list[0].date, '2026-11-05');
  assert.equal(nov.list[0].items, undefined, '列表默认不返回商品明细');
  const dining = await call('A', 'receipt.list', { category: 'dining' });
  assert.deepEqual(dining.list.map((r) => r.merchant.name), ['Din Tai Fung']);
  const search = await call('A', 'receipt.list', { keyword: 'banana' });
  assert.equal(search.list.length, 1);
  const withItems = await call('A', 'receipt.list', { start: '2026-11-03', end: '2026-11-03', withItems: true });
  assert.equal(withItems.list.find((r) => r.merchant.name === 'Coles').items[0].category, 'beverages');

  // —— 统计 ——
  const month = await call('A', 'stats.summary', { type: 'month', date: '2026-11-10' });
  assert.equal(month.total, 94.2);
  assert.equal(month.count, 3);
  assert.equal(month.byCategory[0].id, 'dining');
  assert.equal(month.previous.total, 8.2);
  assert.equal(month.change, Math.round((94.2 - 8.2) / 8.2 * 1000) / 10);
  const year = await call('A', 'stats.summary', { type: 'year', date: '2026-11-10' });
  assert.equal(year.series.length, 12);
  assert.equal(year.series[9].amount, 8.2);
  const overview = await call('A', 'stats.overview', { today: '2026-11-05' });
  assert.equal(overview.today.total, 3.2);
  assert.equal(overview.week.total, 94.2);
  assert.equal(overview.lastMonth.total, 8.2);

  // —— 商品价格追踪 ——
  const products = await call('A', 'product.list', { keyword: 'coca' });
  const coke2l = products.list.find((p) => p.productKey === 'coca-cola-classic|2l');
  assert.equal(coke2l.count, 2);
  assert.equal(coke2l.lastPrice, 4.5);
  assert.equal(coke2l.minPrice, 4);
  assert.equal(coke2l.storeCount, 2);
  const hist = await call('A', 'product.history', { productKey: 'coca-cola-classic|2l' });
  assert.deepEqual(hist.summary.history.map((h) => [h.date, h.merchant, h.price]), [
    ['2026-10-01', 'Woolworths', 4],
    ['2026-11-03', 'Coles', 4.5]
  ]);
  assert.equal(hist.summary.stores[0].name, 'Woolworths');
  assert.equal(hist.summary.latest.measurePrice, 2.25);
  assert.deepEqual(hist.variants.map((v) => v.productKey), ['coca-cola-classic|1.25l']);

  // —— 合并写法不同的同一商品，之后的小票自动归并 ——
  await call('A', 'receipt.create', { receipt: receipt('ALDI', '2026-11-06', [{ name: 'Coke Classic 2L', unitPrice: 3.99, totalPrice: 3.99 }]) });
  await call('A', 'product.merge', { fromKey: 'coke-classic|2l', toKey: 'coca-cola-classic|2l' });
  await call('A', 'receipt.create', { receipt: receipt('IGA', '2026-11-07', [{ name: 'Coke Classic 2L', unitPrice: 4.8, totalPrice: 4.8 }]) });
  const merged = await call('A', 'product.history', { productKey: 'coca-cola-classic|2l' });
  assert.equal(merged.summary.count, 4);
  assert.equal(merged.summary.min.merchant, 'ALDI');
  assert.equal(merged.product.productName, 'Coca-Cola Classic');

  // —— 修改小票价格后价格记录同步 ——
  const detail = await call('A', 'receipt.get', { id: r2._id });
  assert.equal(detail.createdByName, '我');
  detail.items[0].unitPrice = 4.2;
  detail.items[0].totalPrice = 4.2;
  await call('A', 'receipt.update', { id: r2._id, receipt: detail });
  const afterEdit = await call('A', 'product.history', { productKey: 'coca-cola-classic|2l' });
  assert.equal(afterEdit.summary.history.find((h) => h.merchant === 'Coles').price, 4.2);
  assert.equal(fake.dump('receipts').find((r) => r._id === r2._id).createdBy, 'A');

  // —— 其他用户无法访问 ——
  await assert.rejects(call('C', 'receipt.get', { id: r1._id }), (e) => e.code === 'NOT_FOUND');
  assert.equal((await call('C', 'receipt.list', {})).list.length, 0);

  // —— 家人 B 用邀请码加入，自己的小票一并带入 ——
  await call('B', 'receipt.create', { receipt: receipt('Costco', '2026-11-02', [coke(3.5)]) });
  const joined = await call('B', 'family.join', { inviteCode: login.family.inviteCode });
  assert.equal(joined.movedReceipts, 1);
  assert.equal(joined.family.members.length, 2);
  const shared = await call('A', 'product.history', { productKey: 'coca-cola-classic|2l' });
  assert.equal(shared.summary.min.merchant, 'Costco');
  const seenByB = await call('B', 'receipt.get', { id: r1._id });
  assert.equal(seenByB.createdByName, '妈妈');
  await assert.rejects(call('B', 'family.join', { inviteCode: login.family.inviteCode }), (e) => e.code === 'ALREADY_MEMBER');
  await assert.rejects(call('B', 'family.join', { inviteCode: 'ZZZZZZ' }), (e) => e.code === 'NOT_FOUND');

  // —— B 退出后回到个人家庭，原家庭数据保留 ——
  const left = await call('B', 'family.leave');
  assert.equal(left.family.isPersonal, true);
  assert.equal((await call('B', 'receipt.list', {})).list.length, 0);
  assert.equal((await call('A', 'receipt.list', { limit: 100 })).list.length, 7);

  // —— 删除小票同时删除价格记录与图片 ——
  fake.putFile('cloud://env/receipts/x.jpg', Buffer.from('img'));
  const withImage = await call('A', 'receipt.create', {
    receipt: Object.assign(receipt('Woolworths', '2026-11-08', [coke(4)]), { imageFileID: 'cloud://env/receipts/x.jpg' })
  });
  await call('A', 'receipt.delete', { id: withImage._id });
  assert.equal(fake.hasFile('cloud://env/receipts/x.jpg'), false);
  assert.equal(fake.dump('priceRecords').filter((p) => p.receiptId === withImage._id).length, 0);
});

test('参数校验与错误', async () => {
  fake.reset();
  await assert.rejects(call('A', 'receipt.create', { receipt: { merchant: { name: 'X' } } }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(call('A', 'stats.summary', { type: 'decade', date: '2026-01-01' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(call('A', 'receipt.list', { start: '2026/01/01' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(call('A', 'family.leave'), (e) => e.code === 'INVALID_ARGUMENT');
  const res = await api.main({ action: 'nope' });
  assert.equal(res.code, 'UNKNOWN_ACTION');
});
