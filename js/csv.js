// CSV出力（DOMに依存しない純粋関数）
// Excel で文字化けしないよう、BOM 付き UTF-8・改行は CRLF で出力する。
// 金額は設定の表示単位（data.settings.unit。既定は千円）で出力する。
import {
  isNum, buildComparison, buildEbitdaBridge, buildNetDebtBreakdown, categoryName, CATEGORIES,
} from './calc.js';
import { unitOf, arrangeComparisonRows, rowLabel } from './settings.js';

export const BOM = '﻿';

// 1つの値を CSV のフィールドにする。カンマ・ダブルクォート・改行を含む場合は "" で囲み、" は "" にする。
// 数式として解釈されないよう、= + - @ で始まる文字列の先頭には ' を付ける（数値は対象外）。
export function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

export function withBom(csv) {
  return BOM + csv;
}

// 浮動小数点の誤差（0.07 * 100 = 7.000000000000001 など）だけを取り除く。表示用の丸めではない。
export function cleanNumber(v) {
  return isNum(v) ? Number(v.toPrecision(12)) : null;
}

// 単位に応じた出力値：% はパーセント値（× 100）、金額（千円）は表示単位に換算
function scaled(v, unit, scale) {
  if (unit === '%') return cleanNumber(v * 100);
  if (unit === '千円') return cleanNumber(v * scale);
  return cleanNumber(v);
}

function csvValue(result, unit, scale = 1) {
  if (!result) return '';
  if (result.status === 'notApplicable') return '参考外';
  if (result.status !== 'ok' || !isNum(result.value)) return '';
  return scaled(result.value, unit, scale);
}

function changeAmount(change, unit, scale) {
  if (!change || !isNum(change.amount)) return '';
  return scaled(change.amount, unit, scale);
}

function changeRate(change) {
  if (!change) return '';
  if (change.rateStatus === 'notApplicable') return '参考外';
  if (change.rateStatus !== 'ok') return '';
  return cleanNumber(change.rate * 100);
}

const GROUP_NAMES = {
  amounts: '主要数値',
  ...Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name])),
};

function periodLabels(data) {
  return (data?.periods ?? []).map((p, i) => p.label || `第${i + 1}期`);
}

// 比較表 CSV。列：区分, 指標, 単位, 各期の値, 2期目以降の 増減額・増減率(%)
export function buildComparisonCsv(data, basis = 'end') {
  const cmp = buildComparison(data, basis);
  const u = unitOf(data?.settings);
  const labels = periodLabels(data);
  const header = ['区分', '指標', '単位', ...labels];
  labels.slice(1).forEach((l) => header.push(`${l} 増減額`, `${l} 増減率(%)`));
  const rows = [header];
  for (const r of arrangeComparisonRows(data?.settings, cmp.rows)) {
    const unit = r.unit === '千円' ? u.name : r.unit;
    const line = [GROUP_NAMES[r.group] ?? '', rowLabel(data?.settings, r), unit, ...r.cells.map((c) => csvValue(c.result, r.unit, u.scale))];
    r.cells.slice(1).forEach((c) => line.push(changeAmount(c.change, r.unit, u.scale), changeRate(c.change)));
    rows.push(line);
  }
  const note = basis === 'average'
    ? '平均残高ベース（ROA・ROE・回転日数・CCC）。平均残高=(前期末+当期末)÷2'
    : '期末残高ベース';
  rows.push([]);
  rows.push(['注記', `金額単位：${u.name}。%の指標はパーセント値。${note}。%指標の増減額はポイント。`]);
  return withBom(toCsv(rows));
}

// EBITDAブリッジ CSV。上段：ブリッジ表、下段：調整項目の明細（根拠メモを含む）
export function buildBridgeCsv(data) {
  const b = buildEbitdaBridge(data);
  const u = unitOf(data?.settings);
  const labels = periodLabels(data);
  const rows = [['項目', '単位', ...labels]];
  for (const r of b.rows) {
    rows.push([r.name, r.unit === '千円' ? u.name : r.unit, ...r.values.map((v) => (isNum(v) ? scaled(v, r.unit, u.scale) : ''))]);
  }
  rows.push([]);
  rows.push(['調整項目の明細']);
  rows.push(['期', '区分', '内容', `金額（${u.name}）`, '根拠メモ']);
  (data?.periods ?? []).forEach((p, i) => {
    for (const a of p.adjustments ?? []) {
      rows.push([labels[i], categoryName(a.category, data?.settings?.adjustmentCategoryNames), a.description ?? '', isNum(a.amount) ? scaled(a.amount, '千円', u.scale) : '', a.memo ?? '']);
    }
  });
  rows.push([]);
  rows.push(['注記', '正常化EBITDA = 報告EBITDA（営業利益+減価償却費）+ 調整額合計。金額未入力の調整項目は合計に含めない。']);
  return withBom(toCsv(rows));
}

// ネットデット内訳 CSV。上段：内訳表、下段：デットライク・キャッシュライク項目の明細
export function buildNetDebtCsv(data) {
  const b = buildNetDebtBreakdown(data);
  const u = unitOf(data?.settings);
  const amt = (v) => (isNum(v) ? scaled(v, '千円', u.scale) : '');
  const labels = periodLabels(data);
  const rows = [['項目', ...labels]];
  for (const r of b.rows) rows.push([r.name, ...r.values.map(amt)]);
  rows.push(['調整後ネットデット ÷ 正常化EBITDA（倍）', ...b.multiples.map((m) => csvValue(m, '倍'))]);
  rows.push([]);
  rows.push(['項目の明細']);
  rows.push(['期', '種類', '名称', `金額（${u.name}）`, '根拠メモ']);
  (data?.periods ?? []).forEach((p, i) => {
    for (const it of p.debtLikeItems ?? []) rows.push([labels[i], 'デットライク（加算）', it.name ?? '', amt(it.amount), it.memo ?? '']);
    for (const it of p.cashLikeItems ?? []) rows.push([labels[i], 'キャッシュライク（減算）', it.name ?? '', amt(it.amount), it.memo ?? '']);
  });
  rows.push([]);
  rows.push(['注記', `金額単位：${u.name}。調整後ネットデット = 有利子負債 + デットライク項目 − 現預金 − キャッシュライク項目。現預金・キャッシュライク項目は減算のため負の値で表示。`]);
  return withBom(toCsv(rows));
}

// ファイル名は英数字のみ（日本語のファイル名は環境によって「download」などに置き換わるため）
export const CSV_KINDS = {
  comparison: '比較表',
  bridge: 'EBITDAブリッジ',
  netDebt: 'ネットデット内訳',
};

export function csvFileName(kind, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const slug = { comparison: 'comparison', bridge: 'ebitda-bridge', netDebt: 'net-debt' }[kind] ?? 'data';
  return `fin-tool-${slug}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
