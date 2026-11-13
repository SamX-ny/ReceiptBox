/**
 * 后台识别管理（应用级，不依赖某个页面）。
 *
 * start(path)：上传图片 → 创建识别任务 → 启动云函数识别，全程不阻塞界面；
 * 用户可以立刻去做别的，识别完成后会有轻提示，结果出现在首页“待确认小票”里。
 *
 * 上传阶段的条目只存在于本机内存（localItems），上传成功后变成服务端的识别任务。
 */

const api = require('./api');
const dates = require('../shared/dates');

const listeners = [];
let local = [];
let seq = 0;

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('scan listener failed', e);
    }
  });
}

/** 订阅状态变化（上传完成、识别完成等）。返回取消订阅函数 */
function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function localItems() {
  return local.slice();
}

function removeLocal(localId) {
  local = local.filter((x) => x.localId !== localId);
}

/** 启动云函数识别，不等待结果；结束时提示并通知页面刷新 */
function runJob(jobId) {
  return api.parseJob(jobId).then(() => {
    notify();
    wx.showToast({ title: '小票识别完成，回首页核对', icon: 'none', duration: 2500 });
  }, (err) => {
    // 云函数正常返回的失败已写入任务；调用本身失败（超时、未部署等）需要由这里上报
    const report = err.code === 'NETWORK'
      ? api.call('scan.fail', { id: jobId, message: err.message }, { silent: true }).catch(() => {})
      : Promise.resolve();
    return report.then(() => {
      notify();
      wx.showToast({ title: '有小票识别失败，回首页查看', icon: 'none', duration: 2500 });
    });
  });
}

async function start(path) {
  const item = { localId: 'local' + (++seq), path: path, status: 'uploading', error: '' };
  local.unshift(item);
  notify();
  try {
    const fileID = await api.uploadReceiptImage(path);
    const res = await api.call('scan.create', { fileID: fileID, today: dates.today() }, { silent: true });
    removeLocal(item.localId);
    notify();
    runJob(res.job._id);
  } catch (err) {
    console.error('upload failed', err);
    item.status = 'failed';
    item.error = err.code ? err.message : '上传失败，请检查网络后重试';
    notify();
  }
}

function retryLocal(localId) {
  const item = local.find((x) => x.localId === localId);
  if (!item) return;
  removeLocal(localId);
  start(item.path);
}

function dismissLocal(localId) {
  removeLocal(localId);
  notify();
}

/** 重新识别一个失败的任务 */
async function retry(jobId) {
  await api.call('scan.retry', { id: jobId });
  notify();
  runJob(jobId);
}

async function remove(jobId) {
  await api.call('scan.delete', { id: jobId });
  notify();
}

module.exports = {
  start: start,
  retry: retry,
  remove: remove,
  retryLocal: retryLocal,
  dismissLocal: dismissLocal,
  localItems: localItems,
  subscribe: subscribe,
  notify: notify
};
