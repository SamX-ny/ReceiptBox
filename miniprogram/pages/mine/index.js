/**
 * 我的：家庭共享（邀请码加入、成员）、昵称、分类说明。
 * 分享卡片带邀请码，好友打开后可一键加入家庭。
 */
const app = getApp();
const api = require('../../utils/api');
const categories = require('../../shared/categories');
const format = require('../../utils/format');

Page({
  data: {
    family: null,
    nickName: '',
    categories: categories.CATEGORIES.map((c) => ({ id: c.id, icon: c.icon, name: c.name, tint: format.tint(c.color) })),
    pendingInvite: ''
  },

  onLoad(q) {
    if (q.invite) this.setData({ pendingInvite: String(q.invite).toUpperCase() });
  },

  async onShow() {
    if (app.ready) await app.ready;
    const data = await app.login();
    if (data) this.setData({ family: data.family, nickName: data.user.nickName });
    if (this.data.pendingInvite) {
      const code = this.data.pendingInvite;
      this.setData({ pendingInvite: '' });
      if (!this.data.family || this.data.family.inviteCode !== code) this.confirmJoin(code);
    }
  },

  onCopyCode() {
    wx.setClipboardData({ data: this.data.family.inviteCode });
  },

  onNickName() {
    wx.showModal({
      title: '我的昵称',
      editable: true,
      placeholderText: '家庭成员看到的名字',
      content: this.data.nickName,
      success: async (res) => {
        if (!res.confirm) return;
        const r = await api.call('user.updateProfile', { nickName: res.content || '' }, { loading: '保存中' });
        this.setData({ nickName: r.nickName });
        this.onShow();
      }
    });
  },

  onRenameFamily() {
    wx.showModal({
      title: '家庭名称',
      editable: true,
      content: this.data.family.name,
      success: async (res) => {
        if (!res.confirm || !(res.content || '').trim()) return;
        await api.call('family.rename', { name: res.content }, { loading: '保存中' });
        this.onShow();
      }
    });
  },

  onJoin() {
    wx.showModal({
      title: '加入家庭',
      editable: true,
      placeholderText: '输入 6 位邀请码',
      success: (res) => {
        if (res.confirm && res.content) this.confirmJoin(res.content.trim().toUpperCase());
      }
    });
  },

  confirmJoin(code) {
    wx.showModal({
      title: '加入家庭',
      content: '加入邀请码为 ' + code + ' 的家庭后，你会和家人共享小票、统计和比价数据。你在个人账本里的小票会一起带过去。',
      confirmText: '加入',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const r = await api.call('family.join', { inviteCode: code }, { loading: '加入中' });
          app.globalData.family = r.family;
          app.markDirty();
          this.setData({ family: r.family });
          wx.showToast({ title: '已加入' + r.family.name, icon: 'none' });
        } catch (e) {}
      }
    });
  },

  onLeave() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后将回到你的个人账本，你在这个家庭里记录的小票会留给家人。',
      confirmText: '退出',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await api.call('family.leave', {}, { loading: '处理中' });
        app.globalData.family = r.family;
        app.markDirty();
        this.setData({ family: r.family });
      }
    });
  },

  async onResetCode() {
    const r = await api.call('family.resetInviteCode', {}, { loading: '重置中' });
    this.setData({ 'family.inviteCode': r.inviteCode });
  },

  onShareAppMessage() {
    const f = this.data.family;
    if (!f) return { title: 'Receipt Box 收据箱', path: '/pages/index/index' };
    return {
      title: '邀请你加入「' + f.name + '」，一起记录家庭开销',
      path: '/pages/mine/index?invite=' + f.inviteCode
    };
  }
});
