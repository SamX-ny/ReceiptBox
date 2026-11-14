/**
 * 云函数 api：Receipt Box 的业务接口路由。
 *
 * 小程序端调用：wx.cloud.callFunction({ name: 'api', data: { action: 'receipt.list', params: {...} } })
 * 返回：{ ok: true, data } 或 { ok: false, code, message }
 *
 * 所有数据按“家庭”隔离：从 OPENID 找到用户所属家庭，只能读写该家庭的数据。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { AppError, COLLECTIONS, ensureCollections, isCollectionMissing } = require('./lib/db');
const user = require('./lib/user');

const ACTIONS = Object.assign(
  {},
  user.actions,
  require('./lib/receipts').actions,
  require('./lib/scans').actions,
  require('./lib/stats').actions,
  require('./lib/products').actions
);

exports.main = async function (event) {
  const action = event && event.action;
  const handler = ACTIONS[action];
  if (!handler) return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作：' + action };

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, code: 'UNAUTHENTICATED', message: '请在小程序内使用' };

  try {
    await ensureCollections();
    const session = await user.ensureUser(openid);
    const ctx = { openid: openid, user: session.user, family: session.family };
    const data = await handler(ctx, event.params || {});
    return { ok: true, data: data };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    console.error('api error', action, err);
    if (isCollectionMissing(err)) {
      return {
        ok: false,
        code: 'DB_NOT_READY',
        message: '数据库集合未能自动创建，请在云开发控制台手动创建：' + COLLECTIONS.join('、')
      };
    }
    return { ok: false, code: 'INTERNAL', message: '服务器开小差了，请稍后再试' };
  }
};
