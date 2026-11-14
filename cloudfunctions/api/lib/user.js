/**
 * 用户与家庭：每个用户首次使用时自动创建一个“我的家庭”，
 * 可以通过 6 位邀请码加入其他家庭，家庭成员共享小票与统计。
 */

const { db, _, AppError, fetchAll, inChunks, isNotFound } = require('./db');

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I

function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)];
  return s;
}

function personalFamilyId(openid) {
  return 'fam_' + openid;
}

async function getDoc(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).get();
    return res.data;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function addIgnoreDuplicate(collection, doc) {
  try {
    await db.collection(collection).add({ data: doc });
  } catch (err) {
    // 并发首次登录时，另一次调用可能已创建；_id 冲突可忽略
    if (!/duplicate|exist/i.test(String(err.errMsg || err.message))) throw err;
  }
}

async function ensurePersonalFamily(openid, nickName) {
  const id = personalFamilyId(openid);
  let family = await getDoc('families', id);
  if (!family) {
    await addIgnoreDuplicate('families', {
      _id: id,
      name: '我的家庭',
      ownerOpenid: openid,
      members: [{ openid: openid, nickName: nickName || '', joinedAt: db.serverDate() }],
      inviteCode: randomCode(),
      createdAt: db.serverDate()
    });
    family = await getDoc('families', id);
  }
  return family;
}

/** 获取（必要时创建）当前用户与其家庭 */
async function ensureUser(openid) {
  let user = await getDoc('users', openid);
  if (!user) {
    await ensurePersonalFamily(openid, '');
    await addIgnoreDuplicate('users', {
      _id: openid,
      familyId: personalFamilyId(openid),
      nickName: '',
      createdAt: db.serverDate()
    });
    user = await getDoc('users', openid);
  }
  let family = await getDoc('families', user.familyId);
  if (!family) {
    // 所在家庭被删除等异常情况，回到个人家庭
    family = await ensurePersonalFamily(openid, user.nickName);
    await db.collection('users').doc(openid).update({ data: { familyId: family._id } });
    user.familyId = family._id;
  }
  return { user: user, family: family };
}

function publicFamily(family, openid) {
  return {
    _id: family._id,
    name: family.name,
    inviteCode: family.inviteCode,
    isOwner: family.ownerOpenid === openid,
    isPersonal: family._id === personalFamilyId(openid),
    members: (family.members || []).map(function (m) {
      return { nickName: m.nickName || '家庭成员', isMe: m.openid === openid, isOwner: m.openid === family.ownerOpenid };
    })
  };
}

async function login(ctx) {
  return {
    openid: ctx.openid,
    user: { nickName: ctx.user.nickName || '' },
    family: publicFamily(ctx.family, ctx.openid)
  };
}

async function updateProfile(ctx, params) {
  const nickName = String(params.nickName || '').trim().slice(0, 20);
  await db.collection('users').doc(ctx.openid).update({ data: { nickName: nickName } });
  const members = (ctx.family.members || []).map(function (m) {
    return m.openid === ctx.openid ? Object.assign({}, m, { nickName: nickName }) : m;
  });
  await db.collection('families').doc(ctx.family._id).update({ data: { members: members } });
  return { nickName: nickName };
}

async function renameFamily(ctx, params) {
  const name = String(params.name || '').trim().slice(0, 20);
  if (!name) throw new AppError('INVALID_ARGUMENT', '请输入家庭名称');
  await db.collection('families').doc(ctx.family._id).update({ data: { name: name } });
  return { name: name };
}

async function resetInviteCode(ctx) {
  if (ctx.family.ownerOpenid !== ctx.openid) throw new AppError('FORBIDDEN', '只有创建者可以重置邀请码');
  const code = randomCode();
  await db.collection('families').doc(ctx.family._id).update({ data: { inviteCode: code } });
  return { inviteCode: code };
}

/** 把当前用户在 fromFamily 中录入的小票迁移到 toFamily */
async function moveMyData(openid, fromFamilyId, toFamilyId) {
  const receipts = await fetchAll(
    db.collection('receipts').where({ familyId: fromFamilyId, createdBy: openid }),
    { field: { _id: true } }
  );
  const ids = receipts.map(function (r) { return r._id; });
  await inChunks(ids, 10, async function (id) {
    await db.collection('receipts').doc(id).update({ data: { familyId: toFamilyId } });
    await db.collection('priceRecords').where({ receiptId: id }).update({ data: { familyId: toFamilyId } });
  });
  return ids.length;
}

async function joinFamily(ctx, params) {
  const code = String(params.inviteCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AppError('INVALID_ARGUMENT', '邀请码为 6 位字母或数字');
  const res = await db.collection('families').where({ inviteCode: code }).limit(1).get();
  const target = res.data[0];
  if (!target) throw new AppError('NOT_FOUND', '邀请码无效');
  if (target._id === ctx.family._id) throw new AppError('ALREADY_MEMBER', '你已经在这个家庭中');

  await db.collection('families').doc(target._id).update({
    data: { members: _.push([{ openid: ctx.openid, nickName: ctx.user.nickName || '', joinedAt: new Date() }]) }
  });
  await leaveCurrent(ctx);
  await db.collection('users').doc(ctx.openid).update({ data: { familyId: target._id } });

  // 从个人家庭加入时，默认把自己之前的小票一起带过去
  let moved = 0;
  if (params.bringData !== false && ctx.family._id === personalFamilyId(ctx.openid)) {
    moved = await moveMyData(ctx.openid, ctx.family._id, target._id);
  }
  const family = await getDoc('families', target._id);
  return { family: publicFamily(family, ctx.openid), movedReceipts: moved };
}

/** 从当前家庭的成员列表中移除自己（个人家庭保留） */
async function leaveCurrent(ctx) {
  if (ctx.family._id === personalFamilyId(ctx.openid)) return;
  const members = (ctx.family.members || []).filter(function (m) { return m.openid !== ctx.openid; });
  const data = { members: members };
  if (ctx.family.ownerOpenid === ctx.openid && members.length) data.ownerOpenid = members[0].openid;
  await db.collection('families').doc(ctx.family._id).update({ data: data });
}

async function leaveFamily(ctx) {
  if (ctx.family._id === personalFamilyId(ctx.openid)) {
    throw new AppError('INVALID_ARGUMENT', '这是你的个人家庭，无需退出');
  }
  await leaveCurrent(ctx);
  const family = await ensurePersonalFamily(ctx.openid, ctx.user.nickName);
  await db.collection('users').doc(ctx.openid).update({ data: { familyId: family._id } });
  return { family: publicFamily(family, ctx.openid) };
}

module.exports = {
  ensureUser: ensureUser,
  actions: {
    'user.login': login,
    'user.updateProfile': updateProfile,
    'family.rename': renameFamily,
    'family.resetInviteCode': resetInviteCode,
    'family.join': joinFamily,
    'family.leave': leaveFamily
  }
};
