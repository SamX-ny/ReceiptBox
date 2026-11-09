/**
 * 云函数 parseReceipt：识别小票照片，返回待用户确认的小票草稿（不写库）。
 *
 * 入参：{ fileID: 'cloud://...' }
 * 返回：{ ok: true, draft, warnings, engine } 或 { ok: false, code, message }
 *
 * 识别引擎：
 *   - 配置了 ANTHROPIC_API_KEY：使用 Claude 视觉模型（推荐，准确度高，能规范化商品名用于比价）
 *   - 否则：使用微信 OCR 通用印刷体识别 + 规则解析（需在小程序后台开通 OCR 服务）
 */

const cloud = require('wx-server-sdk');
const receiptLib = require('./shared/receipt');
const ocrParser = require('./lib/ocrParser');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude 单张图片上限 5MB

function detectMediaType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}

async function recognizeWithClaude(buffer, mediaType) {
  const claude = require('./lib/claude');
  const result = await claude.parseReceiptImage(buffer, mediaType);
  console.log('claude usage', result.model, JSON.stringify(result.usage));
  return { data: result.data, engine: 'claude' };
}

async function recognizeWithWechatOcr(buffer, mediaType) {
  const res = await cloud.openapi.ocr.printedText({
    type: 'photo',
    img: { contentType: mediaType, value: buffer }
  });
  const lines = (res.items || []).map(function (it) { return it.text; });
  return { data: ocrParser.parseLines(lines), engine: 'wechat-ocr' };
}

exports.main = async function (event) {
  const fileID = event && event.fileID;
  if (!fileID || typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: '缺少小票图片' };
  }

  let buffer;
  try {
    const file = await cloud.downloadFile({ fileID: fileID });
    buffer = file.fileContent;
  } catch (err) {
    console.error('download failed', err);
    return { ok: false, code: 'DOWNLOAD_FAILED', message: '读取图片失败，请重新上传' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', message: '图片超过 5MB，请压缩后再试' };
  }
  const mediaType = detectMediaType(buffer);
  if (!mediaType) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE', message: '仅支持 JPG / PNG / WEBP 图片' };
  }

  let recognized;
  try {
    recognized = process.env.ANTHROPIC_API_KEY
      ? await recognizeWithClaude(buffer, mediaType)
      : await recognizeWithWechatOcr(buffer, mediaType);
  } catch (err) {
    console.error('recognize failed', err);
    return { ok: false, code: err.code || 'RECOGNIZE_FAILED', message: err.code && err.message ? err.message : '识别失败，请重试或手动录入' };
  }

  const data = recognized.data || {};
  if (data.isReceipt === false) {
    return { ok: false, code: 'NOT_RECEIPT', message: '这张图片看起来不是小票，请重新拍摄' };
  }

  const sanitized = receiptLib.sanitizeReceipt(Object.assign({}, data, {
    imageFileID: fileID,
    source: recognized.engine
  }), { defaultDate: event.today });

  const warnings = sanitized.warnings.slice();
  if (data.notes) warnings.push(String(data.notes).slice(0, 200));

  return {
    ok: true,
    engine: recognized.engine,
    draft: sanitized.receipt,
    warnings: warnings
  };
};

// 便于单元测试
exports._internal = { detectMediaType: detectMediaType };
