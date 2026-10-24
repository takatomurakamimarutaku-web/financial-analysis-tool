import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, parseServiceWorker, pngSize } from '../scripts/check-pwa.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyApp() {
  const dir = mkdtempSync(join(tmpdir(), 'fin-pwa-'));
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']) {
    cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  }
  return dir;
}

function failures(dir) {
  return runChecks(dir).filter((r) => !r.ok).map((r) => r.message);
}

describe('PWA構成（scripts/check-pwa.js）', () => {
  test('現在の構成はすべての検証に合格する', () => {
    assert.deepEqual(failures(ROOT), []);
  });
  test('parseServiceWorker', () => {
    const sw = parseServiceWorker(readFileSync(join(ROOT, 'sw.js'), 'utf8'));
    assert.equal(sw.prefix, 'fin-tool-');
    assert.match(sw.version, /^v\d+$/);
    assert.ok(sw.assets.includes('./index.html'));
  });
  test('pngSize', () => {
    assert.deepEqual(pngSize(readFileSync(join(ROOT, 'icons/icon-512.png'))), { width: 512, height: 512 });
    assert.equal(pngSize(Buffer.from('not png')), null);
  });

  test('異常系：manifest の必須項目がない', () => {
    const dir = copyApp();
    try {
      const m = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
      delete m.name;
      delete m.display;
      writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify(m));
      const f = failures(dir);
      assert.ok(f.some((x) => x.includes('name がある')));
      assert.ok(f.some((x) => x.includes('display がある')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('異常系：start_url が絶対パス', () => {
    const dir = copyApp();
    try {
      const m = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
      m.start_url = '/index.html';
      writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify(m));
      assert.ok(failures(dir).some((x) => x.includes('start_url が相対パス')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('異常系：キャッシュ対象のファイルが実在しない・絶対パス・漏れ', () => {
    const dir = copyApp();
    try {
      let sw = readFileSync(join(dir, 'sw.js'), 'utf8');
      sw = sw.replace("'./js/chart.js',", "'/js/chart.js',\n  './js/missing.js',");
      writeFileSync(join(dir, 'sw.js'), sw);
      const f = failures(dir);
      assert.ok(f.some((x) => x.includes('実在する（./js/missing.js）')));
      assert.ok(f.some((x) => x.includes('相対パス（/js/chart.js）')));
      assert.ok(f.some((x) => x.includes('キャッシュ対象に含まれる（js/chart.js）')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('異常系：index.html に "/" から始まるパス', () => {
    const dir = copyApp();
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8').replace('href="css/style.css"', 'href="/css/style.css"');
      writeFileSync(join(dir, 'index.html'), html);
      assert.ok(failures(dir).some((x) => x.includes('"/" から始まらない（/css/style.css）')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('異常系：外部 URL（CDN）の使用', () => {
    const dir = copyApp();
    try {
      const html = readFileSync(join(dir, 'index.html'), 'utf8').replace('</head>', '<script src="https://cdn.example.com/x.js"></script></head>');
      writeFileSync(join(dir, 'index.html'), html);
      assert.ok(failures(dir).some((x) => x.includes('外部 URL がない')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('異常系：install 時に自動で skipWaiting', () => {
    const dir = copyApp();
    try {
      const sw = readFileSync(join(dir, 'sw.js'), 'utf8').replace('event.waitUntil(caches.open', 'self.skipWaiting();\n  event.waitUntil(caches.open');
      writeFileSync(join(dir, 'sw.js'), sw);
      assert.ok(failures(dir).some((x) => x.includes('skipWaiting')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
