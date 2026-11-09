/**
 * 云函数 parseReceipt：识别小票照片，返回待用户确认的小票草稿（不写库）。
 *
 * 入参：{ fileID: 'cloud://...' }
 * 返回：{ ok: true, draft, warnings, engine } 或 { ok: false, code, message }
 *
 * 识别引擎（云函数环境变量 RECEIPT_ENGINE）：
 *   - 未设置或 wechat-ocr（默认）：微信 OCR 通用印刷体识别 + 规则解析（需在微信服务市场开通 OCR 服务）
 *   - claude：Claude 视觉模型，能规范化商品名、跨商店比价更准（需同时配置 ANTHROPIC_API_KEY）
 */

const cloud = require('wx-server-sdk');
const receiptLib = require('./shared/receipt');
const ocrParser = require('./lib/ocrParser');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 上限 5MB（小程序端会先压缩到 2MB 以内）

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
  let res;
  try {
    res = await cloud.openapi.ocr.printedText({
      type: 'photo',
      img: { contentType: mediaType, value: buffer }
    });
  } catch (err) {
    console.error('wechat ocr failed', err);
    const e = new Error('微信 OCR 调用失败' + (err.errCode ? '（错误码 ' + err.errCode + '）' : '') + '，请确认已在微信服务市场开通 OCR 服务，或换一张更清晰的照片');
    e.code = 'OCR_FAILED';
    throw e;
  }
  // 按坐标把同一行的文字块（如左侧商品名、右侧价格）合并成一行再解析
  const lines = ocrParser.linesFromOcrItems(res.items || []);
  if (!lines.length) {
    const e = new Error('没有识别到文字，请对准小票、保持光线充足后重拍');
    e.code = 'NO_TEXT';
    throw e;
  }
  return { data: ocrParser.parseLines(lines), engine: 'wechat-ocr' };
}

function selectedEngine() {
  return String(process.env.RECEIPT_ENGINE || '').trim().toLowerCase() === 'claude' ? 'claude' : 'wechat-ocr';
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
    if (selectedEngine() === 'claude') {
      if (!process.env.ANTHROPIC_API_KEY) {
        return { ok: false, code: 'CONFIG', message: '已选择 Claude 识别，但未配置 ANTHROPIC_API_KEY' };
      }
      recognized = await recognizeWithClaude(buffer, mediaType);
    } else {
      recognized = await recognizeWithWechatOcr(buffer, mediaType);
    }
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
exports._internal = { detectMediaType: detectMediaType, selectedEngine: selectedEngine };
