import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_FORMAT, BACKUP_FORMAT_VERSION, LAST_BACKUP_KEY,
  createBackup, backupToJson, backupFileName, parseBackup, validateData,
  getLastBackupAt, setLastBackupAt, needsBackupReminder, hasAnyData,
  getSampleData, getSampleMultiData, createEmptyData,
} from '../js/store.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

const NOW = new Date('2026-10-24T06:00:00Z');
const wrap = (data, extra = {}) => JSON.stringify({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: NOW.toISOString(), data, ...extra });

describe('バックアップ（エクスポート）', () => {
  test('形式・バージョン・作成日時・データを含む', () => {
    const b = createBackup(getSampleData(), NOW);
    assert.equal(b.format, BACKUP_FORMAT);
    assert.equal(b.formatVersion, 1);
    assert.equal(b.exportedAt, '2026-10-24T06:00:00.000Z');
    assert.deepEqual(b.data, getSampleData());
  });
  test('ファイル名に日付が入る', () => {
    assert.equal(backupFileName(new Date(2026, 0, 5)), 'fin-tool-backup-2026-01-05.json');
  });
  test('エクスポート → インポートで同じデータに戻る', () => {
    const data = getSampleMultiData();
    const r = parseBackup(backupToJson(data, NOW));
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, data);
    assert.equal(r.exportedAt, NOW.toISOString());
  });
});

describe('インポートの検証：正常系', () => {
  test('BOM 付きでも読める', () => {
    assert.equal(parseBackup(`﻿${backupToJson(getSampleData(), NOW)}`).ok, true);
  });
  test('未入力（null）や欠けた項目は許容し、null で補う', () => {
    const data = { version: 1, companyName: 'A', periods: [{ label: 'X', pl: { sales: 100 }, bs: {} }] };
    const r = parseBackup(wrap(data));
    assert.equal(r.ok, true);
    assert.equal(r.data.periods[0].pl.sales, 100);
    assert.equal(r.data.periods[0].pl.netIncome, null);
    assert.deepEqual(r.data.periods[0].adjustments, []);
  });
  test('マイナス値・小数は許容', () => {
    const d = getSampleData();
    d.periods[0].bs.netAssets = -1234.5;
    assert.equal(parseBackup(wrap(d)).ok, true);
  });
});

describe('インポートの検証：異常系（読み込まずにエラー）', () => {
  const cases = [
    ['空文字', '', /空/],
    ['JSONでない', '{oops', /JSON形式ではありません/],
    ['配列', '[]', /バックアップファイルではありません/],
    ['format が違う', JSON.stringify({ format: 'other', formatVersion: 1, data: getSampleData() }), /バックアップファイルではありません/],
    ['データ本体だけ（ラッパーなし）', JSON.stringify(getSampleData()), /バックアップファイルではありません/],
    ['formatVersion が未対応', wrap(getSampleData(), { formatVersion: 99 }), /対応していないバックアップ形式/],
    ['data がない', wrap(undefined), /形式が正しくありません/],
    ['data.version が未対応', wrap({ ...getSampleData(), version: 2 }), /対応していないデータのバージョン/],
    ['data.version がない', wrap({ companyName: '', periods: [] }), /対応していないデータのバージョン/],
    ['periods がない', wrap({ version: 1 }), /periods がありません/],
    ['periods が0件', wrap({ version: 1, periods: [] }), /期の数が不正/],
    ['periods が6件', wrap({ version: 1, periods: Array.from({ length: 6 }, () => ({ pl: {}, bs: {} })) }), /期の数が不正/],
    ['金額が文字列', wrap({ version: 1, periods: [{ pl: { sales: '100' }, bs: {} }] }), /pl\.sales が数値ではありません/],
    ['金額が NaN 相当（文字列）', wrap({ version: 1, periods: [{ pl: {}, bs: { cash: 'NaN' } }] }), /bs\.cash/],
    ['pl がない', wrap({ version: 1, periods: [{ bs: {} }] }), /pl がありません/],
    ['期名が数値', wrap({ version: 1, periods: [{ label: 2025, pl: {}, bs: {} }] }), /label が文字列ではありません/],
    ['会社名が数値', wrap({ version: 1, companyName: 1, periods: [{ pl: {}, bs: {} }] }), /companyName/],
    ['adjustments が配列でない', wrap({ version: 1, periods: [{ pl: {}, bs: {}, adjustments: {} }] }), /adjustments が配列ではありません/],
  ];
  for (const [name, text, re] of cases) {
    test(name, () => {
      const r = parseBackup(text);
      assert.equal(r.ok, false);
      assert.equal(r.data, undefined);
      assert.match(r.error, re);
    });
  }
  test('validateData：正常なら空配列', () => {
    assert.deepEqual(validateData(getSampleMultiData()), []);
    assert.deepEqual(validateData(createEmptyData()), []);
  });
});

describe('最終バックアップ日時と案内', () => {
  test('保存と読込', () => {
    const st = memoryStorage();
    assert.equal(getLastBackupAt(st), null);
    assert.equal(setLastBackupAt(NOW, st), true);
    assert.equal(getLastBackupAt(st).toISOString(), NOW.toISOString());
  });
  test('不正な値・storage 例外でも止まらない', () => {
    assert.equal(getLastBackupAt(memoryStorage({ [LAST_BACKUP_KEY]: 'xxx' })), null);
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    assert.equal(getLastBackupAt(bad), null);
    assert.equal(setLastBackupAt(NOW, bad), false);
    assert.equal(getLastBackupAt(null), null);
  });
  test('30日以上経過で案内、29日なら案内しない', () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal(needsBackupReminder(new Date(NOW - 30 * day), true, NOW), true);
    assert.equal(needsBackupReminder(new Date(NOW - 29 * day), true, NOW), false);
    assert.equal(needsBackupReminder(null, true, NOW), true);
    assert.equal(needsBackupReminder(null, false, NOW), false);
    assert.equal(needsBackupReminder(new Date(NOW - 100 * day), false, NOW), false);
  });
  test('hasAnyData', () => {
    assert.equal(hasAnyData(createEmptyData()), false);
    assert.equal(hasAnyData(getSampleData()), true);
    const d = createEmptyData();
    d.periods[0].bs.cash = 0;
    assert.equal(hasAnyData(d), true);
  });
});
