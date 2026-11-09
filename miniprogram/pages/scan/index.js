/**
 * 识别页：上传图片 → 云函数识别 → 跳转到编辑确认页。
 */
const app = getApp();
const api = require('../../utils/api');

const STEPS = ['上传图片', '识别小票内容', '整理商品与分类'];

Page({
  data: {
    path: '',
    step: 0,
    stepViews: [],
    error: '',
    fileID: ''
  },

  /** 更新进度步骤（在 JS 中计算状态，避免在 WXML 表达式里写比较运算） */
  setStep(step, error) {
    this.setData({
      step: step,
      error: error || '',
      stepViews: STEPS.map((name, i) => ({
        name: name,
        state: i < step ? 'done' : i === step && !error ? 'doing' : '',
        mark: i < step ? '✓' : String(i + 1)
      }))
    });
  },

  onLoad(query) {
    const path = decodeURIComponent(query.path || '');
    this.setData({ path: path });
    if (path) this.run();
  },

  onUnload() {
    this._cancelled = true;
    clearTimeout(this._stepTimer);
  },

  async run() {
    this.setStep(0);
    try {
      let fileID = this.data.fileID;
      if (!fileID) {
        fileID = await api.uploadReceiptImage(this.data.path);
        this.setData({ fileID: fileID });
      }
      if (this._cancelled) return;
      this.setStep(1);
      // 识别通常需要 10-30 秒，期间推进一下进度提示
      this._stepTimer = setTimeout(() => this.setStep(2), 8000);
      const res = await api.parseReceipt(fileID);
      clearTimeout(this._stepTimer);
      if (this._cancelled) return;
      app.globalData.draft = res.draft;
      app.globalData.draftWarnings = res.warnings || [];
      wx.redirectTo({ url: '/pages/receipt-edit/index?mode=create&engine=' + (res.engine || '') });
    } catch (err) {
      clearTimeout(this._stepTimer);
      if (this._cancelled) return;
      this.setStep(this.data.step, err.message || '识别失败');
    }
  },

  onRetry() {
    this.run();
  },

  /** 识别失败时带着图片进入手动录入 */
  onManual() {
    app.globalData.draft = { imageFileID: this.data.fileID, items: [], source: 'manual' };
    app.globalData.draftWarnings = [];
    wx.redirectTo({ url: '/pages/receipt-edit/index?mode=create' });
  },

  onPreview() {
    wx.previewImage({ urls: [this.data.path] });
  }
});
