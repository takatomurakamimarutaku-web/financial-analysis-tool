// 試算表・決算書CSVの取込（科目名と金額の汎用形式）。DOMに依存しない純粋関数。
// 1行に「科目名」と「金額」があるCSVを読み、科目を入力項目に対応付けて、選択中の期に入れる。
// 対応表（科目名 → 入力項目）はワークスペースに保存して次回以降に再利用する。
import { PL_FIELDS, BS_FIELDS, parseAmount, isNum } from './calc.js';

export const IGNORE = 'ignore';
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_MAP = 1000;
export const IMPORT_UNITS = [
  { id: 'yen', name: '円', toThousand: 0.001 },
  { id: 'thousand', name: '千円', toThousand: 1 },
  { id: 'million', name: '百万円', toThousand: 1000 },
];

// 取込先の候補（section と key）。表示名は標準名
export const IMPORT_TARGETS = [
  ...PL_FIELDS.map((f) => ({ id: `pl.${f.key}`, section: 'pl', key: f.key, label: f.label })),
  ...BS_FIELDS.map((f) => ({ id: `bs.${f.key}`, section: 'bs', key: f.key, label: f.label })),
];
const TARGET_IDS = new Set(IMPORT_TARGETS.map((t) => t.id));

// 科目名の候補。totals = 合計を表す科目（優先順）、parts = 内訳の科目（合算する）。
// 同じ項目に合計と内訳の両方があるときは、合計（優先順の最も高い1行）だけを自動で選び、二重計上を防ぐ。
// sign = -1 は「損失」の科目（金額の符号を反転して利益の欄に入れる）
const SYNONYMS = [
  { target: 'pl.sales', totals: ['売上高合計', '売上合計', '営業収益合計', '純売上高', '売上高', '売上', '営業収益', '完成工事高'] },
  { target: 'pl.costOfSales', totals: ['売上原価合計', '売上原価', '完成工事原価', '営業原価'] },
  { target: 'pl.sga', totals: ['販売費及び一般管理費合計', '販売費および一般管理費合計', '販管費合計', '販売費及び一般管理費', '販売費および一般管理費', '販売費・一般管理費', '販管費'] },
  { target: 'pl.operatingIncome', totals: ['営業利益', '営業損益', '営業利益金額'], losses: ['営業損失', '営業損失金額'] },
  { target: 'pl.ordinaryIncome', totals: ['経常利益', '経常損益', '経常利益金額'], losses: ['経常損失', '経常損失金額'] },
  { target: 'pl.netIncome', totals: ['当期純利益', '当期純損益', '当期純利益金額', '税引後当期純利益', '当期利益'], losses: ['当期純損失', '当期純損失金額', '当期損失'] },
  { target: 'pl.depreciation', totals: ['減価償却費合計'], parts: ['減価償却費'] },
  { target: 'pl.interestExpense', parts: ['支払利息', '支払利息割引料', '支払利息及び割引料', '支払利息・割引料'] },
  {
    target: 'bs.cash', totals: ['現金及び預金合計', '現金及び預金', '現金および預金', '現金預金', '現預金', '現金・預金'],
    parts: ['現金', '小口現金', '普通預金', '当座預金', '定期預金', '定期積金', '通知預金'],
  },
  { target: 'bs.receivables', totals: ['売上債権', '受取手形及び売掛金'], parts: ['受取手形', '売掛金', '電子記録債権', '完成工事未収入金'] },
  {
    target: 'bs.inventory', totals: ['棚卸資産合計', '棚卸資産', 'たな卸資産'],
    parts: ['商品', '製品', '商品及び製品', '仕掛品', '原材料', '原材料及び貯蔵品', '貯蔵品', '未成工事支出金'],
  },
  { target: 'bs.currentAssets', totals: ['流動資産合計', '流動資産計'] },
  { target: 'bs.fixedAssets', totals: ['固定資産合計', '固定資産計'] },
  { target: 'bs.totalAssets', totals: ['資産合計', '資産の部合計', '資産計', '総資産'] },
  { target: 'bs.payables', totals: ['仕入債務', '支払手形及び買掛金'], parts: ['支払手形', '買掛金', '電子記録債務', '工事未払金'] },
  { target: 'bs.currentLiabilities', totals: ['流動負債合計', '流動負債計'] },
  { target: 'bs.fixedLiabilities', totals: ['固定負債合計', '固定負債計'] },
  {
    target: 'bs.interestBearingDebt', totals: ['有利子負債合計', '有利子負債'],
    parts: ['短期借入金', '長期借入金', '1年内返済予定の長期借入金', '一年内返済予定の長期借入金', '社債', '1年内償還予定の社債', '役員借入金'],
  },
  { target: 'bs.netAssets', totals: ['純資産合計', '純資産の部合計', '純資産計', '純資産', '自己資本', '株主資本合計'] },
];

