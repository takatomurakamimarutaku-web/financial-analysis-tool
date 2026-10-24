// Service Worker：アプリ本体を事前にキャッシュし、オフラインで起動できるようにする。
// ファイルを変更したら、必ず CACHE_VERSION を上げること（README「更新時の手順」参照）。
// 外部へのリクエストは行わない（同一オリジンの GET のみ扱う）。

const CACHE_PREFIX = 'fin-tool-';
const CACHE_VERSION = 'v27';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// キャッシュ対象（sw.js からの相対パス。"/" から始まる絶対パスは使わない）
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/calc.js',
  './js/chart.js',
  './js/csv.js',
  './js/settings.js',
  './js/badges.js',
  './js/help.js',
  './js/changelog.js',
  './js/workspace.js',
  './js/importer.js',
  './js/radar.js',
  './js/cashflow.js',
  './js/input-helpers.js',
  './js/secure-backup.js',
  './js/lock.js',
  './js/ui/lock.js',
  './js/ui/adjustments.js',
  './js/ui/app.js',
  './js/ui/backup.js',
  './js/ui/companies.js',
  './js/ui/import-view.js',
  './js/ui/cashflow.js',
  './js/ui/a11y.js',
  './js/ui/compare.js',
  './js/ui/core.js',
  './js/ui/diagram.js',
  './js/ui/dialogs.js',
  './js/ui/input.js',
  './js/ui/nav.js',
  './js/ui/netdebt.js',
  './js/ui/report.js',
  './js/ui/settings-view.js',
  './js/diagrams.js',
  './js/pwa.js',
  './js/store.js',
  './js/ui.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // 新しいバージョンは待機状態にとどめ、利用者が［更新］を押すまで切り替えない
  // cache: 'reload' でブラウザの HTTP キャッシュを通さずに取得する。
  // （GitHub Pages はファイルを最大10分キャッシュさせるため、通すと新しい版に古いファイルが入ることがある）
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部へのリクエストには関与しない

  // アプリの画面（スコープ直下）への遷移はキャッシュした index.html を返す（オフライン起動）。
  // feedback/ など同じサイトの別ページは置き換えず、通常どおりネットワークから取得する
  if (req.mode === 'navigate') {
    const scope = new URL(self.registration.scope).pathname;
    if (url.pathname !== scope && url.pathname !== `${scope}index.html`) return;
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cached) => cached || fetch(req)),
    );
    return;
  }
  // それ以外はキャッシュ優先。キャッシュにない同一オリジンのファイルのみネットワークから取得
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)),
  );
});
