// PWA構成の検証スクリプト
// 使い方：node scripts/check-pwa.js   （問題があれば終了コード 1）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_URLS = ['http://www.w3.org/2000/svg'];

function read(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function isAbsolutePath(p) {
  return typeof p === 'string' && p.startsWith('/');
}

function isExternal(p) {
  return typeof p === 'string' && /^[a-z]+:\/\//i.test(p);
}

// "./a/b" → "a/b"、"./" → "index.html"（ディレクトリは index.html として扱う）
function toFile(p) {
  const s = p.replace(/^\.\//, '');
  return s === '' || s.endsWith('/') ? `${s}index.html` : s;
}

// PNG の幅・高さを IHDR から読む
export function pngSize(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// sw.js から定数を取り出す
export function parseServiceWorker(src) {
  const prefix = src.match(/const\s+CACHE_PREFIX\s*=\s*'([^']*)'/)?.[1] ?? null;
  const version = src.match(/const\s+CACHE_VERSION\s*=\s*'([^']*)'/)?.[1] ?? null;
  const block = src.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/)?.[1];
  const assets = block ? [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]) : null;
  return { prefix, version, assets };
}

function listFiles(root, dir, ext) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => statSync(join(abs, f)).isFile() && (!ext || f.endsWith(ext)))
    .map((f) => `${dir}/${f}`);
}

function externalUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0])
    .filter((u) => !ALLOWED_URLS.includes(u));
}

