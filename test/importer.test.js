import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IGNORE, MAX_IMPORT_MAP, IMPORT_TARGETS, normalizeLabel, suggestTarget, decodeCsvBytes, parseCsv, parseCell,
  extractItems, prepareImport, buildImport, applyImportToPeriod, updateImportMap, normalizeImportMap,
} from '../js/importer.js';
import { PL_FIELDS, BS_FIELDS } from '../js/calc.js';

describe('CSVの読み取り', () => {
  test('カンマ区切り・囲み文字・改行（CRLF）', () => {
    assert.deepEqual(parseCsv('科目,金額\r\n売上高,"1,000"\r\n"A ""B""",2'), [['科目', '金額'], ['売上高', '1,000'], ['A "B"', '2']]);
    assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv(null), []);
  });
  test('タブ区切りも読める（Excelからの貼り付け）', () => {
    assert.deepEqual(parseCsv('売上高\t1,000\n営業利益\t50'), [['売上高', '1,000'], ['営業利益', '50']]);
  });
  test('文字コード：UTF-8（BOM付き）と Shift_JIS', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('売上高,1')]);
    assert.equal(decodeCsvBytes(utf8), '売上高,1');
    // 「売上」の Shift_JIS
    const sjis = new Uint8Array([0x94, 0x84, 0x8f, 0xe3, 0x2c, 0x31]);
    assert.equal(decodeCsvBytes(sjis), '売上,1');
  });
  test('金額のセル：カンマ・円記号・△・かっこ・全角', () => {
    assert.equal(parseCell('1,234'), 1234);
    assert.equal(parseCell('¥1,234円'), 1234);
    assert.equal(parseCell('△500'), -500);
    assert.equal(parseCell('(500)'), -500);
    assert.equal(parseCell('１２３'), 123);
    assert.equal(parseCell('売上高'), null);
    assert.equal(parseCell(''), null);
  });
  test('行から科目名と金額（最後の数値の列）を取り出す。見出し・空行は除く', () => {
    const items = extractItems(parseCsv('科目,前期,当期\n売上高,900,1000\n,,\n【売上原価】\n営業利益,,50'));
    assert.deepEqual(items, [
      { line: 2, label: '売上高', amount: 1000 },
      { line: 5, label: '営業利益', amount: 50 },
    ]);
  });
});

describe('科目の対応付け', () => {
  test('科目名の正規化：空白・番号・記号・全角を整える', () => {
    assert.equal(normalizeLabel(' Ⅰ．売 上 高 '), '売上高');
    assert.equal(normalizeLabel('(1) 現金及び預金'), '現金及び預金');
    assert.equal(normalizeLabel('【資産合計】'), '資産合計');
    assert.equal(normalizeLabel('１年内返済予定の長期借入金'), '1年内返済予定の長期借入金');
    assert.equal(normalizeLabel('一年内返済予定の長期借入金'), '一年内返済予定の長期借入金');
  });
  test('よく使う科目名は自動で対応。損失の科目は符号を反転', () => {
    assert.deepEqual(suggestTarget('売上高'), { target: 'pl.sales', sign: 1, from: 'auto' });
    assert.deepEqual(suggestTarget('販売費及び一般管理費合計'), { target: 'pl.sga', sign: 1, from: 'auto' });
    assert.deepEqual(suggestTarget('経常損失'), { target: 'pl.ordinaryIncome', sign: -1, from: 'auto' });
    assert.deepEqual(suggestTarget('雑収入'), { target: IGNORE, sign: 1, from: 'none' });
  });
  test('保存した対応表が優先される', () => {
    assert.deepEqual(suggestTarget('売上高', { 売上高: IGNORE }), { target: IGNORE, sign: 1, from: 'saved' });
    assert.deepEqual(suggestTarget('製品売上', { 製品売上: 'pl.sales' }), { target: 'pl.sales', sign: 1, from: 'saved' });
    assert.equal(suggestTarget('製品売上', { 製品売上: 'pl.nope' }).from, 'none');
  });
  test('合計と内訳が両方あるときは合計だけを自動で選ぶ（二重計上を防ぐ）', () => {
    const csv = '現金,100\n普通預金,200\n現金及び預金合計,300\n売掛金,50\n受取手形,30\n短期借入金,10\n長期借入金,20\n売上高,1000\n売上高合計,1000';
    const items = prepareImport(csv);
    const byLabel = Object.fromEntries(items.map((it) => [it.label, it]));
    assert.equal(byLabel['現金'].target, IGNORE);
    assert.equal(byLabel['現金'].from, 'dedup');
    assert.equal(byLabel['普通預金'].target, IGNORE);
    assert.equal(byLabel['現金及び預金合計'].target, 'bs.cash');
    assert.equal(byLabel['売上高'].target, IGNORE);
    assert.equal(byLabel['売上高合計'].target, 'pl.sales');
    const r = buildImport(items, 'thousand');
    assert.deepEqual(r.bs, { cash: 300, receivables: 80, interestBearingDebt: 30 });
    assert.deepEqual(r.pl, { sales: 1000 });
  });
  test('取込先は入力項目のすべて', () => {
    assert.equal(IMPORT_TARGETS.length, PL_FIELDS.length + BS_FIELDS.length);
  });
});

