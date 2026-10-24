import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildXlsx, buildZip, columnName, crc32, sheetNames, sheetXml, xmlEscape } from '../js/xlsx.js';
import { buildWorkbookSheets, xlsxFileName } from '../js/csv.js';
import { getSampleMultiData } from '../js/store.js';

// 無圧縮 ZIP を読む（テスト用）。中央ディレクトリから各ファイルを取り出し、CRC を確かめる
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endPos = bytes.length - 22;
  assert.equal(dv.getUint32(endPos, true), 0x06054b50, '終端レコード');
  const count = dv.getUint16(endPos + 10, true);
  let p = dv.getUint32(endPos + 16, true);
  const out = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, '中央ディレクトリ');
    assert.equal(dv.getUint16(p + 10, true), 0, '無圧縮');
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(off, true), 0x04034b50, 'ローカルヘッダー');
    const localNameLen = dv.getUint16(off + 26, true);
    const data = bytes.subarray(off + 30 + localNameLen, off + 30 + localNameLen + size);
    assert.equal(crc32(data), crc, `${name} の CRC`);
    out.set(name, new TextDecoder().decode(data));
    p += 46 + nameLen;
  }
  return out;
}

test('CRC-32 は zlib と一致する', () => {
  for (const s of ['', 'a', 'hello world', '数字のミカタ'.repeat(100)]) {
    const b = new TextEncoder().encode(s);
    assert.equal(crc32(b), zlib.crc32(b), s.slice(0, 10));
  }
});

test('ZIP の往復', () => {
  const zip = buildZip([{ name: 'a.txt', data: 'abc' }, { name: 'フォルダ/b.xml', data: '<x/>' }], new Date(2026, 9, 24, 12, 34, 56));
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ['a.txt', 'フォルダ/b.xml']);
  assert.equal(files.get('a.txt'), 'abc');
});

test('XML のエスケープと制御文字の除去', () => {
  assert.equal(xmlEscape('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(xmlEscape('a\u0001b\tc'), 'ab\tc');
});

test('列名', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('シート名：禁止文字・31文字・重複', () => {
  assert.deepEqual(sheetNames(['比較表', 'a/b[c]', '比較表', '']), ['比較表', 'a・b・c・', '比較表(2)', 'Sheet']);
  assert.equal(sheetNames(['x'.repeat(40)])[0].length, 31);
});

test('セル：数値は数値、文字列はインライン文字列（数式にならない）', () => {
  const xml = sheetXml([['見出し', 1], ['=SUM(A1)', 1234, 0.5, null, '']]);
  assert.match(xml, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">見出し<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="B1" s="1"><v>1<\/v><\/c>/);
  assert.match(xml, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">=SUM\(A1\)<\/t>/);
  assert.match(xml, /<c r="B2" s="2"><v>1234<\/v><\/c>/);
  assert.match(xml, /<c r="C2" s="3"><v>0.5<\/v><\/c>/);
  assert.ok(!xml.includes('<f>'), '数式を書かない');
  assert.ok(!xml.includes('r="D2"'), '空のセルは書かない');
});

test('サンプルデータの xlsx：必要な部品と4シート', () => {
  const data = getSampleMultiData();
  const now = new Date(2026, 9, 24, 9, 0);
  const sheets = buildWorkbookSheets(data, 'end', { now, appVersion: 'v28' });
  assert.deepEqual(sheets.map((s) => s.name), ['概要', '比較表', 'EBITDAブリッジ', 'ネットデット内訳']);
  const files = readZip(buildXlsx(sheets, now));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'docProps/core.xml', 'xl/worksheets/sheet4.xml']) {
    assert.ok(files.has(name), name);
  }
  assert.match(files.get('xl/workbook.xml'), /<sheet name="比較表" sheetId="2" r:id="rId2"\/>/);
  assert.match(files.get('[Content_Types].xml'), /sheet4\.xml/);
  // 比較表の売上高は数値のセル（CSV の値と同じ）
  const cmp = sheets[1].rows;
  const salesRow = cmp.find((r) => r[1] === '売上高');
  assert.equal(typeof salesRow[3], 'number');
  assert.match(files.get('xl/worksheets/sheet2.xml'), new RegExp(`<v>${salesRow[3]}</v>`));
  assert.match(files.get('xl/worksheets/sheet1.xml'), /v28/);
  assert.equal(xlsxFileName(now), 'fin-tool-analysis-2026-10-24.xlsx');
});
