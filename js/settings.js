// 設定（表示単位・科目・指標・分析の基本設定など）。DOMに依存しない純粋関数。
// 設定は data.settings に保存し、JSONバックアップにも含める。
// 金額の内部単位は常に千円。表示単位は入力・表示のときだけ換算する。
import {
  PL_FIELDS, BS_FIELDS, INDICATORS, ADJUSTMENT_CATEGORIES, isNum,
} from './calc.js';

export const AMOUNT_UNITS = [
  { id: 'yen', name: '円', scale: 1000, digits: 0 },
  { id: 'thousand', name: '千円', scale: 1, digits: 0 },
  { id: 'million', name: '百万円', scale: 0.001, digits: 1 },
];

export const DIGIT_LIMITS = { pct: [0, 3], days: [0, 2], times: [0, 3] };
export const BACKUP_REMINDER_CHOICES = [0, 7, 14, 30, 60, 90]; // 0 = 案内しない

const SECTIONS = { pl: PL_FIELDS, bs: BS_FIELDS };
const STANDARD_KEYS = new Set([...PL_FIELDS, ...BS_FIELDS].map((f) => f.key));
const INDICATOR_IDS = new Set(INDICATORS.map((i) => i.id));
const CATEGORY_IDS = new Set(ADJUSTMENT_CATEGORIES.map((c) => c.id));

export const MAX_CUSTOM_ACCOUNTS = 60;
export const OTHER_DETAIL_LABEL = 'その他';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

export function sectionOf(key) {
  if (PL_FIELDS.some((f) => f.key === key)) return 'pl';
  if (BS_FIELDS.some((f) => f.key === key)) return 'bs';
  return null;
}

export function standardLabel(key) {
  return [...PL_FIELDS, ...BS_FIELDS].find((f) => f.key === key)?.label ?? '';
}

export function createDefaultSettings() {
  return {
    unit: 'thousand',
    accounts: {
      pl: PL_FIELDS.map((f) => ({ key: f.key, label: '', hidden: false })),
      bs: BS_FIELDS.map((f) => ({ key: f.key, label: '', hidden: false })),
      custom: [],
    },
    indicators: INDICATORS.map((i) => ({ id: i.id, hidden: false })),
    analysis: { daysInYear: 365, defaultBasis: 'end' },
    digits: { pct: 1, days: 1, times: 2 },
    backupReminderDays: 30,
    adjustmentCategoryNames: {},
  };
}

function clampInt(v, [min, max], fallback) {
  return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

// 標準科目の並び：保存された順序を使い、欠けた科目は既定の位置（末尾）に補う
function normalizeStandardList(list, fields) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    if (!isPlainObject(a) || !fields.some((f) => f.key === a.key) || seen.has(a.key)) continue;
    seen.add(a.key);
    out.push({ key: a.key, label: str(a.label), hidden: a.hidden === true });
  }
  for (const f of fields) if (!seen.has(f.key)) out.push({ key: f.key, label: '', hidden: false });
  return out;
}

function normalizeCustomList(list) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    if (!isPlainObject(a) || typeof a.key !== 'string' || !/^c-[\w-]+$/.test(a.key)) continue;
    if (seen.has(a.key) || !STANDARD_KEYS.has(a.parent)) continue;
    seen.add(a.key);
    out.push({ key: a.key, label: str(a.label), parent: a.parent });
    if (out.length >= MAX_CUSTOM_ACCOUNTS) break;
  }
  return out;
}