describe('取込結果', () => {
  test('単位の換算（円→千円・百万円→千円）と損失の符号', () => {
    const items = [
      { label: '売上高', amount: 12345678, target: 'pl.sales', sign: 1 },
      { label: '営業損失', amount: 1500, target: 'pl.operatingIncome', sign: -1 },
      { label: '雑収入', amount: 1, target: IGNORE, sign: 1 },
    ];
    assert.deepEqual(buildImport(items, 'yen'), { pl: { sales: 12345.678, operatingIncome: -1.5 }, bs: {}, used: 2 });
    assert.deepEqual(buildImport(items, 'million').pl, { sales: 12345678000, operatingIncome: -1500000 });
  });
  test('浮動小数の誤差をならす', () => {
    const items = [0.1, 0.2].map((amount) => ({ label: 'x', amount, target: 'bs.cash', sign: 1 }));
    assert.equal(buildImport(items, 'thousand').bs.cash, 0.3);
  });
  test('取り込んだ項目だけ上書きし、ほかの入力・調整項目はそのまま', () => {
    const period = { label: '2025年3月期', pl: { sales: 1, sga: 9 }, bs: { cash: 2 }, adjustments: [{ name: 'a' }] };
    const next = applyImportToPeriod(period, { pl: { sales: 100 }, bs: { cash: 5, inventory: 3 } });
    assert.deepEqual(next, { label: '2025年3月期', pl: { sales: 100, sga: 9 }, bs: { cash: 5, inventory: 3 }, adjustments: [{ name: 'a' }] });
    assert.deepEqual(period.pl, { sales: 1, sga: 9 });
  });
});

describe('対応表の保存', () => {
  test('利用者が選び直した行だけを保存する', () => {
    const items = [
      { label: '製品売上', target: 'pl.sales', from: 'user' },
      { label: '雑収入', target: IGNORE, from: 'user' },
      { label: '売上高', target: 'pl.sales', from: 'auto' },
      { label: '現金', target: IGNORE, from: 'dedup' },
      { label: '不明', target: 'pl.nope', from: 'user' },
    ];
    assert.deepEqual(updateImportMap({ 旧科目: 'bs.cash' }, items), { 旧科目: 'bs.cash', 製品売上: 'pl.sales', 雑収入: IGNORE });
  });
  test('保存件数の上限（古いものから消す）', () => {
    const map = Object.fromEntries(Array.from({ length: MAX_IMPORT_MAP }, (_, i) => [`k${i}`, IGNORE]));
    const next = updateImportMap(map, [{ label: '新科目', target: 'pl.sales', from: 'user' }]);
    assert.equal(Object.keys(next).length, MAX_IMPORT_MAP);
    assert.equal(next.k0, undefined);
    assert.equal(next['新科目'], 'pl.sales');
  });
  test('不正な対応表は空または有効な値だけにする', () => {
    assert.deepEqual(normalizeImportMap(null), {});
    assert.deepEqual(normalizeImportMap([1]), {});
    assert.deepEqual(normalizeImportMap({ a: 'bs.cash', b: 'x', c: IGNORE }), { a: 'bs.cash', c: IGNORE });
  });
});
