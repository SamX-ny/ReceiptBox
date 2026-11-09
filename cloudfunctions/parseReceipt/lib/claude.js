/**
 * 可选识别引擎：调用 Claude（视觉 + 结构化输出）把小票照片解析为结构化 JSON。
 *
 * 环境变量（在云开发控制台 → 云函数 → parseReceipt → 函数配置 中设置）：
 *   RECEIPT_ENGINE      设为 claude 才会启用（默认使用微信 OCR）
 *   ANTHROPIC_API_KEY   必填，Claude API Key
 *   ANTHROPIC_BASE_URL  可选，API 网关/代理地址（云函数所在地域无法直连时使用）
 *   RECEIPT_CLAUDE_MODEL  可选，默认 claude-opus-5-5
 *   RECEIPT_CLAUDE_EFFORT 可选，low | medium | high，默认 low（云函数最长 60 秒，见 README）
 */

const Anthropic = require('@anthropic-ai/sdk');
const prompt = require('./prompt');

const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

class ReceiptParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createClient(options) {
  const opts = Object.assign({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // 云函数最长执行 60 秒，预留下载图片与写库的时间
    timeout: 50 * 1000,
    maxRetries: 1
  }, options || {});
  if (process.env.ANTHROPIC_BASE_URL && !opts.baseURL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
  return new Anthropic(opts);
}

function buildRequest(imageBase64, mediaType) {
  const effort = EFFORTS.indexOf(process.env.RECEIPT_CLAUDE_EFFORT) >= 0 ? process.env.RECEIPT_CLAUDE_EFFORT : 'low';
  return {
    model: process.env.RECEIPT_CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    // 安全分类器拒绝时，由服务端按拒绝类别自动切换到推荐的备用模型重试
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: effort,
      format: { type: 'json_schema', schema: prompt.RECEIPT_SCHEMA }
    },
    system: prompt.SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt.USER_PROMPT }
      ]
    }]
  };
}

/**
 * @param {Buffer} imageBuffer 图片内容
 * @param {string} mediaType   image/jpeg | image/png | image/webp | image/gif
 * @param {Object} [clientOptions] 测试时可注入 fetch 等
 * @returns {Promise<{ data: Object, model: string, usage: Object }>}
 */
async function parseReceiptImage(imageBuffer, mediaType, clientOptions) {
  const client = createClient(clientOptions);
  let response;
  try {
    response = await client.beta.messages.create(buildRequest(imageBuffer.toString('base64'), mediaType));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ReceiptParseError('AUTH', 'Claude API Key 无效或无权限，请检查云函数环境变量 ANTHROPIC_API_KEY');
    } else if (err instanceof Anthropic.BadRequestError) {
      throw new ReceiptParseError('BAD_REQUEST', '识别请求无效：' + err.message);
    } else if (err instanceof Anthropic.RateLimitError) {
      throw new ReceiptParseError('RATE_LIMIT', '识别服务繁忙，请稍后再试');
    } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ReceiptParseError('TIMEOUT', '识别超时，请重试或裁剪图片后再试');
    } else if (err instanceof Anthropic.APIConnectionError) {
      throw new ReceiptParseError('NETWORK', '无法连接识别服务，请检查 ANTHROPIC_BASE_URL 或网络');
    } else if (err instanceof Anthropic.APIError) {
      throw new ReceiptParseError('API_ERROR', '识别服务出错（' + err.status + '）');
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new ReceiptParseError('REFUSED', '这张图片无法识别，请换一张小票照片');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ReceiptParseError('TOO_LONG', '小票内容过长，请分段拍摄后再试');
  }

  const text = response.content
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ReceiptParseError('BAD_OUTPUT', '识别结果解析失败，请重试');
  }
  return { data: data, model: response.model, usage: response.usage };
}

module.exports = {
  parseReceiptImage: parseReceiptImage,
  buildRequest: buildRequest,
  ReceiptParseError: ReceiptParseError,
  DEFAULT_MODEL: DEFAULT_MODEL
};
