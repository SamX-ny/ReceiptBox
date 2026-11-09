/**
 * 云函数调用封装。
 *   call(action, params, { silent, loading })  调用 api 云函数
 *   uploadReceiptImage(filePath)               压缩并上传小票图片，返回 fileID
 *   parseReceipt(fileID)                       调用 parseReceipt 云函数识别
 */

const config = require('../config');
const dates = require('../shared/dates');

function toast(message) {
  wx.showToast({ title: String(message || '操作失败').slice(0, 30), icon: 'none', duration: 2500 });
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
        err = Object.assign(new Error(/timeout/i.test(err.errMsg || '') ? '网络超时，请重试' : '网络异常，请重试'), { code: 'NETWORK' });
      }
      if (!opts.silent) toast(err.message);
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

/** 压缩到最长边 config.maxImageSide 以内、小于 4MB（Claude 单图上限 5MB） */
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
  if ((await fileSize(path)) > 4 * 1024 * 1024) path = await compress(path, 1200);
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

function parseReceipt(fileID) {
  return wx.cloud.callFunction({ name: 'parseReceipt', data: { fileID: fileID, today: dates.today() } })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) {
        const err = new Error(r.message || '识别失败');
        err.code = r.code;
        throw err;
      }
      return r;
    }, (err) => {
      console.error('parseReceipt failed', err);
      const e = new Error(/timeout|time out/i.test(err.errMsg || '') ? '识别超时，请重试' : '识别服务暂不可用');
      e.code = 'NETWORK';
      throw e;
    });
}

module.exports = {
  call: call,
  toast: toast,
  uploadReceiptImage: uploadReceiptImage,
  parseReceipt: parseReceipt
};
