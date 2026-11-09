const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-cloud');

fake.install();
const fn = require('../cloudfunctions/parseReceipt/index');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

test('无 Claude Key 时使用微信 OCR + 规则解析', async () => {
  delete process.env.ANTHROPIC_API_KEY;
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
