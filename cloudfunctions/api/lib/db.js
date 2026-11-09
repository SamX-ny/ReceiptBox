/**
 * 数据库访问辅助。集合：
 *   users          { _id: openid, familyId, nickName, createdAt }
 *   families       { _id, name, ownerOpenid, members: [{ openid, nickName, joinedAt }], inviteCode, createdAt }
 *   receipts       { _id, familyId, createdBy, ...小票字段, categories, itemCount, createdAt, updatedAt }
 *   priceRecords   { _id, familyId, receiptId, productKey, productName, unitPrice, merchantName, date, ... }
 *   productAliases { _id: familyId + ':' + fromKey, familyId, fromKey, toKey }
 */

const cloud = require('wx-server-sdk');

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const PAGE = 1000; // 服务端单次 get 上限

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

function isNotFound(err) {
  const msg = String((err && (err.errMsg || err.message)) || '');
  return /not exist|does not exist|cannot find|not found/i.test(msg);
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
  isNotFound: isNotFound
};