// 比較用に科目名をそろえる：空白・記号・番号（Ⅰ、1.、(1) など）を除き、全角英数を半角にする
export function normalizeLabel(label) {
  if (typeof label !== 'string') return '';
  return label
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/^[【〔［\[(（<＜]?[0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX一二三四五六七八九十]+[】〕］\])）>＞.．、:：]+/, '')
    .replace(/^[【〔［\[(（<＜]+|[】〕］\])）>＞]+$/g, '')
    .replace(/^[・\-－―*＊※]+/, '');
}

// 正規化した科目名 → { target, sign, rank }。rank = 合計の優先順（0が最優先）。内訳は rank = null
const SYNONYM_MAP = new Map();
for (const { target, totals = [], losses = [], parts = [] } of SYNONYMS) {
  totals.forEach((n, i) => SYNONYM_MAP.set(normalizeLabel(n), { target, sign: 1, rank: i }));
  losses.forEach((n, i) => SYNONYM_MAP.set(normalizeLabel(n), { target, sign: -1, rank: totals.length + i }));
  for (const n of parts) SYNONYM_MAP.set(normalizeLabel(n), { target, sign: 1, rank: null });
}

// 対応の候補。保存済みの対応表を優先し、なければ科目名の候補から。見つからなければ取り込まない
export function suggestTarget(label, importMap = {}) {
  const n = normalizeLabel(label);
  const saved = importMap?.[n];
  if (saved && (saved === IGNORE || TARGET_IDS.has(saved))) return { target: saved, sign: SYNONYM_MAP.get(n)?.sign ?? 1, from: 'saved' };
  const s = SYNONYM_MAP.get(n);
  if (s) return { target: s.target, sign: s.sign, from: 'auto' };
  return { target: IGNORE, sign: 1, from: 'none' };
}

// バイト列を文字列にする。UTF-8 として読めなければ Shift_JIS（会計ソフトの CSV に多い）として読む
export function decodeCsvBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    }
  }
}

// CSV（カンマ区切り。1行目にタブがあればタブ区切り：Excelからの貼り付け）を行と列の配列にする。"..." の囲みと "" のエスケープに対応
export function parseCsv(text) {
  if (typeof text !== 'string') return [];
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// 金額のセル。カンマ・円記号・△▲・(1,000) のかっこ書きのマイナスに対応。数値でなければ null
export function parseCell(text) {
  if (typeof text !== 'string') return null;
  let s = text.normalize('NFKC').trim().replace(/[¥￥円]/g, '');
  let neg = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    neg = true;
    s = paren[1];
  }
  const v = parseAmount(s);
  if (!isNum(v)) return null;
  return neg ? -v : v;
}

// 行から「科目名」と「金額」を取り出す。科目名 = 最初の数値でないセル、金額 = 最後の数値のセル。
// 科目名か金額がない行（見出し・空行）は除く。
export function extractItems(rows) {
  const items = [];
  rows.slice(0, MAX_IMPORT_ROWS).forEach((cells, i) => {
    const labelCell = cells.find((c) => c.trim() !== '' && parseCell(c) === null);
    let amount = null;
    for (let j = cells.length - 1; j >= 0; j--) {
      const v = parseCell(cells[j]);
      if (v !== null) {
        amount = v;
        break;
      }
    }
    if (!labelCell || amount === null) return;
    items.push({ line: i + 1, label: labelCell.trim(), amount });
  });
  return items;
}

