/**
 * wx-server-sdk 的内存模拟，用于在 Node 中运行云函数做集成测试。
 * 只实现本项目用到的数据库 / 存储能力，语义参照云开发文档（MongoDB 风格）。
 *
 *   const fake = require('./helpers/fake-cloud');
 *   fake.install();            // 之后 require('wx-server-sdk') 得到模拟对象
 *   fake.setOpenid('user-a');  // 切换当前调用用户
 *   fake.reset();              // 清空数据
 */

const Module = require('module');

let docsByCollection = {};
let files = {};
let openid = 'openid-test';
let idSeq = 0;

// 严格模式：和真实云数据库一样，集合必须先创建才能读写
let strict = false;
// 测试可注入 createCollection 的失败，如模拟无权限
let createCollectionError = null;
let createCollectionCalls = 0;

function reset() {
  docsByCollection = {};
  files = {};
  idSeq = 0;
  strict = false;
  createCollectionError = null;
  createCollectionCalls = 0;
}

function store(name) {
  if (!docsByCollection[name]) {
    if (strict) {
      const err = new Error('collection not exists');
      err.errCode = -502005;
      err.errMsg = 'collection.get:fail -502005 database collection not exists. [ResourceNotFound] Db or Table not exist: ' + name;
      throw err;
    }
    docsByCollection[name] = new Map();
  }
  return docsByCollection[name];
}

async function createCollection(name) {
  createCollectionCalls++;
  if (createCollectionError) throw createCollectionError;
  if (docsByCollection[name]) {
    const err = new Error('table exist');
    err.errCode = -501001;
    err.errMsg = 'collection.create:fail -501001 resource system error. [ResourceInUse] Table exist: ' + name;
    throw err;
  }
  docsByCollection[name] = new Map();
  return { errMsg: 'collection.create:ok' };
}

function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object' && !(v instanceof RegExp)) {
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = clone(v[k]); });
    return o;
  }
  return v;
}

// ===== 查询 / 更新指令 =====
class Cmd {
  constructor(op, arg) { this.op = op; this.arg = arg; }
  and(other) { return new Cmd('and', [this, other]); }
  or(other) { return new Cmd('or', [this, other]); }
}

const command = {
  gte: (v) => new Cmd('gte', v),
  gt: (v) => new Cmd('gt', v),
  lte: (v) => new Cmd('lte', v),
  lt: (v) => new Cmd('lt', v),
  eq: (v) => new Cmd('eq', v),
  neq: (v) => new Cmd('neq', v),
  in: (v) => new Cmd('in', v),
  push: (v) => new Cmd('push', v),
  inc: (v) => new Cmd('inc', v),
  set: (v) => new Cmd('set', v),
  remove: () => new Cmd('remove'),
  and: (list) => new Cmd('qand', list),
  or: (list) => new Cmd('qor', list),
  aggregate: {}
};

class DbRegExp {
  constructor(o) { this.re = new RegExp(o.regexp, o.options || ''); }
}

class Acc {
  constructor(op, arg) { this.op = op; this.arg = arg; }
}
['sum', 'last', 'first', 'min', 'max', 'addToSet', 'avg'].forEach((op) => {
  command.aggregate[op] = (arg) => new Acc(op, arg);
});

// ===== 匹配 =====
function valuesAt(doc, path) {
  let cur = [doc];
  path.split('.').forEach((seg) => {
    const next = [];
    cur.forEach((v) => {
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x === 'object') next.push(x[seg]); });
      else if (v && typeof v === 'object') next.push(v[seg]);
    });
    cur = next;
  });
  // 叶子是数组时，元素也参与匹配（Mongo 语义）
  const out = [];
  cur.forEach((v) => {
    out.push(v);
    if (Array.isArray(v)) v.forEach((x) => out.push(x));
  });
  return out;
}

