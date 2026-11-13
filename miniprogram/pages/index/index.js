const app = getApp();
const api = require('../../utils/api');
const format = require('../../utils/format');
const capture = require('../../utils/capture');
const scan = require('../../utils/scan');
const dates = require('../../shared/dates');

Page({
  data: {
    loading: true,
    overview: null,
    recent: [],
    familyName: '',
    // 待确认小票：上传中 / 识别中 / 待核对 / 失败
    scans: []
  },

  onLoad() {
    // 上传完成、识别完成时刷新“待确认小票”
    this._unsubscribe = scan.subscribe((localOnly) => {
      if (!this._visible) return;
      // 只是本机上传进度变化时，直接用已有数据重画，不请求服务端
      if (localOnly) this.renderScans();
      else this.loadScans();
    });
  },

  onUnload() {
    if (this._unsubscribe) this._unsubscribe();
    clearTimeout(this._pollTimer);
  },

  onShow() {
    this._visible = true;
    if (app.consumeDirty('home')) this.load();
    this.loadScans();
  },

  onHide() {
    this._visible = false;
    clearTimeout(this._pollTimer);
  },

  onPullDownRefresh() {
    Promise.all([this.load(), this.loadScans()]).finally(() => wx.stopPullDownRefresh());
  },

  // ===== 待确认小票（后台识别） =====
  async loadScans() {
    clearTimeout(this._pollTimer);
    const seq = (this._scanSeq = (this._scanSeq || 0) + 1);
    if (app.ready) await app.ready;
    let jobs = this._jobs || [];
    try {
      jobs = (await api.call('scan.list', {}, { silent: true })).list;
      this._jobs = jobs;
    } catch (e) {
      // 网络波动时保留上一次的列表，稍后重试
    }
    if (seq !== this._scanSeq) return;
    const scans = this.renderScans();

    // 还有在上传或识别中的，页面可见时每 3 秒刷新一次
    const busy = scans.some((x) => x.status === 'uploading' || x.status === 'processing');
    if (busy && this._visible) this._pollTimer = setTimeout(() => this.loadScans(), 3000);
  },

  /** 把本机上传中的条目和服务端的识别任务合并成列表 */
  renderScans() {
    const jobs = this._jobs || [];
    const locals = scan.localItems().map((x) => ({
      key: x.localId,
      local: true,
      id: x.localId,
      status: x.status,
      thumb: x.path,
      title: x.status !== 'uploading' ? '上传失败'
        : x.stage === 'compress' ? '压缩照片…'
        : x.stage === 'upload' ? '上传中 ' + x.progress + '%'
        : '上传完成，准备识别…',
      sub: x.status === 'uploading' ? '可以先去做别的' : x.error
    }));
    const remotes = jobs.map((j) => ({
      key: j._id,
      local: false,
      id: j._id,
      status: j.status,
      thumb: j.imageUrl,
      title: j.status === 'processing' ? '识别中…'
        : j.status === 'ready' ? (j.merchantName || '识别完成')
        : '识别失败',
      sub: j.status === 'processing' ? '一般需要 10～30 秒，可以先去做别的'
        : j.status === 'ready' ? format.money(j.total) + ' · ' + j.itemCount + ' 件商品 · 点击核对并保存'
        : j.errorMessage,
      // 可能重复：已保存过同一张，或待确认列表里上传了两次
      duplicate: j.duplicate === 'saved' ? '可能重复：已保存过同一张小票'
        : j.duplicate === 'pending' ? '可能重复：和上面另一张待确认的是同一张'
        : ''
    }));
    const scans = locals.concat(remotes);
    this.setData({ scans: scans });
    return scans;
  },

  onScanTap(e) {
    const item = this.data.scans[e.currentTarget.dataset.index];
    if (!item || item.local) return;
    if (item.status === 'ready') {
      wx.navigateTo({ url: '/pages/receipt-edit/index?mode=create&jobId=' + item.id });
    } else if (item.status === 'processing') {
      wx.showToast({ title: '还在识别中，稍等一下', icon: 'none' });
    }
  },

  async onScanRetry(e) {
    const item = this.data.scans[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.local) scan.retryLocal(item.id);
    else {
      try {
        await scan.retry(item.id);
      } catch (err) {}
    }
  },

  /** 识别失败时带着照片手动录入 */
  onScanManual(e) {
    const item = this.data.scans[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.local) wx.navigateTo({ url: '/pages/receipt-edit/index?mode=manual' });
    else wx.navigateTo({ url: '/pages/receipt-edit/index?mode=create&jobId=' + item.id });
  },

  onScanDelete(e) {
    const item = this.data.scans[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.local) {
      scan.dismissLocal(item.id);
      return;
    }
    wx.showModal({
      title: '删除这张待确认的小票？',
      content: '照片和识别结果都会删除。',
      confirmText: '删除',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await scan.remove(item.id);
        } catch (err) {}
      }
    });
  },

  async load() {
    if (app.ready) await app.ready;
    const today = dates.today();
    try {
      const [ov, recent] = await Promise.all([
        api.call('stats.overview', { today: today }),
        api.call('receipt.list', { limit: 5 })
      ]);
      const maxCat = ov.month.byCategory.length ? ov.month.byCategory[0].amount : 0;
      this.setData({
        loading: false,
        familyName: (app.globalData.family && app.globalData.family.name) || '',
        recent: recent.list,
        overview: {
          monthLabel: ov.month.label,
          monthTotal: format.money(ov.month.total),
          monthCount: ov.month.count,
          avgPerDay: format.money(ov.month.avgPerDay),
          today: format.money(ov.today.total),
          week: format.money(ov.week.total),
          lastMonth: format.money(ov.lastMonth.total),
          change: ov.lastMonth.change,
          changeText: format.percent(ov.lastMonth.change),
          series: ov.month.series.map((s) => ({ label: s.label, value: s.amount, title: format.friendlyDate(s.key) })),
          categories: ov.month.byCategory.map((c) => {
            const cat = format.category(c.id);
            return {
              id: c.id,
              icon: cat.icon,
              name: cat.name,
              amount: format.money(c.amount),
              percent: c.percent,
              width: maxCat > 0 ? Math.max(2, c.amount / maxCat * 100) : 0
            };
          })
        }
      });
    } catch (e) {
      this.setData({ loading: false });
      app.globalData.dirty.home = true;
    }
  },

  onCamera() {
    capture.captureReceipt('camera');
  },

  onAlbum() {
    capture.captureReceipt('album');
  },

  onManual() {
    wx.navigateTo({ url: '/pages/receipt-edit/index?mode=manual' });
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/index' });
  },

  goReceipts() {
    wx.switchTab({ url: '/pages/receipts/index' });
  },

  onShareAppMessage() {
    return { title: 'Receipt Box 收据箱：拍小票自动记账、比价', path: '/pages/index/index' };
  }
});
