/**
 * 识别任务（scanJobs）：让小票识别在后台进行，用户上传后不必停留等待。
 *
 * 流程：
 *   1. 小程序上传图片后调用 scan.create，得到一个“识别中”的任务
 *   2. 小程序调用云函数 parseReceipt({ jobId })，不等待结果；
 *      parseReceipt 识别完成后把草稿（或失败原因）写回任务
 *   3. 首页“待确认小票”列出任务；用户点开核对后保存为小票（receipt.create 带 jobId），任务随之删除
 *
 * 任务只对创建者本人可见。
 * scanJobs { _id, familyId, createdBy, imageFileID, today, status: 'processing'|'ready'|'failed',
 *            draft, warnings, engine, errorCode, errorMessage, startedAt, createdAt, updatedAt }
 */

const { cloud, db, AppError, isNotFound } = require('./db');
const dates = require('../shared/dates');

// parseReceipt 最长运行 60 秒；超过这个时间还在“识别中”，说明云函数被中断了
const STALE_MS = 90 * 1000;
const MAX_PENDING = 30;
const STALE_MESSAGE = '识别超时，请重试。如果每次都超时，请确认云函数 parseReceipt 的超时时间已设为 60 秒';

function effectiveStatus(job, now) {
  if (job.status === 'processing') {
    const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
    if (now - started > STALE_MS) return 'failed';
  }
  return job.status;
}

function publicJob(job, now, imageUrl) {
  const status = effectiveStatus(job, now);
  const draft = job.draft || {};
  const out = {
    _id: job._id,
    status: status,
    imageUrl: imageUrl || '',
    engine: status === 'ready' ? (job.engine || '') : ''
  };
  if (status === 'ready') {
    out.merchantName = (draft.merchant && draft.merchant.name) || '';
    out.total = draft.total || 0;
    out.date = draft.date || '';
    out.itemCount = (draft.items || []).length;
  }
  if (status === 'failed') {
    out.errorMessage = job.status === 'processing' ? STALE_MESSAGE : (job.errorMessage || '识别失败');
  }
  return out;
}

async function tempUrls(fileIDs) {
  const map = {};
  const list = fileIDs.filter(Boolean);
  if (!list.length) return map;
  try {
    const res = await cloud.getTempFileURL({ fileList: list });
    (res.fileList || []).forEach(function (f) { map[f.fileID] = f.tempFileURL || ''; });
  } catch (err) {
    console.warn('getTempFileURL failed', err);
  }
  return map;
}

async function getOwnedJob(ctx, id) {
  if (!id) throw new AppError('INVALID_ARGUMENT', '缺少识别任务 ID');
  let job;
  try {
    job = (await db.collection('scanJobs').doc(String(id)).get()).data;
  } catch (err) {
    if (!isNotFound(err)) throw err;
    job = null;
  }
  if (!job || job.createdBy !== ctx.openid) throw new AppError('NOT_FOUND', '这张待确认的小票不存在或已处理');
  return job;
}

async function create(ctx, params) {
  const fileID = String(params.fileID || '');
  if (fileID.indexOf('cloud://') !== 0) throw new AppError('INVALID_ARGUMENT', '缺少小票图片');
  const count = await db.collection('scanJobs').where({ createdBy: ctx.openid }).count();
  if (count.total >= MAX_PENDING) throw new AppError('TOO_MANY', '待确认的小票太多了，请先处理首页上已有的');

  const doc = {
    familyId: ctx.family._id,
    createdBy: ctx.openid,
    imageFileID: fileID,
    today: dates.isDateStr(params.today) ? params.today : dates.today(),
    status: 'processing',
    startedAt: new Date(),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  const res = await db.collection('scanJobs').add({ data: doc });
  return { job: publicJob(Object.assign({ _id: res._id }, doc), Date.now(), '') };
}

async function list(ctx) {
  const res = await db.collection('scanJobs')
    .where({ createdBy: ctx.openid })
    .orderBy('createdAt', 'desc')
    .limit(MAX_PENDING)
    .get();
  const urls = await tempUrls(res.data.map(function (j) { return j.imageFileID; }));
  const now = Date.now();
  return { list: res.data.map(function (j) { return publicJob(j, now, urls[j.imageFileID]); }) };
}

/** 确认页使用：返回识别草稿；失败或未完成的任务返回只带图片的空草稿，供手动录入 */
async function get(ctx, params) {
  const job = await getOwnedJob(ctx, params.id);
  const status = effectiveStatus(job, Date.now());
  const urls = await tempUrls([job.imageFileID]);
  const ready = status === 'ready' && job.draft;
  return {
    _id: job._id,
    status: status,
    engine: ready ? (job.engine || '') : '',
    imageUrl: urls[job.imageFileID] || '',
    warnings: ready ? (job.warnings || []) : [],
    draft: ready ? job.draft : { imageFileID: job.imageFileID, date: job.today, items: [], source: 'manual' }
  };
}

async function retry(ctx, params) {
  const job = await getOwnedJob(ctx, params.id);
  await db.collection('scanJobs').doc(job._id).update({
    data: { status: 'processing', startedAt: new Date(), errorCode: '', errorMessage: '', updatedAt: db.serverDate() }
  });
  return { _id: job._id };
}

/** 小程序端发现 parseReceipt 调用本身失败（如超时、未部署）时，把原因记到任务上 */
async function fail(ctx, params) {
  const job = await getOwnedJob(ctx, params.id);
  if (job.status !== 'processing') return { _id: job._id, status: job.status };
  const message = String(params.message || '识别失败').slice(0, 300);
  await db.collection('scanJobs').doc(job._id).update({
    data: { status: 'failed', errorCode: 'CALL_FAILED', errorMessage: message, updatedAt: db.serverDate() }
  });
  return { _id: job._id, status: 'failed' };
}

async function remove(ctx, params) {
  const job = await getOwnedJob(ctx, params.id);
  await db.collection('scanJobs').doc(job._id).remove();
  if (job.imageFileID) {
    try {
      await cloud.deleteFile({ fileList: [job.imageFileID] });
    } catch (err) {
      console.warn('delete image failed', err);
    }
  }
  return { _id: job._id };
}

module.exports = {
  getOwnedJob: getOwnedJob,
  effectiveStatus: effectiveStatus,
  STALE_MS: STALE_MS,
  actions: {
    'scan.create': create,
    'scan.list': list,
    'scan.get': get,
    'scan.retry': retry,
    'scan.fail': fail,
    'scan.delete': remove
  }
};
