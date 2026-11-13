/**
 * 小票增删改查。保存小票时同步生成 priceRecords（每个商品一行）用于价格追踪。
 */

const { cloud, db, _, AppError, fetchAll, inChunks, escapeRegExp, isNotFound } = require('./db');
const receiptLib = require('../shared/receipt');
const dates = require('../shared/dates');
const categories = require('../shared/categories');

const LIST_FIELDS = {
  merchant: true, date: true, time: true, total: true, currency: true,
  category: true, categories: true, itemCount: true, source: true, imageFileID: true, createdBy: true
};

async function loadAliases(familyId) {
  const rows = await fetchAll(db.collection('productAliases').where({ familyId: familyId }), { max: 5000 });
  const map = {};
  rows.forEach(function (r) {
    map[r.fromKey] = { productKey: r.toKey, productName: r.productName || '', brand: r.brand || '', category: r.category || '' };
  });
  return map;
}

function derivedFields(receipt) {
  const cats = {};
  receipt.items.forEach(function (it) { cats[it.category] = true; });
  cats[receipt.category] = true;
  return { categories: Object.keys(cats), itemCount: receipt.items.length };
}

async function writePriceRecords(familyId, receiptId, receipt) {
  const aliases = await loadAliases(familyId);
  const records = receiptLib.buildPriceRecords(receipt, { familyId: familyId, receiptId: receiptId, aliases: aliases });
  await inChunks(records, 10, function (r) {
    return db.collection('priceRecords').add({ data: Object.assign(r, { createdAt: db.serverDate() }) });
  });
  return records.length;
}

async function getOwned(ctx, id) {
  if (!id) throw new AppError('INVALID_ARGUMENT', '缺少小票 ID');
  let doc;
  try {
    doc = (await db.collection('receipts').doc(id).get()).data;
  } catch (err) {
    if (!isNotFound(err)) throw err;
    throw new AppError('NOT_FOUND', '小票不存在或已删除');
  }
  if (!doc || doc.familyId !== ctx.family._id) throw new AppError('NOT_FOUND', '小票不存在或已删除');
  return doc;
}

/**
 * 查找可能重复的小票（规则见 receiptLib.isSameReceipt）。
 * 商户名在内存里比较，这样大小写、空格不同的写法也能认出来。
 */
async function findDuplicate(familyId, receipt, excludeId) {
  const res = await db.collection('receipts').where({
    familyId: familyId,
    date: receipt.date,
    total: receipt.total
  }).field({ _id: true, date: true, time: true, total: true, merchant: true }).limit(50).get();
  const hit = res.data.find(function (r) {
    return r._id !== excludeId && receiptLib.isSameReceipt(receipt, r);
  });
  return hit ? hit._id : null;
}

/**
 * 批量版本：给多张草稿各找一张可能重复的已保存小票，只查询一次数据库。
 * 返回与 drafts 等长的数组，元素为小票 _id 或 null。
 */
async function findDuplicatesFor(familyId, drafts) {
  const dateSet = {};
  drafts.forEach(function (d) { if (d && d.date) dateSet[d.date] = true; });
  const dateList = Object.keys(dateSet);
  if (!dateList.length) return drafts.map(function () { return null; });
  const candidates = await fetchAll(
    db.collection('receipts').where({ familyId: familyId, date: _.in(dateList) }),
    { field: { _id: true, date: true, time: true, total: true, merchant: true }, max: 2000 }
  );
  return drafts.map(function (d) {
    const hit = d && candidates.find(function (r) { return receiptLib.isSameReceipt(d, r); });
    return hit ? hit._id : null;
  });
}

async function create(ctx, params) {
  // 来自后台识别任务：图片与来源以任务记录为准，保存成功后任务随之删除
  let job = null;
  let input = params.receipt;
  if (params.jobId) {
    job = await require('./scans').getOwnedJob(ctx, params.jobId);
    input = Object.assign({}, params.receipt, {
      imageFileID: job.imageFileID,
      source: job.status === 'ready' && job.engine ? job.engine : 'manual'
    });
  }
  const sanitized = receiptLib.sanitizeReceipt(input, { defaultDate: params.today });
  const receipt = sanitized.receipt;
  if (!(receipt.total > 0) && !receipt.items.length) throw new AppError('INVALID_ARGUMENT', '请至少填写金额或一个商品');

  if (!params.force) {
    const dup = await findDuplicate(ctx.family._id, receipt);
    if (dup) return { duplicateOf: dup };
  }

  const doc = Object.assign({}, receipt, derivedFields(receipt), {
    familyId: ctx.family._id,
    createdBy: ctx.openid,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  });
  const res = await db.collection('receipts').add({ data: doc });
  await writePriceRecords(ctx.family._id, res._id, receipt);
  if (job) await db.collection('scanJobs').doc(job._id).remove();
  return { _id: res._id, warnings: sanitized.warnings };
}

