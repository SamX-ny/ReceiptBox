/**
 * 云函数 parseReceipt：识别小票照片，生成待用户确认的小票草稿（不会直接生成小票）。
 *
 * 入参（二选一）：
 *   { jobId }            后台识别：处理 api 云函数 scan.create 创建的任务，结果写回 scanJobs（小程序使用这种）
 *   { fileID, today }    直接识别并返回草稿，不读写数据库
 * 返回：{ ok: true, engine, ... } 或 { ok: false, code, message }
 *
 * 识别引擎（云函数环境变量 RECEIPT_ENGINE，一般不用设置）：
 *   - 未设置：配置了 DASHSCOPE_API_KEY 就用通义千问 Qwen-VL-OCR，否则用微信 OCR
 *   - qwen：通义千问 Qwen-VL-OCR（多模态 OCR 大模型，需 DASHSCOPE_API_KEY）
 *   - claude：Claude 视觉模型（需 ANTHROPIC_API_KEY）
 *   - wechat-ocr：只用微信 OCR 通用印刷体识别 + 规则解析
 *
 * 兜底：qwen / claude 识别失败（超时、额度不足、结果无法解析等）时，自动改用微信 OCR，
 * 并在返回的 warnings 里说明，让用户在确认页仔细核对。
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

async function recognizeWithQwen(buffer, mediaType) {
  const qwen = require('./lib/qwen');
  const result = await qwen.parseReceiptImage(buffer, mediaType);
  console.log('qwen usage', result.model, JSON.stringify(result.usage), result.truncated ? 'truncated' : '');
  return { data: result.data, engine: 'qwen' };
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

const AI_ENGINES = {
  qwen: { run: recognizeWithQwen, keyEnv: 'DASHSCOPE_API_KEY', label: '通义千问' },
  claude: { run: recognizeWithClaude, keyEnv: 'ANTHROPIC_API_KEY', label: 'Claude' }
};

// 云函数最长 60 秒。AI 识别失败后，剩余时间不足以再跑一次微信 OCR 时就不再兜底
const FUNCTION_BUDGET_MS = 58 * 1000;
const OCR_RESERVE_MS = 8 * 1000;

function selectedEngine() {
  const v = String(process.env.RECEIPT_ENGINE || '').trim().toLowerCase();
  if (v === 'qwen' || v === 'claude' || v === 'wechat-ocr') return v;
  return process.env.DASHSCOPE_API_KEY ? 'qwen' : 'wechat-ocr';
}

/**
 * 按所选引擎识别；AI 引擎失败时改用微信 OCR。
 * 返回 { data, engine, fallbackFrom?, fallbackReason? }，全部失败时抛出带 code 的错误。
 */
async function recognize(buffer, mediaType, startedAt) {
  const engine = selectedEngine();
  const ai = AI_ENGINES[engine];
  if (!ai) return recognizeWithWechatOcr(buffer, mediaType);

  if (!process.env[ai.keyEnv]) {
    throw Object.assign(new Error('已选择 ' + ai.label + ' 识别，但未配置 ' + ai.keyEnv), { code: 'CONFIG' });
  }
  let aiError;
  try {
    return await ai.run(buffer, mediaType);
  } catch (err) {
    aiError = err;
    console.error(engine + ' failed, falling back to wechat ocr', err);
  }
  const reason = aiError.code && aiError.message ? aiError.message : ai.label + ' 识别失败';
  if (Date.now() - startedAt > FUNCTION_BUDGET_MS - OCR_RESERVE_MS) {
    throw Object.assign(new Error(reason + '，请重试或手动录入'), { code: aiError.code || 'RECOGNIZE_FAILED' });
  }
  try {
    const result = await recognizeWithWechatOcr(buffer, mediaType);
    return Object.assign(result, { fallbackFrom: engine, fallbackReason: reason });
  } catch (ocrErr) {
    throw Object.assign(new Error(reason + '；改用微信 OCR 也未成功：' + ocrErr.message), { code: ocrErr.code || 'RECOGNIZE_FAILED' });
  }
}

/** 识别一张已上传的图片，返回 { ok, engine, draft, warnings } 或 { ok: false, code, message } */
async function recognizeFile(fileID, today, startedAt) {
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
    recognized = await recognize(buffer, mediaType, startedAt);
  } catch (err) {
    console.error('recognize failed', err);
    return { ok: false, code: err.code || 'RECOGNIZE_FAILED', message: err.code && err.message ? err.message : '识别失败，请重试或手动录入' };
  }

  const data = recognized.data || {};
  const hasContent = (Array.isArray(data.items) && data.items.length > 0) || Number(data.total) > 0;
  if (data.isReceipt === false && !hasContent) {
    return { ok: false, code: 'NOT_RECEIPT', message: '这张图片看起来不是小票，请重新拍摄' };
  }

  const sanitized = receiptLib.sanitizeReceipt(Object.assign({}, data, {
    imageFileID: fileID,
    source: recognized.engine
  }), { defaultDate: today });

  const warnings = [];
  if (recognized.fallbackFrom) {
    warnings.push('AI 识别未成功（' + recognized.fallbackReason + '），已改用微信 OCR，请仔细核对');
  }
  sanitized.warnings.forEach(function (w) { warnings.push(w); });
  if (data.notes) warnings.push(String(data.notes).slice(0, 200));

  return {
    ok: true,
    engine: recognized.engine,
    draft: sanitized.receipt,
    warnings: warnings
  };
}

/**
 * 后台识别：处理 api 云函数创建的识别任务（scanJobs），把结果写回任务。
 * 小程序调用后不必等待；用户离开页面甚至关闭小程序，云函数仍会运行到结束。
 */
async function runJob(jobId, startedAt) {
  const db = cloud.database();
  const openid = cloud.getWXContext().OPENID;
  let job = null;
  try {
    job = (await db.collection('scanJobs').doc(String(jobId)).get()).data;
  } catch (err) {
    console.error('load scan job failed', err);
  }
  if (!job || job.createdBy !== openid) {
    return { ok: false, code: 'NOT_FOUND', message: '识别任务不存在或已处理' };
  }

  const result = await recognizeFile(job.imageFileID, job.today, startedAt);
  const _ = db.command;
  const data = result.ok
    ? { status: 'ready', draft: _.set(result.draft), warnings: _.set(result.warnings), engine: result.engine, errorCode: '', errorMessage: '' }
    : { status: 'failed', errorCode: result.code || 'RECOGNIZE_FAILED', errorMessage: result.message || '识别失败' };
  data.updatedAt = db.serverDate();
  try {
    await db.collection('scanJobs').doc(job._id).update({ data: data });
  } catch (err) {
    // 任务可能已被用户删除
    console.error('save scan job failed', err);
    return { ok: false, code: 'SAVE_FAILED', jobId: job._id, message: '识别结果保存失败，请重试' };
  }
  // 草稿已写入任务，不必再回传给小程序
  return result.ok
    ? { ok: true, jobId: job._id, engine: result.engine }
    : { ok: false, jobId: job._id, code: result.code, message: result.message };
}

exports.main = async function (event) {
  const startedAt = Date.now();
  if (event && event.jobId) return runJob(event.jobId, startedAt);
  return recognizeFile(event && event.fileID, event && event.today, startedAt);
};

// 便于单元测试
exports._internal = { detectMediaType: detectMediaType, selectedEngine: selectedEngine };
