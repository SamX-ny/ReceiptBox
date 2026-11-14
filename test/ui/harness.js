/**
 * 页面模拟环境：用 miniprogram-simulate（jsdom）渲染小程序页面，
 * wx.cloud.callFunction 直接调用真实云函数代码（内存数据库）。
 * 供页面冒烟测试（pages.sim.js）等脚本共用。
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
    uploadFile({ cloudPath, success }) {
      const id = 'cloud://env/' + cloudPath;
      fake.putFile(id, Buffer.from([0xff, 0xd8, 0xff, 0]));
      // 回调风格 + UploadTask（小程序端用它显示上传进度）
      const task = { onProgressUpdate(cb) { cb({ progress: 50 }); cb({ progress: 100 }); } };
      setTimeout(() => success({ fileID: id }), 0);
      return task;
    },
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

// 供其他脚本（如生成页面预览图）在渲染前调整模板
const hooks = { transformTemplate: (wxml) => wxml };

async function renderPage(pagePath, query) {
  pageDef = null;
  const js = path.join(MP, pagePath + '.js');
  delete require.cache[require.resolve(js)];
  require(js);
  const def = pageDef;
  const methods = {};
  Object.keys(def).forEach((k) => { if (typeof def[k] === 'function') methods[k] = def[k]; });
  const id = simulate.load({
    template: hooks.transformTemplate(fs.readFileSync(path.join(MP, pagePath + '.wxml'), 'utf8')),
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

const dates = require(path.join(ROOT, 'shared/dates'));
async function api(action, params) {
  fake.setOpenid(user);
  const r = await apiFn.main({ action, params });
  if (!r.ok) throw new Error(action + ' ' + r.message);
  return r.data;
}


module.exports = {
  ROOT, MP, fake, simulate, wx, log, dates,
  renderPage, api, hooks,
  setUser: (u) => { user = u; }
};
