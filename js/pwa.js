// PWA：Service Worker の登録、更新の案内、保存データの永続化要求
// いずれも非対応の環境ではなにもせず、エラーで止めない。

// アプリのバージョン表示用。sw.js の CACHE_VERSION と同じ値にする（scripts/check-pwa.js で確認）
export const APP_VERSION = 'v28';

// 新しいバージョンが待機中になったら onUpdateReady(apply) を呼ぶ。
// apply() を呼ぶと新しいバージョンに切り替えて再読み込みする。
export function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return;
  // 初回インストール時（clients.claim）にも controllerchange が起きるため、
  // 利用者が［更新］を押したときだけ再読み込みする
  let updateRequested = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const notify = (worker) => {
      onUpdateReady(() => {
        updateRequested = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
    };
    // 既存の制御がある状態で待機中の新バージョンがあれば案内（初回インストール時は案内しない）
    if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) notify(worker);
      });
    });
    // アプリに戻ってきたときに更新を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {
    // 登録できなくても通常の Web ページとして動作する
  });
}

// 保存データの永続化を要求する。戻り値：true（永続化済み）/ false / null（非対応）
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// 更新を今すぐ確認する。戻り値：'checked'（確認した。新しい版があれば onUpdateReady が呼ばれる）/ 'unsupported' / 'failed'
export async function checkForUpdate() {
  try {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'unsupported';
    await reg.update();
    return 'checked';
  } catch {
    return 'failed';
  }
}

// 保存データが永続化されているか。戻り値：true / false / null（非対応）
export async function isStoragePersisted() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
