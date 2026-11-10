/**
 * 默认识别引擎：阿里云百炼 通义千问 Qwen-VL-OCR（多模态 OCR 大模型）。
 * 通过 OpenAI 兼容接口调用，把小票照片直接解析为结构化 JSON。
 *
 * 环境变量（云开发控制台 → 云函数 → parseReceipt → 函数配置）：
 *   DASHSCOPE_API_KEY        必填，百炼 API Key
 *   DASHSCOPE_BASE_URL       可选，默认北京地域 https://dashscope.aliyuncs.com/compatible-mode/v1
 *   RECEIPT_QWEN_MODEL       可选，默认 qwen-vl-ocr
 *   RECEIPT_QWEN_MAX_TOKENS  可选，输出上限；不设置时使用模型默认值（4096）
 *
 * 注意：
 * - Qwen-OCR 使用固定的内置 System Message，所有指令必须放在 user 消息里。
 * - 输出上限默认 4096 token，所以提示词要求 items 放在 JSON 最后；
 *   超长小票被截断时，保留已完整输出的商品并提示用户核对。
 */

const http = require('./http');
const prompt = require('./prompt');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-vl-ocr';
// 云函数最长 60 秒：给模型 40 秒，留出失败后改用微信 OCR 的时间
const DEFAULT_TIMEOUT_MS = 40 * 1000;

class ReceiptParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function buildRequest(imageBase64, mediaType) {
  const body = {
    model: process.env.RECEIPT_QWEN_MODEL || DEFAULT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + imageBase64 } },
        { type: 'text', text: prompt.QWEN_PROMPT }
      ]
    }]
  };
  const maxTokens = parseInt(process.env.RECEIPT_QWEN_MAX_TOKENS, 10);
  if (maxTokens > 0) body.max_tokens = maxTokens;
  return body;
}

/**
 * 输出被截断时的补救：保留 items 数组里已经完整输出的商品，补上结尾。
 * 依赖提示词约定：根对象里唯一的数组是 items，且位于最后。
 * 返回修复后的 JSON 字符串；无法修复时返回 null。
 */
function repairTruncated(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastItemEnd = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      // 根对象(1) → items 数组(2) → 商品对象(3)：商品对象闭合后回到深度 2
      if (ch === '}' && depth === 2) lastItemEnd = i;
    }
  }
  return lastItemEnd < 0 ? null : text.slice(0, lastItemEnd + 1) + ']}';
}

/** 从模型输出中取出 JSON：容忍 ```json 代码块、前后多余文字、输出被截断 */
function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end > start) {
    try {
      return { data: JSON.parse(cleaned.slice(start, end + 1)), truncated: false };
    } catch (e) {
      // 继续尝试按截断修复
    }
  }
  const repaired = repairTruncated(cleaned.slice(start));
  if (!repaired) return null;
  try {
    return { data: JSON.parse(repaired), truncated: true };
  } catch (e) {
    return null;
  }
}

function messageText(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(function (p) { return (p && p.text) || ''; }).join('');
  return '';
}

function apiError(status, body) {
  const detail = (body && body.error) || body || {};
  const code = String(detail.code || '');
  if (status === 401 || status === 403 || /InvalidApiKey|invalid_api_key/i.test(code)) {
    return new ReceiptParseError('AUTH', '通义千问 API Key 无效或没有权限，请检查云函数环境变量 DASHSCOPE_API_KEY');
  }
  if (status === 429 || /Throttling|limit/i.test(code)) {
    return new ReceiptParseError('RATE_LIMIT', '通义千问识别服务繁忙或额度不足');
  }
  if (/inspection/i.test(code)) {
    return new ReceiptParseError('REFUSED', '图片未通过通义千问的内容安全检查');
  }
  return new ReceiptParseError('API_ERROR', '通义千问识别服务出错（' + status + (code ? ' ' + code : '') + '）');
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} mediaType image/jpeg | image/png | image/webp
 * @param {Object} [options] { timeoutMs }
 * @returns {Promise<{ data: Object, model: string, usage: Object, truncated: boolean }>}
 */
async function parseReceiptImage(imageBuffer, mediaType, options) {
  options = options || {};
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new ReceiptParseError('CONFIG', '未配置 DASHSCOPE_API_KEY');
  const base = String(process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

  let res;
  try {
    res = await http.postJson(
      base + '/chat/completions',
      { Authorization: 'Bearer ' + apiKey },
      buildRequest(imageBuffer.toString('base64'), mediaType),
      options.timeoutMs || DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    if (err.code === 'TIMEOUT') throw new ReceiptParseError('TIMEOUT', '通义千问识别超时');
    if (err.code === 'CONFIG') throw new ReceiptParseError('CONFIG', 'DASHSCOPE_BASE_URL 配置无效');
    throw new ReceiptParseError('NETWORK', '无法连接通义千问识别服务');
  }
  if (res.status < 200 || res.status >= 300) throw apiError(res.status, res.body);

  const choice = res.body && res.body.choices && res.body.choices[0];
  const parsed = extractJson(messageText(choice && choice.message));
  if (!parsed || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new ReceiptParseError('BAD_OUTPUT', '通义千问返回的结果无法解析');
  }
  const data = parsed.data;
  const truncated = parsed.truncated || (choice && choice.finish_reason === 'length');
  const hasContent = (Array.isArray(data.items) && data.items.length > 0) || Number(data.total) > 0;
  if (data.isReceipt !== false && !hasContent) {
    throw new ReceiptParseError('EMPTY', '通义千问没有识别出商品或金额');
  }
  if (truncated) {
    data.notes = '小票较长，后面的商品可能没有识别完整，请核对并补全' + (data.notes ? '；' + data.notes : '');
  }
  return { data: data, model: res.body.model || '', usage: res.body.usage || {}, truncated: !!truncated };
}

module.exports = {
  parseReceiptImage: parseReceiptImage,
  buildRequest: buildRequest,
  extractJson: extractJson,
  ReceiptParseError: ReceiptParseError,
  DEFAULT_MODEL: DEFAULT_MODEL,
  DEFAULT_BASE_URL: DEFAULT_BASE_URL
};
