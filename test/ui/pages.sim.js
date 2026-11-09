/**
 * 页面冒烟测试：用 miniprogram-simulate（jsdom）渲染每个页面，
 * wx.cloud.callFunction 直接调用真实云函数代码（内存数据库），检查页面内容与主要流程。
 *
 *   npm install && npm run test:ui
 */
require('global-jsdom/register');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const MP = path.join(ROOT, 'miniprogram');
const fake = require(path.join(ROOT, 'test/helpers/fake-cloud'));
fake.install();
const apiFn = require(path.join(ROOT, 'cloudfunctions/api/index'));
const parseFn = require(path.join(ROOT, 'cloudfunctions/parseReceipt/index'));
const simulate = require('miniprogram-simulate');
const fs = require('fs');

const log = { nav: [], toast: [], modal: [], errors: [] };
const origErr = console.error;
console.error = (...a) => { log.errors.push(a.map(String).join(' ')); origErr(...a); };

// ---- wx mocks ----
const wx = global.wx;
let user = 'A';
Object.assign(wx, {
  cloud: {
    init() {},
    async callFunction({ name, data }) {
      fake.setOpenid(user);
      const fn = name === 'api' ? apiFn : parseFn;
      return { result: await fn.main(JSON.parse(JSON.stringify(data))) };
    },
    async uploadFile({ cloudPath }) { const id = 'cloud://env/' + cloudPath; fake.putFile(id, Buffer.from([0xff, 0xd8, 0xff, 0])); return { fileID: id }; },
    deleteFile: async () => ({})
  },
  showToast: (o) => log.toast.push(o.title),
  showLoading() {}, hideLoading() {},
  showModal: (o) => { log.modal.push(o.title + ': ' + (o.content || '')); },
  navigateTo: (o) => log.nav.push(o.url),
  redirectTo: (o) => log.nav.push('redirect ' + o.url),
  switchTab: (o) => log.nav.push('tab ' + o.url),
  navigateBack: () => log.nav.push('back'),
  setNavigationBarTitle() {}, stopPullDownRefresh() {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getAppBaseInfo: () => ({ theme: 'light' }),
  onThemeChange() {}, offThemeChange() {},
  enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
  setClipboardData() {}, previewImage() {}, showActionSheet() {}
});

global.getCurrentPages = () => [];
let appDef;
global.App = (def) => { appDef = def; };
require(path.join(MP, 'app.js'));
global.getApp = () => appDef;
appDef.onLaunch();

let pageDef;
global.Page = (def) => { pageDef = def; };

const compIds = {};
['chart', 'receipt-item', 'receipt-feed'].forEach((c) => {
  compIds['rb-' + c] = simulate.load(path.join(MP, 'components', c, 'index'), 'rb-' + c, { rootPath: MP });
});

async function renderPage(pagePath, query) {
  pageDef = null;
  const js = path.join(MP, pagePath + '.js');
  delete require.cache[require.resolve(js)];
  require(js);
  const def = pageDef;
  const methods = {};
  Object.keys(def).forEach((k) => { if (typeof def[k] === 'function') methods[k] = def[k]; });
  const id = simulate.load({
    template: fs.readFileSync(path.join(MP, pagePath + '.wxml'), 'utf8'),
    usingComponents: compIds,
    data: JSON.parse(JSON.stringify(def.data || {})),
    methods
  });
  const comp = simulate.render(id);
  comp.attach(document.createElement('parent-wrapper'));
  const inst = comp.instance;
  if (inst.onLoad) await inst.onLoad(query || {});
  if (inst.onShow) await inst.onShow();
  await simulate.sleep(80);
  return comp;
}

function text(comp) {
  return comp.dom.textContent.replace(/\s+/g, ' ').trim();
}

function check(name, comp, expects) {
  const t = text(comp);
  const bad = ['undefined', 'NaN', '[object Object]', 'null'].filter((w) => t.includes(w));
  const missing = (expects || []).filter((e) => !t.includes(e));
  console.log('\n=== ' + name + (bad.length || missing.length ? '  ❌' : '  ✅'));
  console.log(t.slice(0, 900));
  if (bad.length) console.log('  BAD TOKENS:', bad);
  if (missing.length) console.log('  MISSING:', missing);
  return !bad.length && !missing.length;
}

const dates = require(path.join(ROOT, 'shared/dates'));
async function api(action, params) {
  fake.setOpenid(user);
  const r = await apiFn.main({ action, params });
  if (!r.ok) throw new Error(action + ' ' + r.message);
  return r.data;
}

(async () => {
  fake.reset();
  const today = dates.today();
  const d = (n) => dates.addDays(today, -n);
  const coke = (p) => ({ name: 'COCA-COLA CLASSIC 2L', productName: 'Coca-Cola Classic', brand: 'Coca-Cola', spec: '2L', quantity: 1, unitPrice: p, totalPrice: p, category: 'beverages' });
  await api('user.login', {});
  await api('user.updateProfile', { nickName: '妈妈' });
  const r1 = await api('receipt.create', { receipt: { merchant: { name: 'Woolworths', branch: 'Chatswood', type: 'supermarket' }, date: d(40), time: '18:32', total: 15.64, tax: 0.36, paymentMethod: 'EFTPOS', items: [coke(4), { name: 'BANANAS CAVENDISH', productName: 'Bananas Cavendish', quantity: 0.856, unit: 'kg', unitPrice: 3.9, totalPrice: 3.34 }, { name: 'WW FULL CREAM MILK 3L', productName: 'Woolworths Full Cream Milk', spec: '3L', quantity: 2, unitPrice: 4.65, totalPrice: 8.3, discount: 1 }] } });
  await api('receipt.create', { receipt: { merchant: { name: 'Coles', type: 'supermarket' }, date: d(1), total: 10, items: [coke(4.5), { name: 'Tim Tam Original 200g', totalPrice: 5.5 }] } });
  await api('receipt.create', { receipt: { merchant: { name: 'Din Tai Fung', type: 'restaurant' }, date: today, time: '19:30', total: 86.5, items: [] } });
  await api('receipt.create', { receipt: { merchant: { name: 'ALDI', type: 'supermarket' }, date: d(3), total: 3.99, items: [coke(3.99)] } });

  const results = [];
  results.push(check('首页 index', await renderPage('pages/index/index'), ['支出', 'Din Tai Fung', '餐饮外食', '最近小票']));
  results.push(check('账单 receipts', await renderPage('pages/receipts/index'), ['Din Tai Fung', 'Coles', '今天', '昨天']));
  const stats = await renderPage('pages/stats/index');
  results.push(check('统计 stats (月)', stats, ['总支出', '分类支出', '去了哪里', 'Din Tai Fung']));
  stats.instance.setData({ type: 'day', anchor: d(1) });
  await stats.instance.load();
  await simulate.sleep(30);
  results.push(check('统计 stats (日)', stats, ['当天消费明细', 'Coles', 'Coca-Cola Classic', '饮料酒水', '零食甜点']));
  stats.instance.setData({ type: 'year' });
  await stats.instance.load();
  await simulate.sleep(30);
  results.push(check('统计 stats (年)', stats, ['每月支出']));
  results.push(check('比价 products', await renderPage('pages/products/index'), ['Coca-Cola Classic', '买过 3 次', '3 家店']));
  results.push(check('商品详情 product-detail', await renderPage('pages/product-detail/index', { key: encodeURIComponent('coca-cola-classic|2l') }), ['价格走势', '各商店价格', 'ALDI', '平均最便宜', '购买记录']));
  results.push(check('小票详情 receipt-detail', await renderPage('pages/receipt-detail/index', { id: r1._id }), ['Woolworths', 'Chatswood', 'Bananas Cavendish', '0.856kg', '省 $1.00', 'EFTPOS']));
  results.push(check('编辑 receipt-edit (edit)', await renderPage('pages/receipt-edit/index', { mode: 'edit', id: r1._id }), ['商品明细 · 3', '合计 $15.64']));
  results.push(check('筛选列表 receipt-list', await renderPage('pages/receipt-list/index', { merchant: 'Woolworths' }), ['Woolworths']));
  results.push(check('我的 mine', await renderPage('pages/mine/index'), ['妈妈', '家庭邀请码', '果蔬']));

  // —— 识别 → 确认 → 保存 流程 ——
  fake.sdk.openapi.ocr.printedText = async () => ({ items: ['IGA', today.split('-').reverse().join('/') + ' 10:05', 'COKE CLASSIC 2L   4.80', 'TOTAL  4.80'].map((t) => ({ text: t })) });
  log.nav = [];
  await renderPage('pages/scan/index', { path: encodeURIComponent('/tmp/x.jpg') });
  await simulate.sleep(50);
  console.log('\nscan nav:', log.nav);
  const edit = await renderPage('pages/receipt-edit/index', { mode: 'create', engine: 'wechat-ocr' });
  results.push(check('确认 receipt-edit (create)', edit, ['OCR 规则识别', '合计 $4.80']));
  console.log('form:', JSON.stringify(edit.instance.data.form), 'item0:', edit.instance.data.items[0].name);
  results.push(edit.instance.data.form.merchantName === 'IGA' && edit.instance.data.items[0].name === 'COKE CLASSIC 2L');
  log.nav = [];
  await edit.instance.onSaveTap();
  await simulate.sleep(30);
  console.log('save nav:', log.nav, 'toasts:', log.toast.slice(-3));
  results.push(log.nav.some((u) => /receipt-detail/.test(u)));

  // manual mode: add item then save
  const manual = await renderPage('pages/receipt-edit/index', { mode: 'manual' });
  manual.instance.onInput({ currentTarget: { dataset: { field: 'merchantName' } }, detail: { value: 'Harris Farm' } });
  manual.instance.onItemInput({ currentTarget: { dataset: { index: 0, field: 'name' } }, detail: { value: 'Avocado' } });
  manual.instance.onItemInput({ currentTarget: { dataset: { index: 0, field: 'quantity' } }, detail: { value: '3' } });
  manual.instance.onItemInput({ currentTarget: { dataset: { index: 0, field: 'unitPrice' } }, detail: { value: '1.5' } });
  await simulate.sleep(10);
  results.push(check('手动记一笔 (填写后)', manual, ['果蔬', '比商品合计少 $4.50']));
  console.log('avocado item:', JSON.stringify(manual.instance.data.items[0]));
  manual.instance.useItemsSum();
  log.nav = [];
  await manual.instance.onSaveTap();
  console.log('manual save nav:', log.nav, 'toasts:', log.toast.slice(-2));
  results.push(log.nav.some((u) => /receipt-detail/.test(u)));

  console.log('\nconsole.error calls:', log.errors.length);
  log.errors.forEach((e) => console.log('  ', e.slice(0, 300)));
  const ok = results.every(Boolean) && !log.errors.length;
  console.log(ok ? '\nALL PAGES OK' : '\nFAILURES: ' + results.map((r, i) => (r ? '' : i)).filter(String).join(','));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('HARNESS ERROR', e); process.exit(2); });
