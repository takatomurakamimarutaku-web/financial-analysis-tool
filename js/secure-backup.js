// パスワード付きバックアップ（暗号化）。Web Crypto だけを使う（外部ライブラリなし）。
// 鍵：パスワードから PBKDF2（SHA-256、ソルト16バイト）で 256ビットの鍵を作る。
// 暗号：AES-GCM（IV 12バイト）。改ざん・パスワード違いは復号の失敗として検出される。
// 中身は従来のバックアップJSON（平文バックアップと同じ文字列）を暗号化したもの。
// パスワードはどこにも保存しない。忘れると復元できない。

export const ENCRYPTED_FORMAT = 'finAnalysisTool-encrypted-backup';
export const ENCRYPTED_FORMAT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;
// ファイルに書かれた反復回数の許容範囲（極端な値で端末が固まるのを防ぐ）
export const MIN_ITERATIONS = 1000;
export const MAX_ITERATIONS = 5000000;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const SALT_BYTES = 16;
const IV_BYTES = 12;

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('この環境では暗号化を使えません');
  return s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// パスワードの確認。問題があればメッセージ、なければ空文字
export function checkPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password.length > MAX_PASSWORD_LENGTH) return `パスワードは${MAX_PASSWORD_LENGTH}文字以内にしてください`;
  if (confirm !== undefined && password !== confirm) return '確認用のパスワードが一致しません';
  return '';
}

// 暗号化の付加データ（AAD）：形式名・版・鍵の作り方。書き換えると復号に失敗する
function aadOf(header) {
  return new TextEncoder().encode(JSON.stringify([header.format, header.formatVersion, header.kdf.name, header.kdf.hash, header.kdf.iterations, header.kdf.salt, header.cipher.name, header.cipher.iv]));
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// 平文（バックアップJSONの文字列）を暗号化し、ファイルに書くJSON文字列を返す。
// opts.iterations・opts.salt・opts.iv はテスト用
export async function encryptBackup(plainText, password, opts = {}) {
  const msg = checkPassword(password);
  if (msg) throw new Error(msg);
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = opts.iv ?? globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = {
    format: ENCRYPTED_FORMAT,
    formatVersion: ENCRYPTED_FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
  };
  const key = await deriveKey(password, salt, iterations);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(header) }, key, new TextEncoder().encode(plainText));
  return JSON.stringify({ ...header, note: 'パスワード付きのバックアップです。「数字のミカタ」の「バックアップから復元」で、作成時のパスワードを入力すると復元できます。', data: bytesToBase64(new Uint8Array(ct)) }, null, 2);
}

// パスワード付きバックアップのファイルか（JSONとして読めて形式名が一致するか）
export function isEncryptedBackup(text) {
  return parseEncryptedHeader(text).ok;
}

// ファイルの外側（暗号化されていない部分）を検証する。
// 戻り値：{ ok: true, header, salt, iv, data } | { ok: false, error, encrypted }（encrypted: パスワード付きの形式名だったか）
export function parseEncryptedHeader(text) {
  if (typeof text !== 'string') return { ok: false, encrypted: false, error: 'ファイルが空です' };
  let obj;
  try {
    obj = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, encrypted: false, error: 'JSON形式ではありません' };
  }
  if (!isPlainObject(obj) || obj.format !== ENCRYPTED_FORMAT) return { ok: false, encrypted: false, error: 'パスワード付きのバックアップではありません' };
  const bad = (error) => ({ ok: false, encrypted: true, error });
  if (obj.formatVersion !== ENCRYPTED_FORMAT_VERSION) return bad(`対応していないパスワード付きバックアップの形式です（formatVersion: ${JSON.stringify(obj.formatVersion)}）`);
  const { kdf, cipher } = obj;
  if (!isPlainObject(kdf) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') return bad('鍵の作り方が対応していない形式です');
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) return bad('鍵の作り方の設定が不正です');
  if (!isPlainObject(cipher) || cipher.name !== 'AES-GCM') return bad('暗号の方式が対応していない形式です');
  const salt = base64ToBytes(kdf.salt);
  const iv = base64ToBytes(cipher.iv);
  const data = base64ToBytes(obj.data);
  if (!salt || salt.length < 8 || !iv || iv.length !== IV_BYTES || !data || data.length < 17) return bad('ファイルが壊れています');
  const header = { format: obj.format, formatVersion: obj.formatVersion, kdf: { name: kdf.name, hash: kdf.hash, iterations: kdf.iterations, salt: kdf.salt }, cipher: { name: cipher.name, iv: cipher.iv } };
  return { ok: true, header, salt, iv, data };
}

// 復号する。戻り値：{ ok: true, text } | { ok: false, error }
export async function decryptBackup(text, password) {
  const h = parseEncryptedHeader(text);
  if (!h.ok) return { ok: false, error: h.error };
  if (typeof password !== 'string' || password === '') return { ok: false, error: 'パスワードを入力してください' };
  try {
    const key = await deriveKey(password, h.salt, h.header.kdf.iterations);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: h.iv, additionalData: aadOf(h.header) }, key, h.data);
    return { ok: true, text: new TextDecoder().decode(plain) };
  } catch {
    return { ok: false, error: 'パスワードが違うか、ファイルが壊れています' };
  }
}

export function encryptedFileName(plainName) {
  return String(plainName).replace(/\.json$/i, '') + '-locked.json';
}
