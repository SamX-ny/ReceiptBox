/**
 * 在内存数据库上端到端运行 api 云函数：家庭、小票、统计、价格追踪。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-cloud');

fake.install();
const api = require('../cloudfunctions/api/index');
const dbLib = require('../cloudfunctions/api/lib/db');

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

// ===== 首次运行自动创建集合 =====

function freshStrictDb() {
  fake.reset();
  fake.setStrict(true);
  dbLib.resetCollectionsCheck(); // 模拟新的云函数实例（冷启动）
}

test('首次运行自动创建全部集合，之后同一实例不再重复创建', async () => {
  freshStrictDb();
  assert.deepEqual(fake.collectionNames(), []);
  const login = await call('A', 'user.login');
  assert.equal(login.family.isPersonal, true);
  assert.deepEqual(fake.collectionNames(), ['families', 'priceRecords', 'productAliases', 'receipts', 'scanJobs', 'users']);
  assert.equal(fake.createCollectionCalls(), 6);

  // 全流程在严格模式下可用
  const r = await call('A', 'receipt.create', { receipt: receipt('Coles', '2026-11-03', [coke(4.5)]) });
  assert.ok(r._id);
  assert.equal((await call('A', 'product.list', {})).list.length, 1);
  assert.equal((await call('A', 'stats.summary', { type: 'month', date: '2026-11-03' })).total, 4.5);
  assert.equal(fake.createCollectionCalls(), 6, '同一实例只检查一次');
});

test('部分集合已存在时只补建缺少的，已有数据不受影响', async () => {
  freshStrictDb();
  await fake.sdk.database().createCollection('users');
  await fake.sdk.database().collection('users').add({ data: { _id: 'keep', familyId: 'x' } });
  await call('A', 'user.login');
  assert.deepEqual(fake.collectionNames(), ['families', 'priceRecords', 'productAliases', 'receipts', 'scanJobs', 'users']);
  assert.ok(fake.dump('users').some((u) => u._id === 'keep'));
});

test('自动创建失败时给出手动建表的提示', async () => {
  freshStrictDb();
  fake.setCreateCollectionError(Object.assign(new Error('permission denied'), { errCode: -501007, errMsg: 'collection.create:fail -501007 permission denied' }));
  fake.setOpenid('A');
  const res = await api.main({ action: 'user.login', params: {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'DB_NOT_READY');
  assert.match(res.message, /users、families、receipts、priceRecords、productAliases、scanJobs/);
});

test('集合不存在不会被当成“文档不存在”', () => {
  const missing = Object.assign(new Error('x'), { errCode: -502005, errMsg: 'document.get:fail -502005 database collection not exists. [ResourceNotFound] Db or Table not exist: users' });
  assert.equal(dbLib.isCollectionMissing(missing), true);
  assert.equal(dbLib.isNotFound(missing), false);
  const noDoc = Object.assign(new Error('x'), { errMsg: 'document.get:fail document with _id abc does not exist' });
  assert.equal(dbLib.isCollectionMissing(noDoc), false);
  assert.equal(dbLib.isNotFound(noDoc), true);
});

// ===== 后台识别任务 =====

const parseFn = require('../cloudfunctions/parseReceipt/index');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

async function parseJob(user, jobId) {
  fake.setOpenid(user);
  return parseFn.main({ jobId: jobId });
}

function useOcr(lines) {
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.RECEIPT_ENGINE;
  fake.sdk.openapi.ocr.printedText = async () => ({ items: lines.map((text) => ({ text })) });
}

test('后台识别：创建任务 → 识别写回 → 列表显示 → 确认保存后任务删除', async () => {
  fake.reset();
  fake.putFile('cloud://env/a.jpg', JPEG);
  useOcr(['Coles', '03/11/2026 10:01', 'COKE CLASSIC 2L   4.50', 'TOTAL   4.50']);

  const created = await call('A', 'scan.create', { fileID: 'cloud://env/a.jpg', today: '2026-11-09' });
  assert.equal(created.job.status, 'processing');
  let list = (await call('A', 'scan.list')).list;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'processing');
  assert.match(list[0].imageUrl, /^https:/);

  // 小程序调用后不等待；这里直接执行云函数
  const res = await parseJob('A', created.job._id);
  assert.deepEqual(res, { ok: true, jobId: created.job._id, engine: 'wechat-ocr' });

  list = (await call('A', 'scan.list')).list;
  assert.deepEqual([list[0].status, list[0].merchantName, list[0].total, list[0].itemCount, list[0].engine], ['ready', 'Coles', 4.5, 1, 'wechat-ocr']);

  const job = await call('A', 'scan.get', { id: created.job._id });
  assert.equal(job.draft.items[0].name, 'COKE CLASSIC 2L');
  assert.equal(job.draft.date, '2026-11-03');
  assert.equal(job.engine, 'wechat-ocr');
  assert.ok(job.warnings.length >= 1);

  // 其他人看不到、也不能处理这个任务
  assert.equal((await call('B', 'scan.list')).list.length, 0);
  await assert.rejects(call('B', 'scan.get', { id: created.job._id }), (e) => e.code === 'NOT_FOUND');
  assert.equal((await parseJob('B', created.job._id)).code, 'NOT_FOUND');

  // 确认保存：图片与来源以任务为准，任务随之删除，图片保留给小票
  const edited = Object.assign({}, job.draft, { imageFileID: 'cloud://env/other.jpg', source: 'manual' });
  const saved = await call('A', 'receipt.create', { receipt: edited, jobId: created.job._id });
  const receiptDoc = await call('A', 'receipt.get', { id: saved._id });
  assert.equal(receiptDoc.imageFileID, 'cloud://env/a.jpg');
  assert.equal(receiptDoc.source, 'wechat-ocr');
  assert.equal((await call('A', 'scan.list')).list.length, 0);
  assert.equal(fake.hasFile('cloud://env/a.jpg'), true);
  await assert.rejects(call('A', 'receipt.create', { receipt: edited, jobId: created.job._id, force: true }), (e) => e.code === 'NOT_FOUND');
});

test('后台识别：失败、重试、手动录入、删除', async () => {
  fake.reset();
  fake.putFile('cloud://env/b.jpg', JPEG);
  delete process.env.DASHSCOPE_API_KEY;
  fake.sdk.openapi.ocr.printedText = async () => ({ items: [] });

  const { job } = await call('A', 'scan.create', { fileID: 'cloud://env/b.jpg', today: '2026-11-09' });
  const res = await parseJob('A', job._id);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NO_TEXT');
  let item = (await call('A', 'scan.list')).list[0];
  assert.equal(item.status, 'failed');
  assert.match(item.errorMessage, /没有识别到文字/);

  // 失败的任务可以带着图片手动录入
  const manual = await call('A', 'scan.get', { id: job._id });
  assert.deepEqual(manual.draft, { imageFileID: 'cloud://env/b.jpg', date: '2026-11-09', items: [], source: 'manual' });

  // 重试：回到识别中，再次识别成功后旧的错误信息清空
  await call('A', 'scan.retry', { id: job._id });
  assert.equal((await call('A', 'scan.list')).list[0].status, 'processing');
  useOcr(['ALDI', '05/11/2026', 'MILK 2L   3.10', 'TOTAL   3.10']);
  await parseJob('A', job._id);
  item = (await call('A', 'scan.list')).list[0];
  assert.deepEqual([item.status, item.merchantName, item.errorMessage], ['ready', 'ALDI', undefined]);

  // 再次识别得到的草稿整体替换旧草稿，而不是合并
  useOcr(['IGA', '06/11/2026', 'TOTAL   9.00']);
  await call('A', 'scan.retry', { id: job._id });
  await parseJob('A', job._id);
  const again = await call('A', 'scan.get', { id: job._id });
  assert.equal(again.draft.merchant.name, 'IGA');
  assert.deepEqual(again.draft.items, []);

  // 删除任务同时删除图片
  await call('A', 'scan.delete', { id: job._id });
  assert.equal((await call('A', 'scan.list')).list.length, 0);
  assert.equal(fake.hasFile('cloud://env/b.jpg'), false);
});

test('后台识别：云函数被中断时任务显示为超时；小程序可上报调用失败原因', async () => {
  fake.reset();
  const { job } = await call('A', 'scan.create', { fileID: 'cloud://env/c.jpg', today: '2026-11-09' });

  // 调用失败（如云函数超时时间只有 3 秒）由小程序上报
  await call('A', 'scan.fail', { id: job._id, message: '云函数 parseReceipt 运行超时。请把「超时时间」改为 60 秒' });
  let item = (await call('A', 'scan.list')).list[0];
  assert.equal(item.status, 'failed');
  assert.match(item.errorMessage, /改为 60 秒/);
  // 已经有结果的任务不会被覆盖
  await call('A', 'scan.retry', { id: job._id });
  fake.putFile('cloud://env/c.jpg', JPEG);
  useOcr(['Coles', 'TOTAL 5.00']);
  await parseJob('A', job._id);
  await call('A', 'scan.fail', { id: job._id, message: 'late error' });
  assert.equal((await call('A', 'scan.list')).list[0].status, 'ready');

  // 没有任何回报、且超过 90 秒仍在识别中 → 视为超时
  const second = (await call('A', 'scan.create', { fileID: 'cloud://env/d.jpg' })).job;
  await fake.sdk.database().collection('scanJobs').doc(second._id).update({ data: { startedAt: new Date(Date.now() - 5 * 60 * 1000) } });
  item = (await call('A', 'scan.list')).list.find((j) => j._id === second._id);
  assert.equal(item.status, 'failed');
  assert.match(item.errorMessage, /识别超时/);

  await assert.rejects(call('A', 'scan.create', { fileID: 'not-a-cloud-file' }), (e) => e.code === 'INVALID_ARGUMENT');
});

// ===== 去重 =====

test('去重：保存时忽略商户名大小写与空格；Woolworths 与 Woolworths Metro 不算重复', async () => {
  fake.reset();
  const first = await call('A', 'receipt.create', { receipt: receipt('Woolworths', '2026-11-08', [coke(4)], { time: '18:32' }) });

  const sameDifferentCase = await call('A', 'receipt.create', { receipt: receipt(' WOOLWORTHS ', '2026-11-08', [coke(4)], { time: '18:32' }) });
  assert.equal(sameDifferentCase.duplicateOf, first._id);

  // 没识别出时间也算重复；时间不同则是两笔消费
  assert.equal((await call('A', 'receipt.create', { receipt: receipt('woolworths', '2026-11-08', [coke(4)]) })).duplicateOf, first._id);
  assert.ok((await call('A', 'receipt.create', { receipt: receipt('Woolworths', '2026-11-08', [coke(4)], { time: '20:10' }) }))._id);

  // 不同门店品牌：直接保存，不提醒
  const metro = await call('A', 'receipt.create', { receipt: receipt('Woolworths Metro', '2026-11-08', [coke(4)], { time: '18:32' }) });
  assert.ok(metro._id);
  assert.equal(metro.duplicateOf, undefined);

  // 用户确认后可以强制保存
  assert.ok((await call('A', 'receipt.create', { receipt: receipt('Woolworths', '2026-11-08', [coke(4)], { time: '18:32' }), force: true }))._id);
});

test('去重：编辑时改成与另一张相同才提醒', async () => {
  fake.reset();
  const a = await call('A', 'receipt.create', { receipt: receipt('Coles', '2026-11-03', [coke(4.5)]) });
  const b = await call('A', 'receipt.create', { receipt: receipt('Coles', '2026-11-04', [coke(4.5)]) });
  const docB = await call('A', 'receipt.get', { id: b._id });

  // 只改备注：不检查
  assert.equal((await call('A', 'receipt.update', { id: b._id, receipt: Object.assign({}, docB, { note: 'x' }) }))._id, b._id);
  // 把日期改成和 a 同一天：提醒，且数据没有被改动
  const res = await call('A', 'receipt.update', { id: b._id, receipt: Object.assign({}, docB, { date: '2026-11-03' }) });
  assert.equal(res.duplicateOf, a._id);
  assert.equal((await call('A', 'receipt.get', { id: b._id })).date, '2026-11-04');
  // 确认后强制保存
  await call('A', 'receipt.update', { id: b._id, receipt: Object.assign({}, docB, { date: '2026-11-03' }), force: true });
  assert.equal((await call('A', 'receipt.get', { id: b._id })).date, '2026-11-03');
  // 之后再编辑别的字段，不会因为已有“双胞胎”而反复提醒
  const docB2 = await call('A', 'receipt.get', { id: b._id });
  assert.equal((await call('A', 'receipt.update', { id: b._id, receipt: Object.assign({}, docB2, { note: 'y' }) }))._id, b._id);
});

test('去重：识别完成后就在待确认列表里标出可能重复', async () => {
  fake.reset();
  useOcr(['Coles', '03/11/2026 10:01', 'COKE CLASSIC 2L   4.50', 'TOTAL   4.50']);
  const scanOnce = async (file) => {
    fake.putFile(file, JPEG);
    const { job } = await call('A', 'scan.create', { fileID: file, today: '2026-11-09' });
    await parseJob('A', job._id);
    return job._id;
  };

  // 同一张小票上传了两次：较晚的一张标为与待确认的重复
  const j1 = await scanOnce('cloud://env/1.jpg');
  const j2 = await scanOnce('cloud://env/2.jpg');
  let list = (await call('A', 'scan.list')).list;
  const flag = (id) => list.find((j) => j._id === id).duplicate;
  assert.equal(flag(j1), '');
  assert.equal(flag(j2), 'pending');
  assert.equal((await call('A', 'scan.get', { id: j2 })).duplicateOf, '');

  // 保存第一张后，第二张标为与已保存的小票重复，并能指向那张小票
  const draft = (await call('A', 'scan.get', { id: j1 })).draft;
  const saved = await call('A', 'receipt.create', { receipt: draft, jobId: j1 });
  list = (await call('A', 'scan.list')).list;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].duplicate, list[0].duplicateOf], ['saved', saved._id]);
  assert.equal((await call('A', 'scan.get', { id: j2 })).duplicateOf, saved._id);
  // 保存第二张时仍会提醒
  const draft2 = (await call('A', 'scan.get', { id: j2 })).draft;
  assert.equal((await call('A', 'receipt.create', { receipt: draft2, jobId: j2 })).duplicateOf, saved._id);
  assert.equal((await call('A', 'scan.list')).list.length, 1, '提醒后任务仍保留');

  // 不同的小票不标记
  useOcr(['ALDI', '05/11/2026', 'MILK 2L   3.10', 'TOTAL   3.10']);
  const j3 = await scanOnce('cloud://env/3.jpg');
  list = (await call('A', 'scan.list')).list;
  assert.equal(flag(j3), '');
});
