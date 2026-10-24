import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENCRYPTED_FORMAT, MAX_ITERATIONS, PBKDF2_ITERATIONS, base64ToBytes, bytesToBase64, checkPassword, decryptBackup,
  encryptBackup, encryptedFileName, isEncryptedBackup, parseEncryptedHeader,
} from '../js/secure-backup.js';
import { backupToJson, getSampleMultiData } from '../js/store.js';
import { parseAnyBackup } from '../js/workspace.js';

const FAST = { iterations: 1000 };
const PW = 'correct horse 8';

test('base64 の往復', () => {
  const b = new Uint8Array([0, 1, 2, 250, 255, 128]);
  assert.deepEqual(base64ToBytes(bytesToBase64(b)), b);
  assert.equal(base64ToBytes('***'), null);
  assert.equal(base64ToBytes(123), null);
});

test('パスワードの確認', () => {
  assert.match(checkPassword('short'), /8文字以上/);
  assert.equal(checkPassword('abcdefgh'), '');
  assert.match(checkPassword('abcdefgh', 'abcdefgX'), /一致しません/);
  assert.match(checkPassword('a'.repeat(257)), /256文字以内/);
  assert.match(checkPassword(undefined), /8文字以上/);
});

test('暗号化して同じパスワードで復号すると元の文字列に戻る', async () => {
  const plain = backupToJson(getSampleMultiData(), new Date('2026-10-24T00:00:00Z'));
  const enc = await encryptBackup(plain, PW, FAST);
  assert.equal(isEncryptedBackup(enc), true);
  assert.equal(isEncryptedBackup(plain), false);
  // 中身（会社名・数値）は平文で残らない
  assert.ok(!enc.includes('サンプル'));
  assert.ok(!enc.includes('"periods"'));
  const res = await decryptBackup(enc, PW);
  assert.equal(res.ok, true);
  assert.equal(res.text, plain);
  // 復号したものは従来の復元処理でそのまま読める
  assert.equal(parseAnyBackup(res.text).ok, true);
});

test('既定の反復回数は60万回で、ファイルに記録される', async () => {
  assert.equal(PBKDF2_ITERATIONS, 600000);
  const enc = await encryptBackup('{}', PW, FAST);
  const obj = JSON.parse(enc);
  assert.equal(obj.format, ENCRYPTED_FORMAT);
  assert.equal(obj.kdf.name, 'PBKDF2');
  assert.equal(obj.kdf.hash, 'SHA-256');
  assert.equal(obj.kdf.iterations, 1000);
  assert.equal(obj.cipher.name, 'AES-GCM');
  assert.equal(base64ToBytes(obj.kdf.salt).length, 16);
  assert.equal(base64ToBytes(obj.cipher.iv).length, 12);
});

test('毎回ソルトとIVが変わり、同じ内容でも暗号文が異なる', async () => {
  const a = JSON.parse(await encryptBackup('same', PW, FAST));
  const b = JSON.parse(await encryptBackup('same', PW, FAST));
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test('パスワード違いは復号できない', async () => {
  const enc = await encryptBackup('secret', PW, FAST);
  const res = await decryptBackup(enc, `${PW}x`);
  assert.equal(res.ok, false);
  assert.match(res.error, /パスワードが違うか/);
  assert.equal((await decryptBackup(enc, '')).ok, false);
});

test('暗号文・ヘッダーの改ざんは検出される', async () => {
  const obj = JSON.parse(await encryptBackup('secret text', PW, FAST));
  const bytes = base64ToBytes(obj.data);
  bytes[0] ^= 1;
  assert.equal((await decryptBackup(JSON.stringify({ ...obj, data: bytesToBase64(bytes) }), PW)).ok, false);
  // 反復回数を書き換える（AADで保護）
  assert.equal((await decryptBackup(JSON.stringify({ ...obj, kdf: { ...obj.kdf, iterations: 1001 } }), PW)).ok, false);
});

test('形式の検証', async () => {
  const obj = JSON.parse(await encryptBackup('x', PW, FAST));
  assert.equal(parseEncryptedHeader('not json').ok, false);
  assert.equal(parseEncryptedHeader('{"format":"other"}').encrypted, false);
  assert.match(parseEncryptedHeader(JSON.stringify({ ...obj, formatVersion: 2 })).error, /対応していない/);
  assert.equal(parseEncryptedHeader(JSON.stringify({ ...obj, kdf: { ...obj.kdf, iterations: MAX_ITERATIONS + 1 } })).ok, false);
  assert.equal(parseEncryptedHeader(JSON.stringify({ ...obj, kdf: { ...obj.kdf, hash: 'SHA-1' } })).ok, false);
  assert.equal(parseEncryptedHeader(JSON.stringify({ ...obj, cipher: { ...obj.cipher, iv: 'AAAA' } })).ok, false);
  assert.equal(parseEncryptedHeader(JSON.stringify({ ...obj, data: '' })).ok, false);
  assert.equal(parseEncryptedHeader(`﻿${JSON.stringify(obj)}`).ok, true);
});

test('短いパスワードでは暗号化しない', async () => {
  await assert.rejects(() => encryptBackup('x', 'short'), /8文字以上/);
});

test('ファイル名', () => {
  assert.equal(encryptedFileName('fin-tool-backup-all-2026-10-24.json'), 'fin-tool-backup-all-2026-10-24-locked.json');
});

test('日本語のパスワードも使える（NFC に正規化）', async () => {
  const enc = await encryptBackup('データ', 'パスワードです１２', FAST);
  assert.equal((await decryptBackup(enc, 'パスワードです１２'.normalize('NFD'))).ok, true);
});
