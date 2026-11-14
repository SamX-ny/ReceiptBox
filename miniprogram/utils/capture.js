/**
 * 拍照 / 从相册选择小票，交给后台识别（utils/scan.js），不需要停留等待。
 * 相册可以一次选多张。
 */
const scan = require('./scan');

function captureReceipt(source) {
  const fromAlbum = source === 'album';
  wx.chooseMedia({
    count: fromAlbum ? 9 : 1,
    mediaType: ['image'],
    sourceType: [fromAlbum ? 'album' : 'camera'],
    sizeType: ['compressed'],
    camera: 'back',
    success(res) {
      const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
      if (!files.length) return;
      files.forEach((f) => scan.start(f.tempFilePath));
      wx.showToast({ title: '已开始识别，可以先去做别的', icon: 'none', duration: 2500 });
      // 识别进度显示在首页
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current && current.route !== 'pages/index/index') wx.switchTab({ url: '/pages/index/index' });
    },
    fail(err) {
      if (!/cancel/.test(err.errMsg || '')) {
        wx.showToast({ title: '无法打开相机/相册', icon: 'none' });
      }
    }
  });
}

/** 弹出选择：拍照 / 相册 / 手动记账 */
function chooseEntry() {
  wx.showActionSheet({
    itemList: ['拍摄小票', '从相册选择', '手动记一笔'],
    success(res) {
      if (res.tapIndex === 0) captureReceipt('camera');
      else if (res.tapIndex === 1) captureReceipt('album');
      else wx.navigateTo({ url: '/pages/receipt-edit/index?mode=manual' });
    }
  });
}

module.exports = { captureReceipt: captureReceipt, chooseEntry: chooseEntry };
