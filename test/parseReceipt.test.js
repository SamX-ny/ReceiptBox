const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-cloud');

const fakeDashscope = require('./helpers/fake-dashscope');

fake.install();
const fn = require('../cloudfunctions/parseReceipt/index');

delete process.env.DASHSCOPE_API_KEY;
delete process.env.RECEIPT_ENGINE;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

test('默认使用微信 OCR（即使配置了 Claude Key）', async () => {
  delete process.env.RECEIPT_ENGINE;
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-used';
  fake.reset();
  fake.putFile('cloud://env/r.jpg', JPEG);
  fake.sdk.openapi.ocr.printedText = async ({ img }) => {
    assert.equal(img.contentType, 'image/jpeg');
    return { items: ['Coles', '03/11/2026 10:01', 'COKE CLASSIC 2L   4.50', 'TOTAL   4.50'].map((text) => ({ text })) };
  };
  const res = await fn.main({ fileID: 'cloud://env/r.jpg', today: '2026-11-09' });
  assert.equal(res.ok, true);
  assert.equal(res.engine, 'wechat-ocr');
  assert.equal(res.draft.merchant.name, 'Coles');
  assert.equal(res.draft.date, '2026-11-03');
  assert.equal(res.draft.total, 4.5);
  assert.equal(res.draft.items[0].productKey, 'coke-classic|2l');
  assert.equal(res.draft.imageFileID, 'cloud://env/r.jpg');
  assert.equal(res.draft.source, 'wechat-ocr');
  delete process.env.ANTHROPIC_API_KEY;
});

test('OCR 文字块按坐标合并成行：左侧商品名与右侧价格配对', async () => {
  fake.reset();
  fake.putFile('cloud://env/r.jpg', JPEG);
  const box = (text, x, y, w) => ({ text, pos: { left_top: { x, y }, right_top: { x: x + w, y: y + 1 }, right_bottom: { x: x + w, y: y + 21 }, left_bottom: { x, y: y + 20 } } });
  fake.sdk.openapi.ocr.printedText = async () => ({
    items: [
      // 故意打乱顺序，并让价格块单独成块、略有倾斜
      box('$4.00', 300, 102, 50),
      box('Woolworths', 100, 10, 150),
      box('COCA-COLA CLASSIC 2L', 20, 100, 200),
      box('08/11/2026 18:32', 20, 50, 160),
      box('TIM TAM ORIGINAL 200G', 20, 130, 210),
      box('5.50', 310, 128, 40),
      box('TOTAL', 20, 170, 60),
      box('$9.50', 300, 171, 50)
    ]
  });
  const res = await fn.main({ fileID: 'cloud://env/r.jpg' });
  assert.equal(res.ok, true);
  assert.equal(res.draft.merchant.name, 'Woolworths');
  assert.equal(res.draft.date, '2026-11-08');
  assert.deepEqual(res.draft.items.map((i) => [i.name, i.totalPrice]), [['COCA-COLA CLASSIC 2L', 4], ['TIM TAM ORIGINAL 200G', 5.5]]);
  assert.equal(res.draft.total, 9.5);
});

test('OCR 失败与无文字时给出提示', async () => {
  fake.reset();
  fake.putFile('cloud://env/r.jpg', JPEG);
  fake.sdk.openapi.ocr.printedText = async () => ({ items: [] });
  assert.equal((await fn.main({ fileID: 'cloud://env/r.jpg' })).code, 'NO_TEXT');
  fake.sdk.openapi.ocr.printedText = async () => { throw Object.assign(new Error('x'), { errCode: -604101 }); };
  const res = await fn.main({ fileID: 'cloud://env/r.jpg' });
  assert.equal(res.code, 'OCR_FAILED');
  assert.match(res.message, /-604101/);
});

test('RECEIPT_ENGINE=claude 但未配置 Key 时提示', async () => {
  fake.reset();
  fake.putFile('cloud://env/r.jpg', JPEG);
  process.env.RECEIPT_ENGINE = 'claude';
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(fn._internal.selectedEngine(), 'claude');
    assert.equal((await fn.main({ fileID: 'cloud://env/r.jpg' })).code, 'CONFIG');
  } finally {
    delete process.env.RECEIPT_ENGINE;
  }
  assert.equal(fn._internal.selectedEngine(), 'wechat-ocr');
});

test('输入校验', async () => {
  fake.reset();
  assert.equal((await fn.main({})).code, 'INVALID_ARGUMENT');
  assert.equal((await fn.main({ fileID: 'cloud://missing' })).code, 'DOWNLOAD_FAILED');
  fake.putFile('cloud://env/t.txt', Buffer.from('hello world'));
  assert.equal((await fn.main({ fileID: 'cloud://env/t.txt' })).code, 'UNSUPPORTED_IMAGE');
  fake.putFile('cloud://env/big.jpg', Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]));
  assert.equal((await fn.main({ fileID: 'cloud://env/big.jpg' })).code, 'IMAGE_TOO_LARGE');
});

