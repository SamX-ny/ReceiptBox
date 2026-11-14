#!/usr/bin/env node
/**
 * 把 shared/ 下的公共模块复制到小程序与各云函数目录。
 * 小程序与云函数各自独立打包上传，无法引用目录外的文件，所以需要复制。
 *
 *   node scripts/sync-shared.js          复制
 *   node scripts/sync-shared.js --check  只检查副本是否与源文件一致（CI / 测试用）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'shared');
const TARGETS = [
  'miniprogram/shared',
  'cloudfunctions/api/shared',
  'cloudfunctions/parseReceipt/shared'
];
const HEADER = '// ⚠️ 自动生成：请修改仓库根目录 shared/ 下的源文件，然后运行 npm run sync\n';

function expected(file) {
  return HEADER + fs.readFileSync(path.join(SRC, file), 'utf8');
}

function run(check) {
  const files = fs.readdirSync(SRC).filter(function (f) { return f.endsWith('.js'); });
  const stale = [];
  TARGETS.forEach(function (t) {
    const dir = path.join(ROOT, t);
    if (!check) fs.mkdirSync(dir, { recursive: true });
    files.forEach(function (f) {
      const dest = path.join(dir, f);
      const want = expected(f);
      const have = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
      if (have === want) return;
      if (check) stale.push(path.join(t, f));
      else fs.writeFileSync(dest, want);
    });
  });
  return stale;
}

if (require.main === module) {
  const check = process.argv.indexOf('--check') >= 0;
  const stale = run(check);
  if (check && stale.length) {
    console.error('以下副本与 shared/ 不一致，请运行 npm run sync：\n  ' + stale.join('\n  '));
    process.exit(1);
  }
  console.log(check ? 'shared 副本一致' : 'shared 已同步');
}

module.exports = { run: run };
