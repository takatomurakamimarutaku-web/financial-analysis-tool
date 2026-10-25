// 会計ソフト別プリセット・見出し行による列の判定。test/fixtures の CSV は自作のダミー（実際のソフトの出力ではない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSV_PRESETS, COLUMN_ALIASES, PRESET_NOTICE, presetById } from '../js/import-presets.js';
import {
  IGNORE, analyzeImport, buildImport, classifyHeader, decodeCsv, detectColumns, normalizeHeader, parseCsv, prepareImport, sideOf,
} from '../js/importer.js';

const fixture = (name) => decodeCsv(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));

test('プリセットは5社で、すべて未検証', () => {
  assert.deepEqual(CSV_PRESETS.map((p) => p.id), ['yayoi', 'bugyo', 'tkc', 'freee', 'moneyforward']);
  for (const p of CSV_PRESETS) {
    assert.equal(p.verified, false, p.id);
    assert.ok(p.howTo.length >= 2, p.id);
  }
  assert.match(PRESET_NOTICE, /未検証/);
  assert.equal(presetById('freee').name, 'freee会計');
  assert.equal(presetById('none'), null);
});

test('見出しの名前の判定', () => {
  assert.equal(normalizeHeader(' 期末残高（円） '), '期末残高');
  assert.equal(classifyHeader('勘定科目').role, 'label');
  assert.equal(classifyHeader('勘定科目コード').role, 'code');
  assert.equal(classifyHeader('補助科目').role, 'sub');
  assert.equal(classifyHeader('期首残高').role, 'opening');
  assert.equal(classifyHeader('当期残高(円)').role, 'closing');
  assert.equal(classifyHeader('借方残高').role, 'debitBalance');
  assert.equal(classifyHeader('借方発生').role, 'debit');
  assert.equal(classifyHeader('構成比率').role, 'ratio');
  assert.equal(classifyHeader('前期末残高').role, 'opening');
  assert.equal(classifyHeader(''), null);
  assert.equal(classifyHeader('メモ'), null);
  for (const list of Object.values(COLUMN_ALIASES)) assert.ok(list.length > 0);
});

test('文字コードの判定（Shift_JIS・UTF-8 BOM・UTF-16）', () => {
  assert.equal(fixture('dummy-yayoi.csv').encoding, 'Shift_JIS');
  assert.equal(fixture('dummy-freee.csv').encoding, 'UTF-8');
  assert.ok(!fixture('dummy-freee.csv').text.startsWith('﻿'));
  const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...'科目,金額'].map((c) => c.charCodeAt(0))).buffer)]);
  assert.deepEqual(decodeCsv(utf16), { text: '科目,金額', encoding: 'UTF-16' });
});

test('弥生会計のダミー：表題行を飛ばし、当期残高の列を使う（構成比は使わない）', () => {
  const { text } = fixture('dummy-yayoi.csv');
  const cols = detectColumns(parseCsv(text));
  assert.equal(cols.headerIndex, 3);
  assert.equal(cols.names[cols.amount], '当期残高');
  const items = prepareImport(text);
  assert.deepEqual(items.map((i) => [i.label, i.amount]), [
    ['現金', 150000], ['普通預金', 3000000], ['現金・預金合計', 3150000], ['売掛金', 1500000], ['流動資産合計', 6000000], ['売上高', 12000000], ['当期純損失', 300000],
  ]);
  const r = buildImport(items, 'yen');
  assert.deepEqual(r.bs, { cash: 3150, receivables: 1500, currentAssets: 6000 });
  assert.deepEqual(r.pl, { sales: 12000, netIncome: -300 });
});

test('勘定奉行のダミー：科目名が金額の列の間にあり、借方残高・貸方残高から取込先の側で金額を決める', () => {
  const { text } = fixture('dummy-bugyo.csv');
  const a = analyzeImport(text);
  assert.equal(a.columns.amount, null);
  assert.equal(a.columns.names[a.columns.label], '勘定科目');
  assert.equal(a.columns.names[a.columns.code], '勘定科目コード');
  const by = Object.fromEntries(a.items.map((i) => [i.label, i]));
  assert.equal(by['現金'].amount, 150000);
  assert.equal(by['買掛金'].amount, 800000);
  const r = buildImport(a.items, 'yen');
  assert.deepEqual(r.bs, { cash: 150, receivables: 1500, payables: 800 });
  assert.deepEqual(r.pl, { sales: 12000, costOfSales: 7000 });
  // 借方残高の純資産（マイナスの純資産）は取込先が貸方の側なのでマイナスになる
  const eq = buildImport([{ ...by['繰越利益剰余金'], target: 'bs.netAssets' }], 'yen');
  assert.equal(eq.bs.netAssets, -100);
  assert.equal(sideOf('bs.netAssets'), 'credit');
  assert.equal(sideOf('bs.cash'), 'debit');
});

test('TKC のダミー：科目コードの列を金額と取り違えない', () => {
  const { text } = fixture('dummy-tkc.csv');
  const items = prepareImport(text);
  assert.deepEqual(items.map((i) => [i.label, i.amount]), [
    ['現金預金', 3150000], ['受取手形', 200000], ['売掛金', 1500000], ['売上高', 12000000], ['減価償却費', 400000],
  ]);
  const r = buildImport(items, 'yen');
  assert.deepEqual(r.bs, { cash: 3150, receivables: 1700 });
  assert.deepEqual(r.pl, { sales: 12000, depreciation: 400 });
});

test('freee のダミー：分類と勘定科目が別の列でも、右端の科目名を使う', () => {
  const { text } = fixture('dummy-freee.csv');
  const a = analyzeImport(text);
  assert.deepEqual(a.columns.labels, [0, 1, 2]);
  assert.deepEqual(a.items.map((i) => [i.label, i.amount]), [
    ['現金', 150000], ['普通預金', 3000000], ['現金・預金 合計', 3150000], ['流動資産 合計', 6000000], ['資産 合計', 10000000],
  ]);
  const r = buildImport(a.items, 'yen');
  assert.deepEqual(r.bs, { cash: 3150, currentAssets: 6000, totalAssets: 10000 });
});

test('マネーフォワードのダミー：補助科目の行は二重になるため除く', () => {
  const { text } = fixture('dummy-moneyforward.csv');
  const items = prepareImport(text);
  assert.deepEqual(items.map((i) => [i.label, i.amount]), [
    ['普通預金', 3000000], ['短期借入金', 800000], ['長期借入金', 2500000], ['純資産の部合計', 4500000],
  ]);
  const r = buildImport(items, 'yen');
  assert.deepEqual(r.bs, { cash: 3000, interestBearingDebt: 3300, netAssets: 4500 });
});

test('利用者が列の割り当てを変えると、その列で読み直す', () => {
  const { text } = fixture('dummy-tkc.csv');
  const a = analyzeImport(text);
  const opening = a.columns.names.indexOf('期首残高');
  const b = analyzeImport(text, {}, { columns: { ...a.columns, amount: opening } });
  assert.equal(b.items.find((i) => i.label === '売掛金').amount, 1000000);
});

test('見出し行がない CSV は従来の読み方（最初の文字・最後の数値）', () => {
  const items = prepareImport('売上高,1000\r\n現金,200\r\n');
  assert.deepEqual(items.map((i) => [i.label, i.amount, i.target]), [['売上高', 1000, 'pl.sales'], ['現金', 200, 'bs.cash']]);
  assert.equal(analyzeImport('売上高,1000').columns, null);
  assert.ok(items.every((i) => i.target !== IGNORE));
});
