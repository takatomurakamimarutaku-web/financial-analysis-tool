// 起動時のパスコードロック（任意）。覆い見（画面をのぞかれる）への対策で、保存データの暗号化ではない。
// パスコードそのものは保存せず、PBKDF2（SHA-256）で作った照合用の値だけを localStorage に置く。
// ワークスペースのデータとは別のキーに保存し、バックアップには含めない（端末ごとの設定）。
import { base64ToBytes, bytesToBase64 } from './secure-backup.js';

export const LOCK_KEY = 'finAnalysisTool.lock';
export const LOCK_VERSION = 1;
export const LOCK_ITERATIONS = 200000;
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 12;
// 再ロックまでの時間（分）。0 は起動時だけ
export const RELOCK_OPTIONS = [
  { value: 0, label: '起動したときだけ' },
  { value: 1, label: 'ほかのアプリから戻って1分たったとき' },
  { value: 5, label: 'ほかのアプリから戻って5分たったとき' },
  { value: 15, label: 'ほかのアプリから戻って15分たったとき' },
];
export const DEFAULT_RELOCK_MINUTES = 5;
// この回数続けて間違えると、しばらく入力できない
export const LOCKOUT_AFTER = 5;

export const LOCK_NOTICE = 'パスコードロックは、画面をほかの人にのぞかれないための機能です。保存データそのものは暗号化されないため、端末の紛失・盗難への備えにはなりません。端末自体のパスコードも設定し、ファイルとして持ち出すときは「パスワード付きで保存」を使ってください。';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// パスコードの確認。問題があればメッセージ、なければ空文字
export function checkPasscode(code, confirm) {
  if (typeof code !== 'string' || !/^[0-9]+$/.test(code)) return 'パスコードは数字で入力してください';
  if (code.length < PASSCODE_MIN || code.length > PASSCODE_MAX) return `パスコードは${PASSCODE_MIN}〜${PASSCODE_MAX}桁にしてください`;
  if (confirm !== undefined && code !== confirm) return '確認用のパスコードが一致しません';
  return '';
}

async function digest(code, salt, iterations) {
  const s = globalThis.crypto.subtle;
  const base = await s.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

// 照合用の記録を作る。opts.iterations・opts.salt はテスト用
export async function createLock(code, opts = {}) {
  const msg = checkPasscode(code);
  if (msg) throw new Error(msg);
  const iterations = opts.iterations ?? LOCK_ITERATIONS;
  const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await digest(code, salt, iterations);
  return {
    version: LOCK_VERSION,
    iterations,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    relockMinutes: normalizeRelock(opts.relockMinutes),
  };
}

function normalizeRelock(v) {
  return RELOCK_OPTIONS.some((o) => o.value === v) ? v : DEFAULT_RELOCK_MINUTES;
}

// 保存されていた記録を検証する。不正なら null
export function normalizeLock(raw) {
  if (!isPlainObject(raw) || raw.version !== LOCK_VERSION) return null;
  if (!Number.isInteger(raw.iterations) || raw.iterations < 1000 || raw.iterations > 5000000) return null;
  const salt = base64ToBytes(raw.salt);
  const hash = base64ToBytes(raw.hash);
  if (!salt || salt.length < 8 || !hash || hash.length !== 32) return null;
  return { version: LOCK_VERSION, iterations: raw.iterations, salt: raw.salt, hash: raw.hash, relockMinutes: normalizeRelock(raw.relockMinutes) };
}

export async function verifyPasscode(record, code) {
  const r = normalizeLock(record);
  if (!r || typeof code !== 'string' || code === '') return false;
  const got = await digest(code, base64ToBytes(r.salt), r.iterations);
  const want = base64ToBytes(r.hash);
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function withRelockMinutes(record, minutes) {
  return { ...record, relockMinutes: normalizeRelock(minutes) };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// 戻り値：{ record, invalid }。invalid は「キーはあるが読めない」
export function loadLock(storage = defaultStorage()) {
  try {
    const text = storage?.getItem(LOCK_KEY);
    if (!text) return { record: null, invalid: false };
    const record = normalizeLock(JSON.parse(text));
    return { record, invalid: !record };
  } catch {
    return { record: null, invalid: true };
  }
}

export function saveLock(record, storage = defaultStorage()) {
  try {
    storage?.setItem(LOCK_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearLock(storage = defaultStorage()) {
  try {
    storage?.removeItem(LOCK_KEY);
    return true;
  } catch {
    return false;
  }
}

// 続けて間違えた回数から、次に入力できるまでの待ち時間（ミリ秒）。5回目から30秒、以後倍、最大5分
export function lockoutMs(failures) {
  if (!Number.isInteger(failures) || failures < LOCKOUT_AFTER) return 0;
  return Math.min(30000 * 2 ** (failures - LOCKOUT_AFTER), 5 * 60 * 1000);
}

// ほかのアプリに切り替えた時刻 hiddenAt から、戻った now までに再ロックの時間がたったか
export function shouldRelock(hiddenAt, now, minutes) {
  if (!minutes || !Number.isFinite(hiddenAt) || !Number.isFinite(now)) return false;
  return now - hiddenAt >= minutes * 60 * 1000;
}