test('图片类型识别', () => {
  const { detectMediaType } = fn._internal;
  assert.equal(detectMediaType(JPEG), 'image/jpeg');
  assert.equal(detectMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(detectMediaType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(detectMediaType(Buffer.from('nope')), null);
});

// ===== 通义千问为主、微信 OCR 兜底 =====

const QWEN_RESULT = {
  isReceipt: true,
  merchant: { name: 'Coles', branch: 'Burwood', address: '', type: 'supermarket' },
  date: '2026-11-08', time: '10:01', currency: 'AUD',
  subtotal: 9.2, tax: 0.84, discount: null, total: 9.2, paymentMethod: 'Visa', notes: '',
  items: [
    { name: 'COKE CLASSIC 2L', productName: 'Coca-Cola Classic', spec: '2L', quantity: 1, unit: 'each', unitPrice: 4.5, totalPrice: 4.5, discount: 0, category: 'beverages' },
    // 分类不合法、缺少字段时由 sanitizeReceipt 兜底
    { name: 'TIM TAM ORIG 200G', productName: 'Tim Tam Original', spec: '200g', quantity: 1, unit: 'each', unitPrice: 5.5, totalPrice: 4.7, discount: 0.8, category: '零食' }
  ]
};
const OCR_ITEMS = { items: ['Coles', '08/11/2026 10:01', 'COKE CLASSIC 2L   4.50', 'TOTAL   4.50'].map((text) => ({ text })) };

async function withQwen(run) {
  const server = await fakeDashscope.start();
  process.env.DASHSCOPE_BASE_URL = server.baseUrl;
  process.env.DASHSCOPE_API_KEY = 'sk-test';
  fake.reset();
  fake.putFile('cloud://env/r.jpg', JPEG);
  let ocrCalls = 0;
  fake.sdk.openapi.ocr.printedText = async () => { ocrCalls++; return OCR_ITEMS; };
  try {
    await run(server, () => ocrCalls);
  } finally {
    delete process.env.DASHSCOPE_BASE_URL;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.RECEIPT_ENGINE;
    await server.close();
  }
}

test('配置了 DASHSCOPE_API_KEY 时默认用通义千问，成功则不调用微信 OCR', async () => {
  await withQwen(async (server, ocrCalls) => {
    assert.equal(fn._internal.selectedEngine(), 'qwen');
    server.reply = () => fakeDashscope.completion(JSON.stringify(QWEN_RESULT));
    const res = await fn.main({ fileID: 'cloud://env/r.jpg', today: '2026-11-09' });
    assert.equal(res.ok, true);
    assert.equal(res.engine, 'qwen');
    assert.equal(res.draft.source, 'qwen');
    assert.equal(res.draft.merchant.branch, 'Burwood');
    assert.equal(res.draft.items[0].productKey, 'coca-cola-classic|2l');
    assert.equal(res.draft.items[1].category, 'snacks');
    assert.equal(res.draft.items[1].discount, 0.8);
    assert.equal(res.draft.total, 9.2);
    assert.deepEqual(res.warnings, []);
    assert.equal(ocrCalls(), 0);
    assert.equal(server.requests.length, 1);
  });
});

test('通义千问失败时改用微信 OCR，并在提示里说明', async () => {
  await withQwen(async (server, ocrCalls) => {
    server.reply = () => ({ status: 429, body: { error: { code: 'limit_requests', message: 'Too many requests' } } });
    const res = await fn.main({ fileID: 'cloud://env/r.jpg', today: '2026-11-09' });
    assert.equal(res.ok, true);
    assert.equal(res.engine, 'wechat-ocr');
    assert.equal(res.draft.source, 'wechat-ocr');
    assert.equal(res.draft.total, 4.5);
    assert.match(res.warnings[0], /AI 识别未成功（通义千问识别服务繁忙或额度不足），已改用微信 OCR/);
    assert.equal(ocrCalls(), 1);

    // 返回内容无法解析时同样兜底
    server.reply = () => fakeDashscope.completion('抱歉，无法识别');
    const res2 = await fn.main({ fileID: 'cloud://env/r.jpg' });
    assert.equal(res2.engine, 'wechat-ocr');
    assert.equal(ocrCalls(), 2);
  });
});

test('通义千问和微信 OCR 都失败时返回两边的原因', async () => {
  await withQwen(async (server) => {
    server.reply = () => ({ status: 401, body: { error: { code: 'invalid_api_key', message: 'bad key' } } });
    fake.sdk.openapi.ocr.printedText = async () => { throw Object.assign(new Error('x'), { errCode: 101003 }); };
    const res = await fn.main({ fileID: 'cloud://env/r.jpg' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'OCR_FAILED');
    assert.match(res.message, /DASHSCOPE_API_KEY/);
    assert.match(res.message, /改用微信 OCR 也未成功/);
    assert.match(res.message, /101003/);
  });
});

test('通义千问判断不是小票时直接提示，不再兜底', async () => {
  await withQwen(async (server, ocrCalls) => {
    server.reply = () => fakeDashscope.completion(JSON.stringify(Object.assign({}, QWEN_RESULT, { isReceipt: false, items: [], total: null })));
    const res = await fn.main({ fileID: 'cloud://env/r.jpg' });
    assert.equal(res.code, 'NOT_RECEIPT');
    assert.equal(ocrCalls(), 0);
  });
});

test('RECEIPT_ENGINE 可强制指定引擎', async () => {
  await withQwen(async (server, ocrCalls) => {
    process.env.RECEIPT_ENGINE = 'wechat-ocr';
    assert.equal(fn._internal.selectedEngine(), 'wechat-ocr');
    const res = await fn.main({ fileID: 'cloud://env/r.jpg' });
    assert.equal(res.engine, 'wechat-ocr');
    assert.deepEqual(res.warnings.filter((w) => /AI 识别/.test(w)), []);
    assert.equal(server.requests.length, 0);
    assert.equal(ocrCalls(), 1);

    process.env.RECEIPT_ENGINE = 'qwen';
    delete process.env.DASHSCOPE_API_KEY;
    assert.equal((await fn.main({ fileID: 'cloud://env/r.jpg' })).code, 'CONFIG');
  });
});