function cmp(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchValue(values, cond) {
  if (cond instanceof DbRegExp) return values.some((v) => typeof v === 'string' && cond.re.test(v));
  if (cond instanceof Cmd) {
    switch (cond.op) {
      case 'and': return cond.arg.every((c) => matchValue(values, c));
      case 'or': return cond.arg.some((c) => matchValue(values, c));
      case 'gte': return values.some((v) => v !== undefined && cmp(v, cond.arg) >= 0);
      case 'gt': return values.some((v) => v !== undefined && cmp(v, cond.arg) > 0);
      case 'lte': return values.some((v) => v !== undefined && cmp(v, cond.arg) <= 0);
      case 'lt': return values.some((v) => v !== undefined && cmp(v, cond.arg) < 0);
      case 'eq': return values.some((v) => v === cond.arg);
      case 'neq': return !values.some((v) => v === cond.arg);
      case 'in': return values.some((v) => cond.arg.indexOf(v) >= 0);
      default: throw new Error('unsupported query cmd ' + cond.op);
    }
  }
  return values.some((v) => v === cond || (v instanceof Date && cond instanceof Date && v.getTime() === cond.getTime()));
}

function matches(doc, cond) {
  if (!cond) return true;
  if (cond instanceof Cmd) {
    if (cond.op === 'qand') return cond.arg.every((c) => matches(doc, c));
    if (cond.op === 'qor') return cond.arg.some((c) => matches(doc, c));
    throw new Error('unsupported top-level cmd ' + cond.op);
  }
  return Object.keys(cond).every((k) => matchValue(valuesAt(doc, k), cond[k]));
}

function setPath(obj, path, value) {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k];
    if (v instanceof Cmd && v.op === 'push') {
      const arr = valuesAt(doc, k)[0] || [];
      setPath(doc, k, arr.concat(clone(v.arg)));
    } else if (v instanceof Cmd && v.op === 'inc') {
      setPath(doc, k, (valuesAt(doc, k)[0] || 0) + v.arg);
    } else if (v instanceof Cmd && v.op === 'set') {
      setPath(doc, k, clone(v.arg));
    } else if (v instanceof Cmd && v.op === 'remove') {
      delete doc[k];
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Cmd)) {
      // 与真实云数据库一致：update 传入对象时是“合并”子字段而不是整体替换（整体替换要用 _.set）
      Object.keys(v).forEach((sub) => applyUpdate(doc, { [k + '.' + sub]: v[sub] }));
    } else {
      setPath(doc, k, clone(v));
    }
  });
}

function sortDocs(list, specs) {
  return list.slice().sort((a, b) => {
    for (const [field, dir] of specs) {
      const c = cmp(valuesAt(a, field)[0], valuesAt(b, field)[0]);
      if (c) return dir === 'desc' || dir === -1 ? -c : c;
    }
    return 0;
  });
}

function project(doc, fields) {
  if (!fields) return clone(doc);
  const out = { _id: doc._id };
  Object.keys(fields).forEach((k) => {
    if (fields[k] && doc[k] !== undefined) out[k] = clone(doc[k]);
  });
  return out;
}

// ===== 集合 / 查询 =====
class Query {
  constructor(name, cond) {
    this.name = name;
    this.cond = cond;
    this.fields = null;
    this.orders = [];
    this._skip = 0;
    this._limit = 100;
  }
  where(cond) { const q = this.copy(); q.cond = cond; return q; }
  field(f) { const q = this.copy(); q.fields = f; return q; }
  orderBy(f, d) { const q = this.copy(); q.orders = q.orders.concat([[f, d]]); return q; }
  skip(n) { const q = this.copy(); q._skip = n; return q; }
  limit(n) { const q = this.copy(); q._limit = n; return q; }
  copy() { return Object.assign(Object.create(Query.prototype), this); }
  matched() { return Array.from(store(this.name).values()).filter((d) => matches(d, this.cond)); }
  async get() {
    if (this._limit > 1000) throw new Error('limit must be <= 1000');
    const list = sortDocs(this.matched(), this.orders).slice(this._skip, this._skip + this._limit);
    return { data: list.map((d) => project(d, this.fields)) };
  }
  async count() { return { total: this.matched().length }; }
  async update({ data }) {
    const list = this.matched();
    list.forEach((d) => applyUpdate(d, data));
    return { stats: { updated: list.length } };
  }
  async remove() {
    const list = this.matched();
    list.forEach((d) => store(this.name).delete(d._id));
    return { stats: { removed: list.length } };
  }
}

class Collection extends Query {
  constructor(name) { super(name, null); }
  doc(id) { return new DocRef(this.name, id); }
  async add({ data }) {
    const s = store(this.name);
    const doc = clone(data);
    if (doc._id === undefined) doc._id = 'id' + (++idSeq);
    if (s.has(doc._id)) {
      const err = new Error('duplicate key');
      err.errMsg = 'collection.add:fail -502001 database request fail. [DuplicateWrite] duplicate key';
      throw err;
    }
    s.set(doc._id, doc);
    return { _id: doc._id };
  }
  aggregate() { return new Aggregate(this.name); }
}