// 取込の準備。items に対応の候補を付ける。
// 自動の候補で、同じ項目に合計の科目があれば、優先順の最も高い合計1行だけを残し、ほかの行（内訳・別名の合計）は取り込まないにする
export function prepareImport(text, importMap = {}) {
  const items = extractItems(parseCsv(text)).map((it) => ({ ...it, ...suggestTarget(it.label, importMap) }));
  const best = new Map(); // target → 残す行の index
  items.forEach((it, i) => {
    if (it.from !== 'auto') return;
    const rank = SYNONYM_MAP.get(normalizeLabel(it.label))?.rank;
    if (rank === null || rank === undefined) return;
    const cur = best.get(it.target);
    if (cur === undefined || rank < SYNONYM_MAP.get(normalizeLabel(items[cur].label)).rank) best.set(it.target, i);
  });
  return items.map((it, i) => {
    if (it.from !== 'auto' || !best.has(it.target) || best.get(it.target) === i) return it;
    return { ...it, target: IGNORE, from: 'dedup' };
  });
}

// 対応付けた行を入力項目ごとに合計する（同じ項目に複数の科目を対応付けると合計する）。
// unit = CSV の金額の単位（IMPORT_UNITS の id）。戻り値：{ pl: { key: 千円 }, bs: {...}, used: 件数 }
export function buildImport(items, unit = 'yen') {
  const scale = IMPORT_UNITS.find((u) => u.id === unit)?.toThousand ?? 0.001;
  const out = { pl: {}, bs: {}, used: 0 };
  for (const it of items) {
    if (!it.target || it.target === IGNORE || !TARGET_IDS.has(it.target)) continue;
    const [section, key] = it.target.split('.');
    const v = it.amount * (it.sign === -1 ? -1 : 1) * scale;
    out[section][key] = (out[section][key] ?? 0) + v;
    out.used++;
  }
  // 浮動小数の誤差をならす（千円で小数第6位まで）
  for (const sec of ['pl', 'bs']) for (const k of Object.keys(out[sec])) out[sec][k] = Math.round(out[sec][k] * 1e6) / 1e6;
  return out;
}

// 期に取込結果を入れた新しい期を返す（取り込んだ項目だけ上書きし、ほかの項目はそのまま）
export function applyImportToPeriod(period, result) {
  return {
    ...period,
    pl: { ...period.pl, ...result.pl },
    bs: { ...period.bs, ...result.bs },
  };
}

// 対応表を更新する。利用者が選び直した行（from = 'user'）だけを保存し、次回同じ科目名なら同じ項目を選ぶ。
// 自動の候補は保存しない（合計と内訳の重複を防ぐ判定を次回も働かせるため）
export function updateImportMap(importMap, items) {
  const next = { ...(importMap ?? {}) };
  for (const it of items) {
    if (it.from !== 'user') continue;
    const n = normalizeLabel(it.label);
    if (!n) continue;
    if (it.target === IGNORE || TARGET_IDS.has(it.target)) {
      delete next[n];
      next[n] = it.target;
    }
  }
  // 大きくなりすぎないよう、新しい順に最大1000件
  const keys = Object.keys(next);
  if (keys.length > MAX_IMPORT_MAP) for (const k of keys.slice(0, keys.length - MAX_IMPORT_MAP)) delete next[k];
  return next;
}

export function normalizeImportMap(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k && k.length <= 200 && (v === IGNORE || TARGET_IDS.has(v))) out[k] = v;
  }
  const keys = Object.keys(out);
  if (keys.length > MAX_IMPORT_MAP) for (const k of keys.slice(0, keys.length - MAX_IMPORT_MAP)) delete out[k];
  return out;
}