async function update(ctx, params) {
  const existing = await getOwned(ctx, params.id);
  const sanitized = receiptLib.sanitizeReceipt(
    Object.assign({}, params.receipt, { imageFileID: existing.imageFileID, source: existing.source }),
    { defaultDate: existing.date }
  );
  const receipt = sanitized.receipt;
  // 只有改动了日期 / 金额 / 商户，才检查是否与别的小票重复（避免每次编辑都提醒）
  const keyChanged = receipt.date !== existing.date || receipt.total !== existing.total ||
    receiptLib.merchantKey(receipt.merchant.name) !== receiptLib.merchantKey(existing.merchant && existing.merchant.name);
  if (keyChanged && !params.force) {
    const dup = await findDuplicate(existing.familyId, receipt, existing._id);
    if (dup) return { duplicateOf: dup };
  }
  // 用 set 覆盖整条记录（保留归属与创建信息），避免嵌套数组残留旧字段
  await db.collection('receipts').doc(existing._id).set({
    data: Object.assign({}, receipt, derivedFields(receipt), {
      familyId: existing.familyId,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      updatedAt: db.serverDate()
    })
  });
  await db.collection('priceRecords').where({ receiptId: existing._id }).remove();
  await writePriceRecords(existing.familyId, existing._id, receipt);
  return { _id: existing._id, warnings: sanitized.warnings };
}

async function remove(ctx, params) {
  const existing = await getOwned(ctx, params.id);
  await db.collection('receipts').doc(existing._id).remove();
  await db.collection('priceRecords').where({ receiptId: existing._id }).remove();
  if (existing.imageFileID) {
    try {
      await cloud.deleteFile({ fileList: [existing.imageFileID] });
    } catch (err) {
      console.warn('delete image failed', err);
    }
  }
  return { _id: existing._id };
}

async function tempUrl(fileID) {
  if (!fileID) return '';
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileID] });
    return (res.fileList[0] && res.fileList[0].tempFileURL) || '';
  } catch (err) {
    return '';
  }
}

async function get(ctx, params) {
  const doc = await getOwned(ctx, params.id);
  const member = (ctx.family.members || []).find(function (m) { return m.openid === doc.createdBy; });
  return Object.assign({}, doc, {
    imageUrl: await tempUrl(doc.imageFileID),
    createdByName: doc.createdBy === ctx.openid ? '我' : ((member && member.nickName) || '家庭成员'),
    canEdit: true
  });
}

function buildListQuery(ctx, params) {
  const cond = { familyId: ctx.family._id };
  if (params.start || params.end) {
    if (params.start && !dates.isDateStr(params.start)) throw new AppError('INVALID_ARGUMENT', '开始日期格式错误');
    if (params.end && !dates.isDateStr(params.end)) throw new AppError('INVALID_ARGUMENT', '结束日期格式错误');
    if (params.start && params.end) cond.date = _.gte(params.start).and(_.lte(params.end));
    else if (params.start) cond.date = _.gte(params.start);
    else cond.date = _.lte(params.end);
  }
  if (params.category && categories.isCategory(params.category)) cond.categories = params.category;
  if (params.merchantType && categories.isMerchantType(params.merchantType)) cond['merchant.type'] = params.merchantType;
  if (params.merchant) cond['merchant.name'] = String(params.merchant).slice(0, 60);

  const keyword = String(params.keyword || '').trim().slice(0, 30);
  if (keyword) {
    const re = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
    return _.and([cond, _.or([{ 'merchant.name': re }, { 'items.productName': re }, { 'items.name': re }, { note: re }])]);
  }
  return cond;
}

async function list(ctx, params) {
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 20, 1), 100);
  const skip = Math.max(parseInt(params.skip, 10) || 0, 0);
  const fields = params.withItems ? Object.assign({ items: true }, LIST_FIELDS) : LIST_FIELDS;
  const res = await db.collection('receipts')
    .where(buildListQuery(ctx, params))
    .field(fields)
    .orderBy('date', 'desc')
    .orderBy('time', 'desc')
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();
  return { list: res.data, hasMore: res.data.length === limit, nextSkip: skip + res.data.length };
}

module.exports = {
  loadAliases: loadAliases,
  findDuplicate: findDuplicate,
  findDuplicatesFor: findDuplicatesFor,
  actions: {
    'receipt.create': create,
    'receipt.update': update,
    'receipt.delete': remove,
    'receipt.get': get,
    'receipt.list': list
  }
};
