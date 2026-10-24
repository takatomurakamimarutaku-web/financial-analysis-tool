// データの保存・読込（localStorage のみ。外部送信は行わない）
// storage は引数で差し替え可能（テストではメモリ上のモックを渡す）
import { PL_FIELDS, BS_FIELDS, isNum } from './calc.js';

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
