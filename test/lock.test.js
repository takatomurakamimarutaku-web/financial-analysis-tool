import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RELOCK_MINUTES, LOCK_ITERATIONS, LOCK_KEY, checkPasscode, clearLock, createLock, loadLock, lockoutMs, normalizeLock,
  saveLock, shouldRelock, verifyPasscode, withRelockMinutes,
} from '../js/lock.js';

const FAST = { iterations: 1000 };

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

test('パスコードの確認（数字4〜12桁）', () => {
  assert.equal(checkPasscode('1234'), '');
  assert.equal(checkPasscode('123456789012'), '');
  assert.match(checkPasscode('123'), /4〜12桁/);
  assert.match(checkPasscode('1234567890123'), /4〜12桁/);
  assert.match(checkPasscode('12a4'), /数字/);
  assert.match(checkPasscode('１２３４'), /数字/);
  assert.match(checkPasscode('1234', '1235'), /一致しません/);
  assert.match(checkPasscode(null), /数字/);
});

test('記録にはパスコードそのものを含めず、照合できる', async () => {
  const rec = await createLock('2580', FAST);
  assert.equal(JSON.stringify(rec).includes('2580'), false);
  assert.equal(rec.relockMinutes, DEFAULT_RELOCK_MINUTES);
  assert.equal(await verifyPasscode(rec, '2580'), true);
  assert.equal(await verifyPasscode(rec, '2581'), false);
  assert.equal(await verifyPasscode(rec, ''), false);
  assert.equal(await verifyPasscode(null, '2580'), false);
  assert.ok(LOCK_ITERATIONS >= 100000);
});

test('同じパスコードでもソルトが変わる', async () => {
  const a = await createLock('2580', FAST);
  const b = await createLock('2580', FAST);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('不正なパスコードでは作らない', async () => {
  await assert.rejects(() => createLock('12'), /4〜12桁/);
});

test('記録の検証', async () => {
  const rec = await createLock('2580', FAST);
  assert.deepEqual(normalizeLock(rec), rec);
  assert.equal(normalizeLock(null), null);
  assert.equal(normalizeLock({ ...rec, version: 2 }), null);
  assert.equal(normalizeLock({ ...rec, iterations: 10 }), null);
  assert.equal(normalizeLock({ ...rec, hash: 'AAAA' }), null);
  assert.equal(normalizeLock({ ...rec, relockMinutes: 7 }).relockMinutes, DEFAULT_RELOCK_MINUTES);
  assert.equal(withRelockMinutes(rec, 0).relockMinutes, 0);
  assert.equal(withRelockMinutes(rec, 15).relockMinutes, 15);
});

test('保存・読み込み・削除（読めない記録は invalid）', async () => {
  const s = memoryStorage();
  assert.deepEqual(loadLock(s), { record: null, invalid: false });
  const rec = await createLock('2580', FAST);
  assert.equal(saveLock(rec, s), true);
  assert.deepEqual(loadLock(s).record, rec);
  assert.equal(clearLock(s), true);
  assert.equal(s.map.has(LOCK_KEY), false);
  assert.deepEqual(loadLock(memoryStorage({ [LOCK_KEY]: '{bad' })), { record: null, invalid: true });
  assert.deepEqual(loadLock(memoryStorage({ [LOCK_KEY]: '{"version":1}' })), { record: null, invalid: true });
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  assert.equal(loadLock(broken).invalid, true);
  assert.equal(saveLock(rec, broken), false);
  assert.equal(clearLock(broken), false);
});

test('続けて間違えたときの待ち時間', () => {
  assert.equal(lockoutMs(0), 0);
  assert.equal(lockoutMs(4), 0);
  assert.equal(lockoutMs(5), 30000);
  assert.equal(lockoutMs(6), 60000);
  assert.equal(lockoutMs(20), 300000);
});

test('再ロックの判定', () => {
  const t = Date.UTC(2026, 9, 24);
  assert.equal(shouldRelock(t, t + 5 * 60000, 5), true);
  assert.equal(shouldRelock(t, t + 5 * 60000 - 1, 5), false);
  assert.equal(shouldRelock(t, t + 999 * 60000, 0), false, '起動時だけ');
  assert.equal(shouldRelock(null, t, 5), false);
});
