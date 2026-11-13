/**
 * 上传前在手机上压缩小票照片，缩短上传时间。
 *
 * 小票是文字图片，不需要相机原图的分辨率：把最长边缩到 config.maxImageSide（默认 1600 像素）、
 * JPEG 质量降到 config.imageQuality（默认 70），文件通常从几 MB 降到 200～400KB。
 *
 * 步骤：
 *   1. wx.compressImage 按目标宽度 + 质量压缩；
 *   2. 检查结果：个别微信版本会忽略“目标宽度”，尺寸没变小时改用离屏 Canvas 重新缩放；
 *   3. 仍然过大时再降一次质量。
 * 任何一步失败都退回上一步的结果，最差情况是上传原图，不会因为压缩失败而无法上传。
 */

const config = require('../config');

const MAX_BYTES = 1.5 * 1024 * 1024;

function getImageInfo(src) {
  return new Promise((resolve) => {
    wx.getImageInfo({ src: src, success: resolve, fail: () => resolve(null) });
  });
}

function fileSize(path) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: (res) => resolve(res.size),
      fail: () => resolve(0)
    });
  });
}

function compress(src, quality, width) {
  return new Promise((resolve) => {
    const options = {
      src: src,
      quality: quality,
      success: (res) => resolve(res.tempFilePath || src),
      fail: () => resolve(src)
    };
    if (width) options.compressedWidth = width;
    wx.compressImage(options);
  });
}

/** 用离屏 Canvas 缩放并导出 JPEG。不支持或失败时返回 null */
function resizeWithCanvas(src, width, height, quality) {
  return new Promise((resolve) => {
    try {
      if (!wx.createOffscreenCanvas) {
        resolve(null);
        return;
      }
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: width, height: height });
      const image = canvas.createImage();
      image.onload = () => {
        try {
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          wx.canvasToTempFilePath({
            canvas: canvas,
            fileType: 'jpg',
            quality: quality / 100,
            success: (res) => resolve(res.tempFilePath || null),
            fail: () => resolve(null)
          });
        } catch (e) {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = src;
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * @param {string} src 本地临时文件路径
 * @returns {Promise<string>} 压缩后的本地文件路径（失败时为原路径）
 */
async function prepareImage(src) {
  const startedAt = Date.now();
  const target = config.maxImageSide;
  const quality = config.imageQuality;
  const originalSize = await fileSize(src);
  const info = await getImageInfo(src);
  let path = src;
  let method = 'none';

  if (info && info.width > 0 && info.height > 0) {
    const scale = Math.min(1, target / Math.max(info.width, info.height));
    const width = Math.round(info.width * scale);
    const height = Math.round(info.height * scale);
    path = await compress(src, quality, scale < 1 ? width : undefined);
    method = 'compressImage';

    if (scale < 1) {
      // 确认真的缩小了；没缩小说明目标宽度被忽略，改用 Canvas
      const after = await getImageInfo(path);
      const stillLarge = !after || Math.max(after.width, after.height) > target * 1.15;
      // Canvas 不处理照片的旋转信息，只对方向正常的照片使用
      const upright = !info.orientation || info.orientation === 'up';
      if (stillLarge && upright) {
        const resized = await resizeWithCanvas(src, width, height, quality);
        if (resized) {
          path = resized;
          method = 'canvas';
        }
      }
    }
  } else {
    path = await compress(src, quality);
    method = 'compressImage';
  }

  if ((await fileSize(path)) > MAX_BYTES) {
    path = await compress(path, Math.max(40, quality - 25));
    method += '+quality';
  }

  const finalSize = await fileSize(path);
  // 压缩后反而更大（原图已经很小）时用原图
  if (originalSize > 0 && finalSize > originalSize) path = src;
  console.log('image prepared', {
    method: method,
    from: info ? info.width + 'x' + info.height : 'unknown',
    kbBefore: Math.round(originalSize / 1024),
    kbAfter: Math.round(Math.min(finalSize, originalSize || finalSize) / 1024),
    ms: Date.now() - startedAt
  });
  return path;
}

module.exports = { prepareImage: prepareImage };
