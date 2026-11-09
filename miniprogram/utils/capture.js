/**
 * 拍照 / 从相册选择小票，然后进入识别页。
 */
function captureReceipt(source) {
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: [source === 'album' ? 'album' : 'camera'],
    sizeType: ['compressed'],
    camera: 'back',
    success(res) {
      const file = res.tempFiles && res.tempFiles[0];
      if (!file) return;
      wx.navigateTo({ url: '/pages/scan/index?path=' + encodeURIComponent(file.tempFilePath) });
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
