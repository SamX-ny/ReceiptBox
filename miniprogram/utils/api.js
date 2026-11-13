/**
 * 云函数调用封装。
 *   call(action, params, { silent, loading })  调用 api 云函数
 *   uploadReceiptImage(filePath)               压缩并上传小票图片，返回 fileID
 *   parseJob(jobId)                            启动后台识别（parseReceipt 云函数）
 */

const config = require('../config');
const dates = require('../shared/dates');
const errors = require('./errors');

function toast(message) {
  wx.showToast({ title: String(message || '操作失败').slice(0, 30), icon: 'none', duration: 2500 });
}

/** 业务错误用轻提示；云函数调用失败的排查信息较长，用弹窗完整显示 */
function showError(err) {
  if (err.code === 'NETWORK') {
    wx.showModal({ title: '出错了', content: err.message, showCancel: false });
  } else {
    toast(err.message);
  }
}

function call(action, params, opts) {
  opts = opts || {};
  if (opts.loading) wx.showLoading({ title: opts.loading, mask: true });
  return wx.cloud.callFunction({ name: 'api', data: { action: action, params: params || {} } })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) {
        const err = new Error(r.message || '操作失败');
        err.code = r.code;
        throw err;
      }
      return r.data;
    })
    .catch((err) => {
      if (!err.code) {
        console.error('callFunction failed', action, err);
        err = Object.assign(new Error(errors.describeCallError(err, 'api')), { code: 'NETWORK' });
      }
      if (!opts.silent) showError(err);
      throw err;
    })
    .finally(() => {
      if (opts.loading) wx.hideLoading();
    });
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => wx.getImageInfo({ src: src, success: resolve, fail: reject }));
}

function compress(src, width) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: src,
      quality: 80,
      compressedWidth: width,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(src)
    });
  });
}

function fileSize(path) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: (res) => resolve(res.size),
      fail: () => resolve(0)
    });
  });
}

/** 压缩到最长边 config.maxImageSide 以内、小于 2MB，满足 OCR 接口的图片大小要求 */
async function prepareImage(src) {
  let path = src;
  try {
    const info = await getImageInfo(src);
    const longSide = Math.max(info.width, info.height);
    if (longSide > config.maxImageSide) {
      // compressedWidth 指定的是宽度；按比例换算出最长边达标时的宽度
      const width = Math.round(info.width * config.maxImageSide / longSide);
      path = await compress(src, width);
    }
  } catch (e) {
    console.warn('getImageInfo failed', e);
  }
  if ((await fileSize(path)) > 2 * 1024 * 1024) path = await compress(path, 1400);
  if ((await fileSize(path)) > 2 * 1024 * 1024) path = await compress(path, 1000);
  return path;
}

async function uploadReceiptImage(filePath) {
  const path = await prepareImage(filePath);
  const ext = (path.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const today = dates.today();
  const cloudPath = 'receipts/' + today.slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const res = await wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: path });
  return res.fileID;
}

/**
 * 启动后台识别：云函数 parseReceipt 处理识别任务并把结果写回任务记录。
 * 返回的 Promise 只用于“识别完成/失败”的提示，调用方不需要等待它。
 */
function parseJob(jobId) {
  return wx.cloud.callFunction({ name: 'parseReceipt', data: { jobId: jobId } })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) {
        const err = new Error(r.message || '识别失败');
        err.code = r.code || 'RECOGNIZE_FAILED';
        throw err;
      }
      return r;
    }, (err) => {
      console.error('parseReceipt failed', err);
      const e = new Error(errors.describeCallError(err, 'parseReceipt'));
      e.code = 'NETWORK';
      throw e;
    });
}

module.exports = {
  call: call,
  toast: toast,
  uploadReceiptImage: uploadReceiptImage,
  parseJob: parseJob
};
