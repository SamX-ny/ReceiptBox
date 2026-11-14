const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let claude;
try {
  require.resolve('@anthropic-ai/sdk', { paths: [path.join(__dirname, '../cloudfunctions/parseReceipt')] });
  claude = require('../cloudfunctions/parseReceipt/lib/claude');
} catch (e) {
  claude = null;
}
const skip = claude ? false : '先在 cloudfunctions/parseReceipt 下运行 npm install';

function fakeFetch(body, status, capture) {
  return async function (url, init) {
    capture.url = String(url);
    capture.headers = Object.fromEntries(new Headers(init.headers));
    capture.body = JSON.parse(init.body);
    return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } });
  };
}

const RESULT = {
  isReceipt: true,
  merchant: { name: 'Coles', branch: 'Burwood', address: '', type: 'supermarket' },
  date: '2026-11-08', time: '10:01', currency: 'AUD',
  items: [{ name: 'COKE CLASSIC 2L', productName: 'Coca-Cola Classic', brand: 'Coca-Cola', spec: '2L', quantity: 1, unit: 'each', unitPrice: 4.5, totalPrice: 4.5, discount: 0, category: 'beverages' }],
  subtotal: 4.5, tax: 0.41, discount: null, total: 4.5, paymentMethod: 'Visa', notes: ''
};

test('Claude 请求：模型、结构化输出、图片与备用模型', { skip }, async () => {
  const cap = {};
  const out = await claude.parseReceiptImage(Buffer.from('fake-jpeg'), 'image/jpeg', {
    apiKey: 'test-key',
    fetch: fakeFetch({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(RESULT) }],
      stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 }
    }, 200, cap)
  });
  assert.match(cap.url, /\/v1\/messages/);
  assert.equal(cap.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(cap.body.model, 'claude-opus-5-5');
  assert.equal(cap.body.fallbacks, 'default');
  assert.equal(cap.body.output_config.format.type, 'json_schema');
  assert.equal(cap.body.output_config.effort, 'low');
  assert.equal(cap.body.output_config.format.schema.properties.items.items.properties.category.enum.length, 18);
  assert.equal(cap.body.thinking, undefined);
  const content = cap.body.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[0].source.data, Buffer.from('fake-jpeg').toString('base64'));
  assert.deepEqual(out.data, RESULT);
});

test('Claude 拒绝时返回明确错误', { skip }, async () => {
  await assert.rejects(
    claude.parseReceiptImage(Buffer.from('x'), 'image/png', {
      apiKey: 'k',
      fetch: fakeFetch({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }, 200, {})
    }),
    (err) => err.code === 'REFUSED'
  );
});

test('Claude 鉴权失败时返回中文提示', { skip }, async () => {
  await assert.rejects(
    claude.parseReceiptImage(Buffer.from('x'), 'image/png', {
      apiKey: 'bad', maxRetries: 0,
      fetch: fakeFetch({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401, {})
    }),
    (err) => err.code === 'AUTH'
  );
});
