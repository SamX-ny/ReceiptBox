/**
 * 商品价格追踪：商品列表、单个商品的价格历史（按时间、按商户）、同类商品不同规格比较、合并与重命名。
 */

const { db, $, AppError, fetchAll, escapeRegExp } = require('./db');
const statsLib = require('../shared/stats');
const categories = require('../shared/categories');

function baseKey(productKey) {
  return String(productKey || '').split('|')[0];
}

/**
 * 入参：{ keyword, category, sort: 'recent'|'frequent'|'name', skip, limit }
 */
async function list(ctx, params) {
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 20, 1), 100);
  const skip = Math.max(parseInt(params.skip, 10) || 0, 0);
  const match = { familyId: ctx.family._id };
  const keyword = String(params.keyword || '').trim().slice(0, 30);
  if (keyword) match.productName = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
  if (params.category && categories.isCategory(params.category)) match.category = params.category;

  const sortStage = params.sort === 'frequent'
    ? { count: -1, lastDate: -1 }
    : params.sort === 'name' ? { productName: 1 } : { lastDate: -1, count: -1 };

  const res = await db.collection('priceRecords').aggregate()
    .match(match)
    .sort({ date: 1, createdAt: 1 })
    .group({
      _id: '$productKey',
      productName: $.last('$productName'),
      brand: $.last('$brand'),
      spec: $.last('$spec'),
      category: $.last('$category'),
      count: $.sum(1),
      minPrice: $.min('$unitPrice'),
      maxPrice: $.max('$unitPrice'),
      lastPrice: $.last('$unitPrice'),
      lastUnit: $.last('$unit'),
      lastDate: $.last('$date'),
      lastMerchant: $.last('$merchantName'),
      measurePrice: $.last('$measurePrice'),
      measureUnit: $.last('$measureUnit'),
      stores: $.addToSet('$merchantName')
    })
    .sort(sortStage)
    .skip(skip)
    .limit(limit)
    .end();

  const rows = res.list.map(function (r) {
    return {
      productKey: r._id,
      productName: r.productName,
      brand: r.brand,
      spec: r.spec,
      category: r.category,
      count: r.count,
      minPrice: r.minPrice,
      maxPrice: r.maxPrice,
      lastPrice: r.lastPrice,
      lastUnit: r.lastUnit,
      lastDate: r.lastDate,
      lastMerchant: r.lastMerchant,
      measurePrice: r.measurePrice,
      measureUnit: r.measureUnit,
      storeCount: (r.stores || []).length
    };
  });
  return { list: rows, hasMore: rows.length === limit, nextSkip: skip + rows.length };
}

/** 单个商品的价格历史与统计，以及同名不同规格的商品（便于按每升/每千克比较） */
async function history(ctx, params) {
  const key = String(params.productKey || '');
  if (!key) throw new AppError('INVALID_ARGUMENT', '缺少商品');
  const records = await fetchAll(
    db.collection('priceRecords').where({ familyId: ctx.family._id, productKey: key }),
    { max: 5000 }
  );
  if (!records.length) throw new AppError('NOT_FOUND', '没有该商品的价格记录');

  const latest = records.reduce(function (a, r) { return !a || r.date >= a.date ? r : a; }, null);
  const base = baseKey(key);
  const variantsRes = await db.collection('priceRecords').aggregate()
    .match({
      familyId: ctx.family._id,
      productKey: db.RegExp({ regexp: '^' + escapeRegExp(base) + '(\\|.*)?$' })
    })
    .sort({ date: 1 })
    .group({
      _id: '$productKey',
      spec: $.last('$spec'),
      lastPrice: $.last('$unitPrice'),
      lastDate: $.last('$date'),
      lastMerchant: $.last('$merchantName'),
      measurePrice: $.last('$measurePrice'),
      measureUnit: $.last('$measureUnit'),
      count: $.sum(1)
    })
    .end();

  return {
    product: {
      productKey: key,
      productName: latest.productName,
      brand: latest.brand,
      spec: latest.spec,
      category: latest.category,
      unit: latest.unit
    },
    summary: statsLib.priceSummary(records),
    variants: variantsRes.list
      .filter(function (v) { return v._id !== key; })
      .map(function (v) { return Object.assign({ productKey: v._id }, v); })
      .sort(function (a, b) { return (a.measurePrice || Infinity) - (b.measurePrice || Infinity); })
  };
}

/** 把 fromKey 的价格记录并入 toKey，并记住别名，之后的小票自动归并 */
async function merge(ctx, params) {
  const fromKey = String(params.fromKey || '');
  const toKey = String(params.toKey || '');
  if (!fromKey || !toKey || fromKey === toKey) throw new AppError('INVALID_ARGUMENT', '请选择要合并的两个不同商品');
  const target = await db.collection('priceRecords').where({ familyId: ctx.family._id, productKey: toKey })
    .orderBy('date', 'desc').limit(1).get();
  if (!target.data.length) throw new AppError('NOT_FOUND', '目标商品不存在');
  const t = target.data[0];

  const res = await db.collection('priceRecords').where({ familyId: ctx.family._id, productKey: fromKey }).update({
    data: { productKey: toKey, productName: t.productName, brand: t.brand || '', category: t.category }
  });
  // 记录别名；指向 fromKey 的旧别名也一并改指向 toKey
  await db.collection('productAliases').where({ familyId: ctx.family._id, toKey: fromKey }).update({ data: { toKey: toKey } });
  await db.collection('productAliases').doc(ctx.family._id + ':' + fromKey).set({
    data: { familyId: ctx.family._id, fromKey: fromKey, toKey: toKey, createdAt: db.serverDate() }
  });
  return { merged: res.stats ? res.stats.updated : 0, productKey: toKey };
}

async function rename(ctx, params) {
  const key = String(params.productKey || '');
  const name = String(params.productName || '').trim().slice(0, 80);
  if (!key || !name) throw new AppError('INVALID_ARGUMENT', '请输入商品名称');
  const data = { productName: name };
  if (params.category && categories.isCategory(params.category)) data.category = params.category;
  const res = await db.collection('priceRecords').where({ familyId: ctx.family._id, productKey: key }).update({ data: data });
  return { updated: res.stats ? res.stats.updated : 0 };
}

module.exports = {
  actions: {
    'product.list': list,
    'product.history': history,
    'product.merge': merge,
    'product.rename': rename
  }
};
