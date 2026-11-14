#!/usr/bin/env node
/**
 * 由 SVG 生成小程序用的 PNG 图标（tabBar 只支持本地 PNG/JPG）。
 *   - miniprogram/images/tab/*.png    底部导航图标：普通 / 选中 × 浅色 / 深色
 *   - miniprogram/images/icons/*.png  界面图标：白色（放在彩色圆底上）与灰色
 * SVG 源文件同时写到 design/icons/，方便以后修改。
 *
 * 运行需要 Playwright（仅生成图标时用到，不是项目依赖）：
 *   npm i -D playwright && npx playwright install chromium && node scripts/build-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
// attrs 放在前面：重复的属性以先出现的为准，这样 attrs 里的 fill 可以覆盖默认的 fill="none"
const svg = (body, attrs) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${attrs || ''} fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// 底部导航：line 为未选中（描边），solid 为选中（实心 + 白色细节）
const TABS = {
  home: {
    line: (c) => svg(`<path d="M3.5 10.6 12 3.5l8.5 7.1V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5.8h-6v5.8H5A1.5 1.5 0 0 1 3.5 19z"/>`, `stroke="${c}"`),
    solid: (c) => svg(`<path d="M3.5 10.6 12 3.5l8.5 7.1V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" fill="${c}" stroke="${c}"/><path d="M9.5 20.5v-5.3a.7.7 0 0 1 .7-.7h3.6a.7.7 0 0 1 .7.7v5.3z" fill="#fff" stroke="none"/>`)
  },
  list: {
    line: (c) => svg(`<path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v15.5l-2.3-1.4-2.3 1.4-2.4-1.4-2.4 1.4-2.3-1.4L5 20.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M9 8.5h6M9 12.5h6"/>`, `stroke="${c}"`),
    solid: (c) => svg(`<path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v15.5l-2.3-1.4-2.3 1.4-2.4-1.4-2.4 1.4-2.3-1.4L5 20.5V5a1.5 1.5 0 0 1 1.5-1.5z" fill="${c}" stroke="${c}"/><path d="M9 8.5h6M9 12.5h6" stroke="#fff"/>`)
  },
  stats: {
    line: (c) => svg(`<rect x="4" y="12" width="4" height="8.5" rx="1"/><rect x="10" y="4.5" width="4" height="16" rx="1"/><rect x="16" y="9" width="4" height="11.5" rx="1"/>`, `stroke="${c}"`),
    solid: (c) => svg(`<rect x="4" y="12" width="4" height="8.5" rx="1"/><rect x="10" y="4.5" width="4" height="16" rx="1"/><rect x="16" y="9" width="4" height="11.5" rx="1"/>`, `fill="${c}" stroke="${c}"`)
  },
  price: {
    line: (c) => svg(`<path d="M3.5 12.4V5.5a2 2 0 0 1 2-2h6.9a2 2 0 0 1 1.4.6l6.1 6.1a2 2 0 0 1 0 2.8l-6.9 6.9a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1-.6-1.4z"/><circle cx="8.2" cy="8.2" r="1.4"/>`, `stroke="${c}"`),
    solid: (c) => svg(`<path d="M3.5 12.4V5.5a2 2 0 0 1 2-2h6.9a2 2 0 0 1 1.4.6l6.1 6.1a2 2 0 0 1 0 2.8l-6.9 6.9a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1-.6-1.4z" fill="${c}" stroke="${c}"/><circle cx="8.2" cy="8.2" r="1.5" fill="#fff" stroke="none"/>`)
  },
  mine: {
    line: (c) => svg(`<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>`, `stroke="${c}"`),
    solid: (c) => svg(`<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0z"/>`, `fill="${c}" stroke="${c}"`)
  }
};

// 界面图标
const GLYPHS = {
  camera: `<path d="M4 8.5a2 2 0 0 1 2-2h1.4l1.1-1.7a1 1 0 0 1 .8-.4h5.4a1 1 0 0 1 .8.4l1.1 1.7H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.4"/>`,
  album: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m20.5 15-4.6-4.6L6 19.5"/>`,
  edit: `<path d="M4.5 19.5h3.8L19 8.8a2 2 0 0 0-2.8-2.8L5.5 16.7z"/><path d="m14.3 7.8 2.9 2.9"/>`,
  search: `<circle cx="11" cy="11" r="6.3"/><path d="m19.5 19.5-3.9-3.9"/>`
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (file, markup, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: true });
  };

  const tabColors = { '': ['line', '#8a8984'], '-active': ['solid', '#1f7a5c'], '-dark': ['line', '#9b9a94'], '-active-dark': ['solid', '#4cc79a'] };
  for (const [name, variants] of Object.entries(TABS)) {
    fs.writeFileSync(path.join(ROOT, 'design/icons', 'tab-' + name + '.svg'), variants.line('#8a8984'));
    fs.writeFileSync(path.join(ROOT, 'design/icons', 'tab-' + name + '-active.svg'), variants.solid('#1f7a5c'));
    for (const [suffix, [style, color]] of Object.entries(tabColors)) {
      await render(path.join(ROOT, 'miniprogram/images/tab', name + suffix + '.png'), variants[style](color), 81);
    }
  }
  for (const [name, body] of Object.entries(GLYPHS)) {
    fs.writeFileSync(path.join(ROOT, 'design/icons', name + '.svg'), svg(body, 'stroke="#1f7a5c"'));
    await render(path.join(ROOT, 'miniprogram/images/icons', name + '.png'), svg(body, 'stroke="#ffffff"'), 96);
  }
  await render(path.join(ROOT, 'miniprogram/images/icons', 'search-gray.png'), svg(GLYPHS.search, 'stroke="#8a8984"'), 96);
  await browser.close();
  console.log('icons generated');
}

main().catch((e) => { console.error(e); process.exit(1); });
