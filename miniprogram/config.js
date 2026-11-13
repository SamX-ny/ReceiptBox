/**
 * 部署配置：
 *   envId  云开发环境 ID（微信开发者工具 → 云开发控制台 → 设置 → 环境 ID）
 */
module.exports = {
  envId: 'receiptbox-d6gmnaa3j6de2ac88',
  currency: 'AUD',
  currencySymbol: '$',
  // 上传前在手机上压缩照片：最长边缩到多少像素、JPEG 质量（1-100）。
  // 数值越小上传越快；小票很长、字很小导致识别不清时，可以把 maxImageSide 调回 2000
  maxImageSide: 1600,
  imageQuality: 70
};
