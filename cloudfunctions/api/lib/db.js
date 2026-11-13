/**
 * 数据库访问辅助。集合：
 *   users          { _id: openid, familyId, nickName, createdAt }
 *   families       { _id, name, ownerOpenid, members: [{ openid, nickName, joinedAt }], inviteCode, createdAt }
 *   receipts       { _id, familyId, createdBy, ...小票字段, categories, itemCount, createdAt, updatedAt }
 *   priceRecords   { _id, familyId, receiptId, productKey, productName, unitPrice, merchantName, date, ... }
 *   productAliases { _id: familyId + ':' + fromKey, familyId, fromKey, toKey }
 *   scanJobs       { _id, familyId, createdBy, imageFileID, status, draft, ... }（后台识别任务，见 scans.js）
 *
 * 这些集合会在云函数首次运行时自动创建（见 ensureCollections），无需手动建表。
 */

const cloud = require('wx-server-sdk');

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const PAGE = 1000; // 服务端单次 get 上限

const COLLECTIONS = ['users', 'families', 'receipts', 'priceRecords', 'productAliases', 'scanJobs'];

let collectionsReady = null;

function errorText(err) {
  return String((err && (err.errMsg || err.message)) || '');
}

/** 是否为“集合不存在”错误（云开发错误码 -502005） */
function isCollectionMissing(err) {
  return (err && err.errCode === -502005) || /-502005|collection not exists?|table not exists?/i.test(errorText(err));
}

/**
 * 确保所需集合都已创建：每个云函数实例（冷启动）只执行一次。
 * 集合已存在时 createCollection 会报错，这里一律忽略；
 * 如果真的创建失败（如无权限），后续读写会报“集合不存在”，由入口函数给出明确提示。
 */
function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all(COLLECTIONS.map(function (name) {
      return db.createCollection(name).then(function () {
        console.log('created collection', name);
      }, function (err) {
        if (!/exist/i.test(errorText(err))) console.warn('createCollection ' + name + ' failed', errorText(err));
      });
    }));
  }
  return collectionsReady;
}

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 读取查询的全部结果（自动分页），max 防止异常数据量拖垮云函数 */
async function fetchAll(query, opts) {
  opts = opts || {};
  const max = opts.max || 10000;
  const out = [];
  let q = query;
  if (opts.field) q = q.field(opts.field);
  if (opts.orderBy) opts.orderBy.forEach(function (o) { q = q.orderBy(o[0], o[1]); });
  while (out.length < max) {
    const res = await q.skip(out.length).limit(Math.min(PAGE, max - out.length)).get();
    out.push.apply(out, res.data);
    if (res.data.length < PAGE) break;
  }
  return out;
}

/** 分批并发执行，避免一次发出过多数据库请求 */
async function inChunks(list, size, fn) {
  for (let i = 0; i < list.length; i += size) {
    await Promise.all(list.slice(i, i + size).map(fn));
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 文档不存在（注意与“集合不存在”区分，后者需要报错而不是当作空结果） */
function isNotFound(err) {
  if (isCollectionMissing(err)) return false;
  return /not exist|does not exist|cannot find|not found/i.test(errorText(err));
}

module.exports = {
  cloud: cloud,
  db: db,
  _: _,
  $: $,
  AppError: AppError,
  fetchAll: fetchAll,
  inChunks: inChunks,
  escapeRegExp: escapeRegExp,
  isNotFound: isNotFound,
  COLLECTIONS: COLLECTIONS,
  ensureCollections: ensureCollections,
  isCollectionMissing: isCollectionMissing,
  // 仅供测试：模拟新的云函数实例
  resetCollectionsCheck: function () { collectionsReady = null; }
};
