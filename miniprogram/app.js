const config = require('./config');
const api = require('./utils/api');

App({
  globalData: {
    family: null,
    // 数据有变动时置为 true，各页面 onShow 时据此刷新
    dirty: { home: true, receipts: true, stats: true, products: true }
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '提示', content: '请升级微信到最新版本后使用', showCancel: false });
      return;
    }
    wx.cloud.init({ env: config.envId, traceUser: true });
    this.ready = this.login();
  },

  login() {
    return api.call('user.login', {}, { silent: true })
      .then((data) => {
        this.globalData.family = data.family;
        return data;
      })
      .catch((err) => {
        console.error('login failed', err);
        return null;
      });
  },

  /** 小票增删改后调用，通知各页面刷新 */
  markDirty() {
    const d = this.globalData.dirty;
    Object.keys(d).forEach((k) => { d[k] = true; });
  },

  /** 页面 onShow 时调用：返回是否需要刷新，并清除标记 */
  consumeDirty(key) {
    const v = this.globalData.dirty[key];
    this.globalData.dirty[key] = false;
    return v;
  }
});