// 欠けた項目を既定値で補い、不正な値を既定値に置き換える
export function normalizeSettings(raw) {
  const d = createDefaultSettings();
  if (!isPlainObject(raw)) return d;
  const acc = isPlainObject(raw.accounts) ? raw.accounts : {};
  const indicators = [];
  const seen = new Set();
  for (const x of Array.isArray(raw.indicators) ? raw.indicators : []) {
    if (!isPlainObject(x) || !INDICATOR_IDS.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    indicators.push({ id: x.id, hidden: x.hidden === true });
  }
  for (const i of INDICATORS) if (!seen.has(i.id)) indicators.push({ id: i.id, hidden: false });
  const an = isPlainObject(raw.analysis) ? raw.analysis : {};
  const dg = isPlainObject(raw.digits) ? raw.digits : {};
  const names = {};
  if (isPlainObject(raw.adjustmentCategoryNames)) {
    for (const [k, v] of Object.entries(raw.adjustmentCategoryNames)) {
      if (CATEGORY_IDS.has(k) && typeof v === 'string' && v.trim()) names[k] = v;
    }
  }
  return {
    unit: AMOUNT_UNITS.some((u) => u.id === raw.unit) ? raw.unit : d.unit,
    accounts: {
      pl: normalizeStandardList(acc.pl, PL_FIELDS),
      bs: normalizeStandardList(acc.bs, BS_FIELDS),
      custom: normalizeCustomList(acc.custom),
    },
    indicators,
    analysis: {
      daysInYear: an.daysInYear === 360 ? 360 : 365,
      defaultBasis: an.defaultBasis === 'average' ? 'average' : 'end',
    },
    digits: {
      pct: clampInt(dg.pct, DIGIT_LIMITS.pct, d.digits.pct),
      days: clampInt(dg.days, DIGIT_LIMITS.days, d.digits.days),
      times: clampInt(dg.times, DIGIT_LIMITS.times, d.digits.times),
    },
    backupReminderDays: clampInt(raw.backupReminderDays, [0, 365], d.backupReminderDays),
    adjustmentCategoryNames: names,
  };
}

// ---- 表示単位・桁数 ----

export function unitOf(settings) {
  return AMOUNT_UNITS.find((u) => u.id === settings?.unit) ?? AMOUNT_UNITS[1];
}

// 浮動小数点の誤差（1.234 * 1000 = 1233.9999999999998 など）だけを取り除く。丸めではない。
function clean(v) {
  return Number(v.toPrecision(12));
}

// 内部値（千円）→ 表示単位の値
export function toDisplayAmount(v, settings) {
  return isNum(v) ? clean(v * unitOf(settings).scale) : null;
}

// 表示単位で入力された値 → 内部値（千円）
export function fromDisplayAmount(v, settings) {
  return isNum(v) ? clean(v / unitOf(settings).scale) : null;
}

// calc.js の formatAmount / formatValue / formatChangeAmount に渡す表示オプション
export function formatOptions(settings) {
  const u = unitOf(settings);
  const s = settings ?? createDefaultSettings();
  return {
    amountScale: u.scale,
    amountUnit: u.name,
    amountDigits: u.digits,
    digits: { '%': s.digits?.pct ?? 1, '日': s.digits?.days ?? 1, '倍': s.digits?.times ?? 2, '回': s.digits?.times ?? 2 },
  };
}

// ---- 科目 ----

// 科目の表示名（名称変更していなければ標準名）
export function accountLabel(settings, key) {
  const section = sectionOf(key);
  if (section) {
    const a = settings?.accounts?.[section]?.find((x) => x.key === key);
    return (a?.label ?? '').trim() || standardLabel(key);
  }
  const c = settings?.accounts?.custom?.find((x) => x.key === key);
  return (c?.label ?? '').trim() || '（名称未入力）';
}

export function childrenOf(settings, parent) {
  return (settings?.accounts?.custom ?? []).filter((c) => c.parent === parent);
}

// 入力画面・設定画面に並べる科目の一覧
// 戻り値：[{ key, label, standardLabel, hidden, children: [{ key, label }] }]
export function accountTree(settings, section) {
  const list = settings?.accounts?.[section] ?? createDefaultSettings().accounts[section];
  return list.map((a) => ({
    key: a.key,
    label: accountLabel(settings, a.key),
    standardLabel: standardLabel(a.key),
    renamed: Boolean((a.label ?? '').trim()),
    hidden: a.hidden === true,
    children: childrenOf(settings, a.key).map((c) => ({ key: c.key, label: accountLabel(settings, c.key) })),
  }));
}

function withAccounts(settings, accounts) {
  return { ...settings, accounts: { ...settings.accounts, ...accounts } };
}

// 名称変更（標準科目は空欄にすると標準名に戻る）
export function renameAccount(settings, key, label) {
  const section = sectionOf(key);
  if (section) {
    return withAccounts(settings, {
      [section]: settings.accounts[section].map((a) => (a.key === key ? { ...a, label: String(label) } : a)),
    });
  }
  return withAccounts(settings, {
    custom: settings.accounts.custom.map((c) => (c.key === key ? { ...c, label: String(label) } : c)),
  });
}

export function setAccountHidden(settings, key, hidden) {
  const section = sectionOf(key);
  if (!section) return settings;
  return withAccounts(settings, {
    [section]: settings.accounts[section].map((a) => (a.key === key ? { ...a, hidden: Boolean(hidden) } : a)),
  });
}

function moveInArray(arr, from, to) {
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return null;
  const out = [...arr];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// 並び替え。標準科目は同じ表（PL/BS）の中で、内訳科目は同じ親科目の中で移動する。範囲外なら変更しない。
export function moveAccount(settings, key, delta) {
  const section = sectionOf(key);
  if (section) {
    const list = settings.accounts[section];
    const i = list.findIndex((a) => a.key === key);
    const moved = moveInArray(list, i, i + delta);
    return moved ? withAccounts(settings, { [section]: moved }) : settings;
  }
  const custom = settings.accounts.custom;
  const me = custom.find((c) => c.key === key);
  if (!me) return settings;
  const siblings = custom.filter((c) => c.parent === me.parent);
  const j = siblings.findIndex((c) => c.key === key);
  const target = siblings[j + delta];
  if (!target) return settings;
  const a = custom.indexOf(me);
  const b = custom.indexOf(target);
  const out = [...custom];
  out[a] = target;
  out[b] = me;
  return withAccounts(settings, { custom: out });
}

let keySeq = 0;
export function newAccountKey() {
  keySeq += 1;
  return `c-${Date.now().toString(36)}-${keySeq}`;
}

// ---- 内訳科目の値（data を受け取り、新しい data を返す） ----

// 親科目の値を内訳の合計で更新する。
// 内訳のいずれかに値がある期だけ、親科目 = 入力済みの内訳の合計。内訳がすべて未入力の期は親科目の入力値をそのまま使う。
export function applyAccountTotalsToPeriod(period, settings) {
  const parents = new Set((settings?.accounts?.custom ?? []).map((c) => c.parent));
  if (!parents.size) return period;
  const details = period.details ?? {};
  let pl = period.pl;
  let bs = period.bs;
  for (const parent of parents) {
    const values = childrenOf(settings, parent).map((c) => details[c.key]).filter(isNum);
    if (!values.length) continue;
    const total = clean(values.reduce((s, v) => s + v, 0));
    if (sectionOf(parent) === 'pl') {
      if (pl[parent] !== total) pl = { ...pl, [parent]: total };
    } else if (bs[parent] !== total) bs = { ...bs, [parent]: total };
  }
  return pl === period.pl && bs === period.bs ? period : { ...period, pl, bs };
}

export function applyAccountTotals(data) {
  return { ...data, periods: data.periods.map((p) => applyAccountTotalsToPeriod(p, data.settings)) };
}

// その期で親科目が内訳の合計から計算されているか
export function isComputedAccount(period, settings, key) {
  return childrenOf(settings, key).some((c) => isNum(period?.details?.[c.key]));
}

// 内訳科目を追加する。戻り値：{ data, key }
// 親科目に入力済みの値がある期は、合計が変わらないよう「その他」の内訳を同時に作り、元の値を移す。
export function addCustomAccount(data, parent, label = '') {
  const settings = data.settings;
  if (!STANDARD_KEYS.has(parent) || settings.accounts.custom.length >= MAX_CUSTOM_ACCOUNTS) return { data, key: null };
  const section = sectionOf(parent);
  const custom = [...settings.accounts.custom];
  let periods = data.periods;
  const first = childrenOf(settings, parent).length === 0;
  if (first && data.periods.some((p) => isNum(p[section]?.[parent]))) {
    const otherKey = newAccountKey();
    custom.push({ key: otherKey, label: OTHER_DETAIL_LABEL, parent });
    periods = periods.map((p) => (isNum(p[section]?.[parent])
      ? { ...p, details: { ...(p.details ?? {}), [otherKey]: p[section][parent] } }
      : p));
  }
  const key = newAccountKey();
  custom.splice(first ? 0 : custom.length, 0, { key, label: String(label), parent });
  return { data: { ...data, settings: withAccounts(settings, { custom }), periods }, key };
}

// 内訳科目を削除する（全期の値も削除）。残った内訳で親科目を再計算する。
// 最後の内訳を削除した場合、親科目は直前の合計値のまま入力欄に戻る。
export function removeCustomAccount(data, key) {
  const settings = withAccounts(data.settings, { custom: data.settings.accounts.custom.filter((c) => c.key !== key) });
  const periods = data.periods.map((p) => {
    if (!p.details || !(key in p.details)) return p;
    const { [key]: _removed, ...rest } = p.details;
    return { ...p, details: rest };
  });
  return applyAccountTotals({ ...data, settings, periods });
}

export function setDetailValue(data, periodIndex, key, value) {
  const periods = data.periods.map((p, i) => {
    if (i !== periodIndex) return p;
    return applyAccountTotalsToPeriod({ ...p, details: { ...(p.details ?? {}), [key]: isNum(value) ? value : null } }, data.settings);
  });
  return { ...data, periods };
}

// ---- 指標 ----

// 表示する指標（設定の順序・非表示を反映）。includeHidden = true なら非表示も含めて hidden 付きで返す。
export function indicatorList(settings, includeHidden = false) {
  const order = settings?.indicators ?? createDefaultSettings().indicators;
  const out = [];
  for (const x of order) {
    const ind = INDICATORS.find((i) => i.id === x.id);
    if (!ind) continue;
    if (x.hidden && !includeHidden) continue;
    out.push(includeHidden ? { ...ind, hidden: x.hidden === true } : ind);
  }
  return out;
}

export function setIndicatorHidden(settings, id, hidden) {
  return { ...settings, indicators: settings.indicators.map((x) => (x.id === id ? { ...x, hidden: Boolean(hidden) } : x)) };
}

// 指標の並び替え（同じ区分の中で前後の指標と入れ替える）
export function moveIndicator(settings, id, delta) {
  const list = settings.indicators;
  const cat = INDICATORS.find((i) => i.id === id)?.category;
  const sameCat = list.filter((x) => INDICATORS.find((i) => i.id === x.id)?.category === cat);
  const j = sameCat.findIndex((x) => x.id === id);
  const target = sameCat[j + delta];
  if (!target) return settings;
  const out = [...list];
  const a = out.findIndex((x) => x.id === id);
  const b = out.findIndex((x) => x.id === target.id);
  [out[a], out[b]] = [out[b], out[a]];
  return { ...settings, indicators: out };
}

// ---- 比較表の行の表示名・表示有無 ----

// 比較表の行 id のうち、科目そのものを表す行（名称変更を反映する）
const ROW_ACCOUNT = { sales: 'sales', operatingIncome: 'operatingIncome', ordinaryIncome: 'ordinaryIncome', netIncome: 'netIncome', totalAssets: 'totalAssets', netAssets: 'netAssets' };

export function rowLabel(settings, row) {
  return ROW_ACCOUNT[row.id] ? accountLabel(settings, ROW_ACCOUNT[row.id]) : row.name;
}

// 比較表の行を設定に合わせる（非表示の指標を除き、区分内の順序を設定に合わせる）
export function arrangeComparisonRows(settings, rows) {
  const list = indicatorList(settings);
  // 指標の行は、その区分の最初の指標の位置に、設定の順序で（非表示を除いて）並べる
  const byCat = {};
  for (const ind of list) (byCat[ind.category] ??= []).push(rows.find((r) => r.id === ind.id));
  const result = [];
  const done = new Set();
  for (const r of rows) {
    if (!INDICATOR_IDS.has(r.id)) {
      result.push(r);
    } else if (!done.has(r.group)) {
      done.add(r.group);
      result.push(...(byCat[r.group] ?? []).filter(Boolean));
    }
  }
  return result;
}

// ---- その他 ----

export function categoryLabel(settings, id) {
  const n = settings?.adjustmentCategoryNames?.[id];
  return (typeof n === 'string' && n.trim()) || ADJUSTMENT_CATEGORIES.find((c) => c.id === id)?.name || 'その他';
}

export function renameCategory(settings, id, name) {
  if (!CATEGORY_IDS.has(id)) return settings;
  const names = { ...settings.adjustmentCategoryNames };
  if (String(name).trim()) names[id] = String(name);
  else delete names[id];
  return { ...settings, adjustmentCategoryNames: names };
}

export function updateSettings(data, changes) {
  return { ...data, settings: normalizeSettings({ ...data.settings, ...changes }) };
}
