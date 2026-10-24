// icons/icon.svg から PNG アイコン（180 / 192 / 512px）を生成する。
// 使い方：node scripts/build-icons.cjs
// 必要なもの：Playwright（Chromium）。アプリ本体の実行には不要な開発用スクリプト。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
const SIZES = [180, 192, 512];

(async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><body style="margin:0">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`;
    await page.setContent(html);
    const out = path.join(root, 'icons', `icon-${size}.png`);
    await page.screenshot({ path: out, omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`生成：icons/icon-${size}.png`);
  }
  await browser.close();
})();
