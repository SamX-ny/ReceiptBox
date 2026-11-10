const test = require('node:test');
const assert = require('node:assert/strict');
const fakeDashscope = require('./helpers/fake-dashscope');
const qwen = require('../cloudfunctions/parseReceipt/lib/qwen');

const RESULT = {
  isReceipt: true,
  merchant: { name: 'Coles', branch: 'Burwood', address: '', type: 'supermarket' },
  date: '2026-11-08', time: '10:01', currency: 'AUD',
  subtotal: 4.5, tax: 0.41, discount: null, total: 4.5, paymentMethod: 'Visa', notes: '',
  items: [{ name: 'COKE CLASSIC 2L', productName: 'Coca-Cola Classic', spec: '2L', quantity: 1, unit: 'each', unitPrice: 4.5, totalPrice: 4.5, discount: 0, category: 'beverages' }]
};
const IMG = Buffer.from('fake-jpeg');

let server;
test.before(async () => {
  server = await fakeDashscope.start();
  process.env.DASHSCOPE_BASE_URL = server.baseUrl;
  process.env.DASHSCOPE_API_KEY = 'sk-test';
  delete process.env.RECEIPT_QWEN_MODEL;
  delete process.env.RECEIPT_QWEN_MAX_TOKENS;
});
test.after(async () => {
  delete process.env.DASHSCOPE_BASE_URL;
  delete process.env.DASHSCOPE_API_KEY;
  await server.close();
});

test('Qwen 请求：地址、鉴权、模型、图片与提示词', async () => {
  server.requests.length = 0;
  server.reply = () => fakeDashscope.completion(JSON.stringify(RESULT));
  const out = await qwen.parseReceiptImage(IMG, 'image/jpeg');
  const req = server.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/compatible-mode/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer sk-test');
  assert.equal(req.body.model, 'qwen-vl-ocr');
  assert.equal(req.body.max_tokens, undefined);
  // Qwen-OCR 不接受自定义 system 消息：只发一条 user 消息
  assert.deepEqual(req.body.messages.map((m) => m.role), ['user']);
  const [image, text] = req.body.messages[0].content;
  assert.equal(image.type, 'image_url');
  assert.equal(image.image_url.url, 'data:image/jpeg;base64,' + IMG.toString('base64'));
  assert.match(text.text, /"items":\[/);
  assert.match(text.text, /beverages（饮料酒水）/);
  // items 必须是输出格式里的最后一个字段
  assert.ok(text.text.indexOf('"items":[') > text.text.indexOf('"notes":""'));
  assert.deepEqual(out.data, RESULT);
  assert.equal(out.truncated, false);
  assert.equal(out.usage.total_tokens, 3800);
});

test('默认地址为北京地域；模型与输出上限可配置', () => {
  assert.equal(qwen.DEFAULT_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  process.env.RECEIPT_QWEN_MODEL = 'qwen-vl-ocr-latest';
  process.env.RECEIPT_QWEN_MAX_TOKENS = '8192';
  try {
    const body = qwen.buildRequest('abc', 'image/png');
    assert.equal(body.model, 'qwen-vl-ocr-latest');
    assert.equal(body.max_tokens, 8192);
  } finally {
    delete process.env.RECEIPT_QWEN_MODEL;
    delete process.env.RECEIPT_QWEN_MAX_TOKENS;
  }
});

test('容忍 Markdown 代码块和前后多余文字', async () => {
  server.reply = () => fakeDashscope.completion('好的，结果如下：\n```json\n' + JSON.stringify(RESULT, null, 2) + '\n```\n请核对。');
  const out = await qwen.parseReceiptImage(IMG, 'image/jpeg');
  assert.equal(out.data.merchant.name, 'Coles');
  assert.equal(out.truncated, false);
});

test('输出被截断时保留已完整输出的商品并提示', async () => {
  const many = Object.assign({}, RESULT, {
    items: [1, 2, 3].map((i) => Object.assign({}, RESULT.items[0], { name: 'ITEM "' + i + '" {x}', totalPrice: i }))
  });
  const full = JSON.stringify(many);
  // 在第 3 个商品中间截断
  const cut = full.slice(0, full.lastIndexOf('"name"') + 20);
  server.reply = () => {
    const r = fakeDashscope.completion(cut);
    r.body.choices[0].finish_reason = 'length';
    return r;
  };
  const out = await qwen.parseReceiptImage(IMG, 'image/jpeg');
  assert.equal(out.truncated, true);
  assert.deepEqual(out.data.items.map((i) => i.name), ['ITEM "1" {x}', 'ITEM "2" {x}']);
  assert.equal(out.data.total, 4.5);
  assert.match(out.data.notes, /没有识别完整/);
});

test('extractJson：无法修复时返回 null', () => {
  assert.equal(qwen.extractJson('抱歉，我无法识别这张图片'), null);
  assert.equal(qwen.extractJson('{"isReceipt":true,"merchant":{"name":"Co'), null);
  assert.equal(qwen.extractJson(''), null);
});

test('错误处理：鉴权、限流、服务错误、无法解析、空结果', async () => {
  const cases = [
    [() => ({ status: 401, body: { error: { code: 'invalid_api_key', message: 'Incorrect API key provided.' } } }), 'AUTH'],
    [() => ({ status: 429, body: { error: { code: 'limit_requests', message: 'Too many requests' } } }), 'RATE_LIMIT'],
    [() => ({ status: 400, body: { error: { code: 'data_inspection_failed', message: 'Input data may contain inappropriate content.' } } }), 'REFUSED'],
    [() => ({ status: 500, body: 'upstream error' }), 'API_ERROR'],
    [() => fakeDashscope.completion('这不是 JSON'), 'BAD_OUTPUT'],
    [() => fakeDashscope.completion(JSON.stringify(Object.assign({}, RESULT, { items: [], total: null }))), 'EMPTY']
  ];
  for (const [reply, code] of cases) {
    server.reply = reply;
    await assert.rejects(qwen.parseReceiptImage(IMG, 'image/jpeg'), (e) => e.code === code, code);
  }
});

test('超时与连接失败', async () => {
  server.reply = () => Object.assign(fakeDashscope.completion(JSON.stringify(RESULT)), { delayMs: 400 });
  await assert.rejects(qwen.parseReceiptImage(IMG, 'image/jpeg', { timeoutMs: 80 }), (e) => e.code === 'TIMEOUT');
  const saved = process.env.DASHSCOPE_BASE_URL;
  process.env.DASHSCOPE_BASE_URL = 'http://127.0.0.1:1/v1';
  try {
    await assert.rejects(qwen.parseReceiptImage(IMG, 'image/jpeg'), (e) => e.code === 'NETWORK');
  } finally {
    process.env.DASHSCOPE_BASE_URL = saved;
  }
});

test('未配置 Key', async () => {
  const saved = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  try {
    await assert.rejects(qwen.parseReceiptImage(IMG, 'image/jpeg'), (e) => e.code === 'CONFIG');
  } finally {
    process.env.DASHSCOPE_API_KEY = saved;
  }
});
