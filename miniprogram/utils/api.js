/**
 * 云函数调用封装。
 *   call(action, params, { silent, loading })  调用 api 云函数
 *   uploadReceiptImage(filePath)               压缩并上传小票图片，返回 fileID
 *   parseJob(jobId)                            启动后台识别（parseReceipt 云函数）
 */

const dates = require('../shared/dates');
const errors = require('./errors');
const image = require('./image');

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

/**
 * 压缩并上传小票照片，返回 fileID。
 * onProgress(stage, percent)：stage 为 'compress' 或 'upload'，用于在界面上显示进度。
 */
async function uploadReceiptImage(filePath, onProgress) {
  const report = onProgress || function () {};
  report('compress', 0);
  const path = await image.prepareImage(filePath);
  const ext = (path.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const today = dates.today();
  const cloudPath = 'receipts/' + today.slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  report('upload', 0);
  const startedAt = Date.now();
  const fileID = await new Promise((resolve, reject) => {
    const task = wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: path,
      success: (res) => resolve(res.fileID),
      fail: reject
    });
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate((p) => report('upload', p.progress || 0));
    }
  });
  console.log('image uploaded', { ms: Date.now() - startedAt });
  return fileID;
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