// コメントを除いた JS / CSS 本文
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function runChecks(root) {
  const results = [];
  const check = (ok, message) => results.push({ ok: Boolean(ok), message });

  // ---- manifest ----
  let manifest = null;
  try {
    manifest = JSON.parse(read(root, 'manifest.webmanifest'));
    check(true, 'manifest.webmanifest を JSON として読める');
  } catch (e) {
    check(false, `manifest.webmanifest を読めない（${e.message}）`);
  }
  if (manifest) {
    for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
      check(manifest[key] !== undefined && manifest[key] !== '', `manifest に ${key} がある`);
    }
    check(manifest.display === 'standalone', 'manifest の display が standalone');
    for (const key of ['start_url', 'scope']) {
      check(!isAbsolutePath(manifest[key]) && !isExternal(manifest[key]), `manifest の ${key} が相対パス（${manifest[key]}）`);
    }
    check(/^#[0-9a-f]{3,8}$/i.test(manifest.theme_color ?? ''), 'manifest に theme_color がある');
    check(/^#[0-9a-f]{3,8}$/i.test(manifest.background_color ?? ''), 'manifest に background_color がある');
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    for (const size of ['192x192', '512x512']) {
      for (const purpose of ['any', 'maskable']) {
        const found = icons.some((i) => i.sizes === size && String(i.purpose ?? 'any').split(/\s+/).includes(purpose));
        check(found, `manifest に ${size}（purpose: ${purpose}）のアイコンがある`);
      }
    }
    for (const icon of icons) {
      const src = icon.src ?? '';
      check(!isAbsolutePath(src) && !isExternal(src), `アイコンのパスが相対パス（${src}）`);
      const exists = existsSync(join(root, src));
      check(exists, `アイコンが実在する（${src}）`);
      if (exists && icon.type === 'image/png') {
        const size = pngSize(readFileSync(join(root, src)));
        check(size && `${size.width}x${size.height}` === icon.sizes, `アイコンの実寸が sizes と一致（${src}：${icon.sizes}）`);
      }
    }
  }

  // ---- Service Worker ----
  let sw = null;
  let swSource = null;
  try {
    swSource = read(root, 'sw.js');
    sw = parseServiceWorker(swSource);
  } catch (e) {
    check(false, `sw.js を読めない（${e.message}）`);
  }
  if (sw) {
    const cacheName = `${sw.prefix}${sw.version}`;
    check(sw.prefix && sw.version && /^fin-tool-v\d+$/.test(cacheName), `キャッシュ名にバージョンが付いている（${cacheName}）`);
    check(Array.isArray(sw.assets) && sw.assets.length > 0, 'sw.js に ASSETS（キャッシュ対象）がある');
    check(/cache:\s*'reload'/.test(swSource ?? ''), 'sw.js のインストール時に HTTP キャッシュを通さず取得する（cache: \'reload\'）');
    const assets = sw.assets ?? [];
    for (const a of assets) {
      check(!isAbsolutePath(a) && !isExternal(a), `キャッシュ対象が相対パス（${a}）`);
      check(existsSync(join(root, toFile(a))), `キャッシュ対象が実在する（${a}）`);
    }
    const cached = new Set(assets.map(toFile));
    const required = [
      'index.html',
      'manifest.webmanifest',
      ...listFiles(root, 'css', '.css'),
      ...listFiles(root, 'js', '.js'),
      ...listFiles(root, 'icons'),
    ];
    for (const f of required) check(cached.has(f), `アプリ本体のファイルがキャッシュ対象に含まれる（${f}）`);
    // 設定画面に表示するアプリのバージョンが sw.js のキャッシュバージョンと一致すること
    let appVersion = null;
    try {
      appVersion = read(root, 'js/pwa.js').match(/export\s+const\s+APP_VERSION\s*=\s*'([^']*)'/)?.[1] ?? null;
    } catch {
      // 下の check で NG になる
    }
    check(appVersion === sw.version, `js/pwa.js の APP_VERSION が sw.js の CACHE_VERSION と一致（${appVersion} / ${sw.version}）`);
  }

  // ---- index.html ----
  let html = '';
  try {
    html = read(root, 'index.html');
  } catch (e) {
    check(false, `index.html を読めない（${e.message}）`);
  }
  if (html) {
    check(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(html), 'index.html に manifest へのリンクがある');
    const touch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]*>/)?.[0] ?? '';
    const touchHref = touch.match(/href="([^"]+)"/)?.[1];
    check(touch && /sizes="180x180"/.test(touch), 'index.html に apple-touch-icon（180px）へのリンクがある');
    if (touchHref) {
      check(existsSync(join(root, touchHref)), `apple-touch-icon が実在する（${touchHref}）`);
      const size = existsSync(join(root, touchHref)) ? pngSize(readFileSync(join(root, touchHref))) : null;
      check(size && size.width === 180 && size.height === 180, 'apple-touch-icon の実寸が 180x180');
    }
    check(/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/.test(html), 'viewport に viewport-fit=cover がある');
    const refs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    for (const r of refs) check(!isAbsolutePath(r), `index.html のパスが "/" から始まらない（${r}）`);
    check(externalUrls(html).length === 0, `index.html に外部 URL がない${externalUrls(html).length ? `（${externalUrls(html).join(', ')}）` : ''}`);
  }

  // ---- CSS / JS ----
  const css = listFiles(root, 'css', '.css').map((f) => read(root, f)).join('\n');
  check(/env\(safe-area-inset-top\)/.test(css) && /env\(safe-area-inset-bottom\)/.test(css),
    'CSS で env(safe-area-inset-top / bottom) の余白を確保している');
  for (const f of ['sw.js', ...listFiles(root, 'js', '.js'), ...listFiles(root, 'css', '.css')]) {
    const urls = externalUrls(stripComments(read(root, f)));
    check(urls.length === 0, `${f} に外部 URL がない${urls.length ? `（${urls.join(', ')}）` : ''}`);
  }
  const swSrc = existsSync(join(root, 'sw.js')) ? read(root, 'sw.js') : '';
  check(/register\(\s*'\.\/sw\.js'/.test(listFiles(root, 'js', '.js').map((f) => read(root, f)).join('\n')),
    'Service Worker を相対パス（./sw.js）で登録している');
  const installBlock = swSrc.match(/addEventListener\('install'[\s\S]*?\n\}\);/)?.[0];
  check(installBlock && !/skipWaiting/.test(stripComments(installBlock)),
    'install 時に自動で skipWaiting しない（更新は利用者の操作で切り替え）');
  check(/caches\.delete/.test(swSrc) && /addEventListener\('activate'/.test(swSrc), 'activate 時に旧キャッシュを削除する');

  return results;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const results = runChecks(root);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.message}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} 項目中 ${results.length - failed.length} 項目 OK、${failed.length} 項目 NG`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
