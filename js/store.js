// データの保存・読込（localStorage のみ。外部送信は行わない）
// storage は引数で差し替え可能（テストではメモリ上のモックを渡す）
import { PL_FIELDS, BS_FIELDS, MAX_PERIODS, isNum } from './calc.js';

export const STORAGE_KEY = 'finAnalysisTool.data';
export const CURRENT_VERSION = 1;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Safari のプライベートモード等でアクセス自体が例外になる場合がある
    return null;
  }
}

function emptyFields(fields) {
  const o = {};
  for (const f of fields) o[f.key] = null;
  return o;
}

export function createEmptyPeriod(label = '') {
  return {
    label,
    pl: emptyFields(PL_FIELDS),
    bs: emptyFields(BS_FIELDS),
    adjustments: [],
    debtLikeItems: [],
  };
}

export function createEmptyData() {
  return { version: CURRENT_VERSION, companyName: '', periods: [createEmptyPeriod('')] };
}

export function getSampleData() {
  return {
    version: CURRENT_VERSION,
    companyName: 'サンプル株式会社',
    periods: [
      {
        label: '2025/3期',
        pl: {
          sales: 100000, costOfSales: 60000, sga: 30000, operatingIncome: 10000,
          ordinaryIncome: 9000, netIncome: 6000, depreciation: 5000, interestExpense: 1000,
        },
        bs: {
          cash: 20000, receivables: 15000, inventory: 10000, currentAssets: 50000,
          fixedAssets: 50000, totalAssets: 100000, payables: 8000, currentLiabilities: 30000,
          fixedLiabilities: 30000, interestBearingDebt: 40000, netAssets: 40000,
        },
        adjustments: [],
        debtLikeItems: [],
      },
    ],
  };
}

// 複数期のサンプル（最終期は getSampleData と同じ数値）
export function getSampleMultiData() {
  const latest = getSampleData();
  const period = (label, pl, bs) => ({ label, pl, bs, adjustments: [], debtLikeItems: [] });
  return {
    ...latest,
    periods: [
      period('2023/3期', {
        sales: 82000, costOfSales: 50840, sga: 26000, operatingIncome: 5160,
        ordinaryIncome: 4300, netIncome: 2800, depreciation: 4200, interestExpense: 1200,
      }, {
        cash: 14000, receivables: 13500, inventory: 9800, currentAssets: 42000,
        fixedAssets: 48000, totalAssets: 90000, payables: 7200, currentLiabilities: 30000,
        fixedLiabilities: 32000, interestBearingDebt: 44000, netAssets: 28000,
      }),
      period('2024/3期', {
        sales: 91000, costOfSales: 55510, sga: 28000, operatingIncome: 7490,
        ordinaryIncome: 6600, netIncome: 4200, depreciation: 4600, interestExpense: 1100,
      }, {
        cash: 17000, receivables: 14200, inventory: 10300, currentAssets: 46000,
        fixedAssets: 49000, totalAssets: 95000, payables: 7600, currentLiabilities: 30000,
        fixedLiabilities: 32800, interestBearingDebt: 42000, netAssets: 32200,
      }),
      ...latest.periods,
    ],
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeFields(src, fields) {
  const o = {};
  for (const f of fields) {
    const v = isPlainObject(src) ? src[f.key] : null;
    o[f.key] = isNum(v) ? v : null;
  }
  return o;
}

function normalizePeriod(p) {
  if (!isPlainObject(p)) return null;
  return {
    label: typeof p.label === 'string' ? p.label : '',
    pl: normalizeFields(p.pl, PL_FIELDS),
    bs: normalizeFields(p.bs, BS_FIELDS),
    adjustments: Array.isArray(p.adjustments) ? p.adjustments : [],
    debtLikeItems: Array.isArray(p.debtLikeItems) ? p.debtLikeItems : [],
  };
}

// 欠けた項目を null で補い、数値以外を null にする。形が壊れていれば null。
export function normalizeData(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.periods)) return null;
  const periods = raw.periods.map(normalizePeriod);
  if (periods.some((p) => p === null)) return null;
  return {
    version: CURRENT_VERSION,
    companyName: typeof raw.companyName === 'string' ? raw.companyName : '',
    periods: periods.length ? periods : [createEmptyPeriod('')],
  };
}

// version を確認して最新形式に移行する。未知の version は null。
export function migrate(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.version === CURRENT_VERSION) return raw;
  return null;
}

export function loadData(storage = defaultStorage()) {
  if (!storage) return { data: createEmptyData(), error: 'この環境ではデータを保存できません' };
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { data: createEmptyData(), error: '保存データを読み込めませんでした' };
  }
  if (text === null || text === undefined) return { data: createEmptyData(), error: null };
  try {
    const data = normalizeData(migrate(JSON.parse(text)));
    if (!data) return { data: createEmptyData(), error: '保存データの形式が正しくないため読み込めませんでした' };
    return { data, error: null };
  } catch {
    return { data: createEmptyData(), error: '保存データが壊れているため読み込めませんでした' };
  }
}

export function saveData(data, storage = defaultStorage()) {
  if (!storage) return { ok: false, error: 'この環境ではデータを保存できません' };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'データを保存できませんでした（容量不足またはブラウザの設定）' };
  }
}

export function clearData(storage = defaultStorage()) {
  if (!storage) return { ok: false, error: 'この環境ではデータを保存できません' };
  try {
    storage.removeItem(STORAGE_KEY);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'データを削除できませんでした' };
  }
}

// ---- 期の操作（元のデータは変更せず、新しいデータを返す） ----

// 期名の先頭の西暦を1年進める（例：「2025/3期」→「2026/3期」）。西暦で始まらなければ空文字。
export function suggestNextLabel(label) {
  const m = typeof label === 'string' ? label.match(/^(\d{4})(.*)$/) : null;
  return m ? `${Number(m[1]) + 1}${m[2]}` : '';
}

// 末尾（最新）に期を追加する。上限に達していれば元のデータをそのまま返す。
export function addPeriod(data) {
  if (data.periods.length >= MAX_PERIODS) return data;
  const last = data.periods[data.periods.length - 1];
  return { ...data, periods: [...data.periods, createEmptyPeriod(suggestNextLabel(last?.label))] };
}

// 期を削除する。最後の1期は削除せず空にする。
export function removePeriod(data, index) {
  if (index < 0 || index >= data.periods.length) return data;
  if (data.periods.length === 1) return { ...data, periods: [createEmptyPeriod('')] };
  return { ...data, periods: data.periods.filter((_, i) => i !== index) };
}

// 期を delta（-1 = 前へ、+1 = 後へ）だけ移動する。範囲外なら変更しない。
export function movePeriod(data, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= data.periods.length || to < 0 || to >= data.periods.length) return data;
  const periods = [...data.periods];
  const [p] = periods.splice(index, 1);
  periods.splice(to, 0, p);
  return { ...data, periods };
}

export function renamePeriod(data, index, label) {
  if (index < 0 || index >= data.periods.length) return data;
  const periods = data.periods.map((p, i) => (i === index ? { ...p, label: String(label) } : p));
  return { ...data, periods };
}
