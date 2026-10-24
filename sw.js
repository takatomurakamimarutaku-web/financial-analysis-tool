// Service Worker：アプリ本体を事前にキャッシュし、オフラインで起動できるようにする。
// ファイルを変更したら、必ず CACHE_VERSION を上げること（README「更新時の手順」参照）。
// 外部へのリクエストは行わない（同一オリジンの GET のみ扱う）。

const CACHE_PREFIX = 'fin-tool-';
const CACHE_VERSION = 'v8';
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
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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

  // 画面遷移はキャッシュした index.html を返す（オフライン起動）
  if (req.mode === 'navigate') {
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