class DocRef {
  constructor(name, id) { this.name = name; this.id = id; }
  async get() {
    const d = store(this.name).get(this.id);
    if (!d) {
      const err = new Error('not exist');
      err.errMsg = 'document.get:fail document with _id ' + this.id + ' does not exist';
      throw err;
    }
    return { data: clone(d) };
  }
  async set({ data }) {
    if (data._id !== undefined) throw new Error('set data must not contain _id');
    store(this.name).set(this.id, Object.assign(clone(data), { _id: this.id }));
    return { stats: { updated: 1 } };
  }
  async update({ data }) {
    const d = store(this.name).get(this.id);
    if (!d) throw Object.assign(new Error('not exist'), { errMsg: 'document.update:fail document does not exist' });
    applyUpdate(d, data);
    return { stats: { updated: 1 } };
  }
  async remove() {
    store(this.name).delete(this.id);
    return { stats: { removed: 1 } };
  }
}

function evalExpr(doc, expr) {
  if (typeof expr === 'string' && expr[0] === '$') return valuesAt(doc, expr.slice(1))[0];
  return expr;
}

class Aggregate {
  constructor(name) { this.name = name; this.stages = []; }
  match(c) { this.stages.push(['match', c]); return this; }
  sort(s) { this.stages.push(['sort', s]); return this; }
  group(g) { this.stages.push(['group', g]); return this; }
  skip(n) { this.stages.push(['skip', n]); return this; }
  limit(n) { this.stages.push(['limit', n]); return this; }
  async end() {
    let list = Array.from(store(this.name).values()).map(clone);
    this.stages.forEach(([type, arg]) => {
      if (type === 'match') list = list.filter((d) => matches(d, arg));
      else if (type === 'sort') list = sortDocs(list, Object.keys(arg).map((k) => [k, arg[k]]));
      else if (type === 'skip') list = list.slice(arg);
      else if (type === 'limit') list = list.slice(0, arg);
      else if (type === 'group') {
        const groups = new Map();
        list.forEach((d) => {
          const key = evalExpr(d, arg._id);
          const k = JSON.stringify(key === undefined ? null : key);
          if (!groups.has(k)) groups.set(k, { _id: key === undefined ? null : key, __docs: [] });
          groups.get(k).__docs.push(d);
        });
        list = Array.from(groups.values()).map((g) => {
          const out = { _id: g._id };
          Object.keys(arg).forEach((field) => {
            if (field === '_id') return;
            const acc = arg[field];
            const vals = g.__docs.map((d) => evalExpr(d, acc.arg));
            switch (acc.op) {
              case 'sum': out[field] = vals.reduce((a, v) => a + (Number(v) || 0), 0); break;
              case 'avg': out[field] = vals.reduce((a, v) => a + (Number(v) || 0), 0) / vals.length; break;
              case 'last': out[field] = vals[vals.length - 1]; break;
              case 'first': out[field] = vals[0]; break;
              case 'min': out[field] = vals.reduce((a, v) => (a === undefined || cmp(v, a) < 0 ? v : a), undefined); break;
              case 'max': out[field] = vals.reduce((a, v) => (a === undefined || cmp(v, a) > 0 ? v : a), undefined); break;
              case 'addToSet': out[field] = Array.from(new Set(vals)); break;
              default: throw new Error('unsupported accumulator ' + acc.op);
            }
          });
          return out;
        });
      }
    });
    return { list: list };
  }
}

const db = {
  command: command,
  collection: (name) => new Collection(name),
  createCollection: createCollection,
  RegExp: (o) => new DbRegExp(o),
  serverDate: () => new Date()
};

const fakeSdk = {
  DYNAMIC_CURRENT_ENV: 'dynamic',
  init: () => {},
  database: () => db,
  getWXContext: () => ({ OPENID: openid }),
  downloadFile: async ({ fileID }) => {
    if (!files[fileID]) throw new Error('file not found');
    return { fileContent: files[fileID] };
  },
  deleteFile: async ({ fileList }) => {
    fileList.forEach((f) => { delete files[f]; });
    return { fileList: fileList.map((f) => ({ fileID: f, status: 0 })) };
  },
  getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map((f) => ({ fileID: f, tempFileURL: 'https://tmp.example/' + encodeURIComponent(f) })) }),
  openapi: { ocr: { printedText: async () => ({ items: [] }) } }
};

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return fakeSdk;
    return origLoad.apply(this, arguments);
  };
}

module.exports = {
  install: install,
  reset: reset,
  sdk: fakeSdk,
  setOpenid: (id) => { openid = id; },
  putFile: (fileID, buf) => { files[fileID] = buf; },
  hasFile: (fileID) => !!files[fileID],
  dump: (name) => Array.from(store(name).values()).map(clone),
  setStrict: (v) => { strict = !!v; },
  setCreateCollectionError: (err) => { createCollectionError = err; },
  collectionNames: () => Object.keys(docsByCollection).sort(),
  createCollectionCalls: () => createCollectionCalls
};
