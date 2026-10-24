import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOM, escapeCsvField, toCsv, withBom, cleanNumber,
  buildComparisonCsv, buildBridgeCsv, buildNetDebtCsv, csvFileName,
} from '../js/csv.js';
import { getSampleData, getSampleMultiData, createEmptyData } from '../js/store.js';

// テスト用の簡易 CSV パーサ（RFC 4180 相当）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

describe('CSVのエスケープ', () => {
  test('通常の文字列・数値はそのまま', () => {
    assert.equal(escapeCsvField('売上高'), '売上高');
    assert.equal(escapeCsvField(12345.5), '12345.5');
    assert.equal(escapeCsvField(-800), '-800');
    assert.equal(escapeCsvField(0), '0');
  });
  test('null・undefined・NaN は空欄', () => {
    assert.equal(escapeCsvField(null), '');
    assert.equal(escapeCsvField(undefined), '');
    assert.equal(escapeCsvField(NaN), '');
    assert.equal(escapeCsvField(Infinity), '');
  });
  test('カンマを含む → ダブルクォートで囲む', () => {
    assert.equal(escapeCsvField('1,000千円'), '"1,000千円"');
  });
  test('改行（LF・CRLF・CR）を含む → 囲む', () => {
    assert.equal(escapeCsvField('1行目\n2行目'), '"1行目\n2行目"');
    assert.equal(escapeCsvField('a\r\nb'), '"a\r\nb"');
    assert.equal(escapeCsvField('a\rb'), '"a\rb"');
  });
  test('ダブルクォートを含む → "" に置き換えて囲む', () => {
    assert.equal(escapeCsvField('「"A"社」'), '"「""A""社」"');
    assert.equal(escapeCsvField('"'), '""""');
  });
  test('カンマ・改行・ダブルクォートの組み合わせ', () => {
    assert.equal(escapeCsvField('a,"b"\nc'), '"a,""b""\nc"');
  });
  test('数式として解釈される文字列の先頭に \' を付ける（数値は対象外）', () => {
    assert.equal(escapeCsvField('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(escapeCsvField('+1'), "'+1");
    assert.equal(escapeCsvField('-1+2'), "'-1+2");
    assert.equal(escapeCsvField('@x'), "'@x");
    assert.equal(escapeCsvField('=A1,B1'), `"'=A1,B1"`);
  });
  test('toCsv：CRLF 区切り・末尾も CRLF、往復で元に戻る', () => {
    const rows = [['項目', '値'], ['a,b', 'x"y'], ['改行\nあり', 1.5], [null, '']];
    const csv = toCsv(rows);
    assert.ok(csv.endsWith('\r\n'));
    assert.equal(csv.split('\r\n').length, 5);
    assert.deepEqual(parseCsv(csv), [['項目', '値'], ['a,b', 'x"y'], ['改行\nあり', '1.5'], ['', '']]);
  });
  test('BOM 付き UTF-8', () => {
    assert.equal(BOM, '﻿');
    assert.ok(withBom('a\r\n').startsWith('﻿'));
    assert.deepEqual([...Buffer.from(withBom(''), 'utf8')], [0xef, 0xbb, 0xbf]);
  });
  test('cleanNumber：誤差のみ除去（丸めない）', () => {
    assert.equal(cleanNumber(0.07 * 100), 7);
    assert.equal(cleanNumber(1 / 3), 0.333333333333);
    assert.equal(cleanNumber(null), null);
  });
});

describe('CSVの内容', () => {
  test('比較表：BOM・見出し・期の列・前期比の列', () => {
    const csv = buildComparisonCsv(getSampleMultiData());
    assert.ok(csv.startsWith(BOM));
    const rows = parseCsv(csv.slice(1));
    assert.deepEqual(rows[0], ['区分', '指標', '単位', '2023/3期', '2024/3期', '2025/3期',
      '2024/3期 増減額', '2024/3期 増減率(%)', '2025/3期 増減額', '2025/3期 増減率(%)']);
    const sales = rows.find((r) => r[1] === '売上高');
    assert.deepEqual(sales.slice(0, 6), ['主要数値', '売上高', '千円', '82000', '91000', '100000']);
    assert.equal(sales[6], '9000');
    const om = rows.find((r) => r[1] === '営業利益率');
    assert.equal(om[5], '10');       // % はパーセント値
    assert.equal(om[8], String(cleanNumber((0.1 - 7490 / 91000) * 100))); // 8.23…% → 10.0%：+1.769…pt（丸めない）
    assert.ok(rows.some((r) => r[0] === '注記'));
  });
  test('比較表：計算できない値は空欄、参考外は「参考外」', () => {
    const d = getSampleData();
    d.periods[0].bs.netAssets = -1000;
    d.periods[0].pl.interestExpense = 0;
    const rows = parseCsv(buildComparisonCsv(d).slice(1));
    assert.equal(rows.find((r) => r[1].startsWith('ROE'))[3], '参考外');
    assert.equal(rows.find((r) => r[1].startsWith('インタレスト'))[3], '');
  });
  test('比較表：会社名・メモにカンマや改行があっても壊れない（明細）', () => {
    const d = getSampleMultiData();
    d.periods[2].adjustments[0].memo = '水準は"15,000千円"\n出典：同業調査';
    const rows = parseCsv(buildBridgeCsv(d).slice(1));
    const detail = rows.find((r) => r[2] === 'オーナー役員報酬を市場水準に調整' && r[0] === '2025/3期');
    assert.equal(detail[4], '水準は"15,000千円"\n出典：同業調査');
  });
  test('EBITDAブリッジ：行と値', () => {
    const rows = parseCsv(buildBridgeCsv(getSampleMultiData()).slice(1));
    assert.deepEqual(rows[0], ['項目', '単位', '2023/3期', '2024/3期', '2025/3期']);
    assert.deepEqual(rows.find((r) => r[0] === '正常化EBITDA'), ['正常化EBITDA', '千円', '11860', '13090', '18400']);
    assert.deepEqual(rows.find((r) => r[0] === '一過性の損益'), ['一過性の損益', '千円', '0', '-1500', '1200']);
    assert.equal(rows.find((r) => r[0] === '正常化EBITDAマージン')[4], '18.4');
    assert.equal(rows.filter((r) => /^20\d\d\/3期$/.test(r[0]) && r.length === 5).length, 6); // 明細 6 件（1 + 2 + 3）
  });
  test('ネットデット内訳：行と値・明細', () => {
    const rows = parseCsv(buildNetDebtCsv(getSampleMultiData()).slice(1));
    assert.deepEqual(rows.find((r) => r[0] === '調整後ネットデット'), ['調整後ネットデット', '32600', '25800', '22500']);
    assert.deepEqual(rows.find((r) => r[0] === '現預金（減算）'), ['現預金（減算）', '-14000', '-17000', '-20000']);
    assert.deepEqual(rows.find((r) => r[0] === '未払法人税等（加算）'), ['未払法人税等（加算）', '', '', '1500']);
    const m = rows.find((r) => r[0].startsWith('調整後ネットデット ÷'));
    assert.equal(Number(m[3]).toFixed(4), (22500 / 18400).toFixed(4));
    assert.ok(rows.some((r) => r[1] === 'キャッシュライク（減算）' && r[2] === '定期預金'));
  });
  test('空データでも生成できる', () => {
    for (const fn of [buildComparisonCsv, buildBridgeCsv, buildNetDebtCsv]) {
      const csv = fn(createEmptyData());
      assert.ok(csv.startsWith(BOM));
      assert.ok(parseCsv(csv.slice(1)).length > 2);
    }
  });
  test('ファイル名：英数字と日付のみ', () => {
    const d = new Date(2026, 9, 24);
    assert.equal(csvFileName('comparison', d), 'fin-tool-comparison-2026-10-24.csv');
    assert.equal(csvFileName('bridge', d), 'fin-tool-ebitda-bridge-2026-10-24.csv');
    assert.equal(csvFileName('netDebt', d), 'fin-tool-net-debt-2026-10-24.csv');
    assert.match(csvFileName('x', d), /^[\x20-\x7e]+$/);
  });
});
