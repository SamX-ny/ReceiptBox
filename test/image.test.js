/**
 * 上传前压缩逻辑（miniprogram/utils/image.js），用模拟的 wx 接口测试。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// files: path -> { width, height, size, orientation }
function mockWx(files, opts) {
  opts = opts || {};
  const calls = { compress: [], canvas: [] };
  let n = 0;
  global.wx = {
    getImageInfo({ src, success, fail }) {
      const f = files[src];
      if (!f || opts.noImageInfo) return fail({ errMsg: 'getImageInfo:fail' });
      success({ width: f.width, height: f.height, orientation: f.orientation || 'up' });
    },
    getFileSystemManager: () => ({
      getFileInfo({ filePath, success, fail }) {
        const f = files[filePath];
        return f ? success({ size: f.size }) : fail({});
      }
    }),
    compressImage({ src, quality, compressedWidth, success, fail }) {
      calls.compress.push({ src, quality, compressedWidth });
      if (opts.compressFails) return fail({ errMsg: 'compressImage:fail' });
      const f = files[src];
      const out = 'tmp/compressed' + (++n) + '.jpg';
      // ignoreWidth 模拟忽略 compressedWidth 的微信版本：只降质量，不缩小尺寸
      const scale = compressedWidth && !opts.ignoreWidth ? compressedWidth / f.width : 1;
      files[out] = {
        width: Math.round(f.width * scale),
        height: Math.round(f.height * scale),
        size: Math.round(f.size * scale * scale * (quality / 100) * (opts.sizeFactor || 0.5))
      };
      success({ tempFilePath: out });
    },
    createOffscreenCanvas: opts.noCanvas ? undefined : ({ width, height }) => ({
      createImage() {
        const img = {};
        Object.defineProperty(img, 'src', { set() { setTimeout(() => img.onload(), 0); } });
        return img;
      },
      getContext: () => ({ drawImage() {} }),
      __size: { width, height }
    }),
    canvasToTempFilePath({ canvas, quality, success }) {
      calls.canvas.push({ width: canvas.__size.width, height: canvas.__size.height, quality });
      const out = 'tmp/canvas' + (++n) + '.jpg';
      files[out] = { width: canvas.__size.width, height: canvas.__size.height, size: 250 * 1024 };
      success({ tempFilePath: out });
    }
  };
  return calls;
}

function load() {
  delete require.cache[require.resolve('../miniprogram/utils/image')];
  return require('../miniprogram/utils/image');
}

const MB = 1024 * 1024;
const silence = () => { const orig = console.log; console.log = () => {}; return () => { console.log = orig; }; };

test('相机原图：按最长边 1600、质量 70 压缩', async () => {
  const files = { 'photo.jpg': { width: 3024, height: 4032, size: 4 * MB } };
  const calls = mockWx(files);
  const restore = silence();
  const out = await load().prepareImage('photo.jpg');
  restore();
  assert.deepEqual(calls.compress, [{ src: 'photo.jpg', quality: 70, compressedWidth: 1200 }]);
  assert.equal(calls.canvas.length, 0);
  assert.deepEqual([files[out].width, files[out].height], [1200, 1600]);
  assert.ok(files[out].size < 400 * 1024, '压缩后应远小于原图');
});

test('横向照片按宽度换算', async () => {
  const files = { 'wide.jpg': { width: 4000, height: 3000, size: 3 * MB } };
  const calls = mockWx(files);
  const restore = silence();
  await load().prepareImage('wide.jpg');
  restore();
  assert.equal(calls.compress[0].compressedWidth, 1600);
});

test('微信忽略目标宽度时改用 Canvas 缩放', async () => {
  const files = { 'photo.jpg': { width: 3024, height: 4032, size: 4 * MB } };
  const calls = mockWx(files, { ignoreWidth: true });
  const restore = silence();
  const out = await load().prepareImage('photo.jpg');
  restore();
  assert.deepEqual(calls.canvas, [{ width: 1200, height: 1600, quality: 0.7 }]);
  assert.match(out, /canvas/);
  assert.equal(files[out].height, 1600);
});

test('带旋转信息的照片不走 Canvas；不支持 Canvas 时保留 compressImage 的结果', async () => {
  let files = { 'rot.jpg': { width: 4032, height: 3024, size: 4 * MB, orientation: 'right' } };
  let calls = mockWx(files, { ignoreWidth: true });
  let restore = silence();
  let out = await load().prepareImage('rot.jpg');
  restore();
  assert.equal(calls.canvas.length, 0);
  assert.match(out, /compressed/);

  files = { 'photo.jpg': { width: 3024, height: 4032, size: 4 * MB } };
  calls = mockWx(files, { ignoreWidth: true, noCanvas: true });
  restore = silence();
  out = await load().prepareImage('photo.jpg');
  restore();
  assert.match(out, /compressed/);
});

test('尺寸不大的照片也会降质量；压缩后仍过大时再降一次', async () => {
  let files = { 'small.jpg': { width: 1200, height: 1500, size: 1.2 * MB } };
  let calls = mockWx(files);
  let restore = silence();
  await load().prepareImage('small.jpg');
  restore();
  assert.deepEqual(calls.compress, [{ src: 'small.jpg', quality: 70, compressedWidth: undefined }]);

  files = { 'huge.jpg': { width: 1500, height: 1600, size: 12 * MB } };
  calls = mockWx(files, { sizeFactor: 1 });
  restore = silence();
  await load().prepareImage('huge.jpg');
  restore();
  assert.deepEqual(calls.compress.map((c) => c.quality), [70, 45]);
});

test('压缩失败或读不到图片信息时仍能上传（返回可用路径）', async () => {
  let files = { 'photo.jpg': { width: 3024, height: 4032, size: 4 * MB } };
  mockWx(files, { compressFails: true, noCanvas: true });
  let restore = silence();
  assert.equal(await load().prepareImage('photo.jpg'), 'photo.jpg');
  restore();

  files = { 'photo.jpg': { width: 3024, height: 4032, size: 4 * MB } };
  const calls = mockWx(files, { noImageInfo: true });
  restore = silence();
  const out = await load().prepareImage('photo.jpg');
  restore();
  assert.equal(calls.compress[0].compressedWidth, undefined);
  assert.match(out, /compressed/);
});

test('原图已经很小、压缩后反而变大时用原图', async () => {
  const files = { 'tiny.jpg': { width: 800, height: 1000, size: 60 * 1024 } };
  mockWx(files, { sizeFactor: 3 });
  const restore = silence();
  assert.equal(await load().prepareImage('tiny.jpg'), 'tiny.jpg');
  restore();
});
