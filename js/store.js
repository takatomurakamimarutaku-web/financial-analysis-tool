// データの保存・読込（localStorage のみ。外部送信は行わない）
// storage は引数で差し替え可能（テストではメモリ上のモックを渡す）
import { PL_FIELDS, BS_FIELDS, MAX_PERIODS, ADJUSTMENT_CATEGORIES, isNum } from './calc.js';
import { createDefaultSettings, normalizeSettings, applyAccountTotals } from './settings.js';

export const STORAGE_KEY = 'finAnalysisTool.data';
export const CURRENT_VERSION = 6;

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
    cashLikeItems: [],
    details: {}, // 設定で追加した内訳科目の値 { [科目キー]: number|null }
  };
}

// settings を渡すと設定を引き継ぐ（「クリア」で設定は消さない）
export function createEmptyData(settings = createDefaultSettings()) {
  return { version: CURRENT_VERSION, companyName: '', periods: [createEmptyPeriod('')], settings: normalizeSettings(settings) };
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
        adjustments: [
          {
            id: 'sample-2025-1', category: 'executiveComp', description: 'オーナー役員報酬を市場水準に調整',
            amount: 3000, memo: '現行の役員報酬18,000千円に対し、同規模企業の水準を15,000千円と想定',
          },
          {
            id: 'sample-2025-2', category: 'oneTime', description: '本社移転費用',
            amount: 1200, memo: '2025/3期のみ発生。翌期以降は発生しない見込み',
          },
          {
            id: 'sample-2025-3', category: 'relatedParty', description: '代表者所有物件の賃料を市場水準に調整',
            amount: -800, memo: '現行賃料が近隣相場より年800千円低い',
          },
        ],
        debtLikeItems: [
          { id: 'sample-2025-d1', name: '退職給付引当金', amount: 3000, memo: '従業員の退職金は将来の支払義務であり、実質的な債務とみなす' },
          { id: 'sample-2025-d2', name: '未払法人税等', amount: 1500, memo: '決算後2か月以内に納付予定' },
        ],
        cashLikeItems: [
          { id: 'sample-2025-c1', name: '定期預金', amount: 2000, memo: '固定資産（投資その他の資産）に計上。中途解約可能' },
        ],
        details: {},
      },
    ],
    settings: createDefaultSettings(),
  };
}

// 複数期のサンプル（最終期は getSampleData と同じ数値）
export function getSampleMultiData() {
  const latest = getSampleData();
  const period = (label, pl, bs, adjustments = [], debtLikeItems = [], cashLikeItems = []) => ({
    label, pl, bs, adjustments, debtLikeItems, cashLikeItems, details: {},
  });
  const retirement = (id, amount) => ({
    id, name: '退職給付引当金', amount, memo: '従業員の退職金は将来の支払義務であり、実質的な債務とみなす',
  });
  const execComp = (id) => ({
    id, category: 'executiveComp', description: 'オーナー役員報酬を市場水準に調整',
    amount: 2500, memo: '現行の役員報酬17,500千円に対し、同規模企業の水準を15,000千円と想定',
  });
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
      }, [execComp('sample-2023-1')], [retirement('sample-2023-d1', 2600)]),
      period('2024/3期', {
        sales: 91000, costOfSales: 55510, sga: 28000, operatingIncome: 7490,
        ordinaryIncome: 6600, netIncome: 4200, depreciation: 4600, interestExpense: 1100,
      }, {
        cash: 17000, receivables: 14200, inventory: 10300, currentAssets: 46000,
        fixedAssets: 49000, totalAssets: 95000, payables: 7600, currentLiabilities: 30000,
        fixedLiabilities: 32800, interestBearingDebt: 42000, netAssets: 32200,
      }, [
        execComp('sample-2024-1'),
        {
          id: 'sample-2024-2', category: 'oneTime', description: '一時的な補助金収入（営業利益に計上）',
          amount: -1500, memo: '設備導入補助金。継続性なし',
        },
      ], [retirement('sample-2024-d1', 2800)], [
        { id: 'sample-2024-c1', name: '定期預金', amount: 2000, memo: '固定資産（投資その他の資産）に計上。中途解約可能' },
      ]),
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

let idSeq = 0;
export function newAdjustmentId() {
  idSeq += 1;
  return `adj-${Date.now().toString(36)}-${idSeq}`;
}

const CATEGORY_IDS = new Set(ADJUSTMENT_CATEGORIES.map((c) => c.id));

export function createAdjustment(category = 'other') {
  return { id: newAdjustmentId(), category, description: '', amount: null, memo: '' };
}

function normalizeAdjustment(a) {
  if (!isPlainObject(a)) return null;
  return {
    id: typeof a.id === 'string' && a.id ? a.id : newAdjustmentId(),
    category: CATEGORY_IDS.has(a.category) ? a.category : 'other',
    description: typeof a.description === 'string' ? a.description : '',
    amount: isNum(a.amount) ? a.amount : null,
    memo: typeof a.memo === 'string' ? a.memo : '',
  };
}

export function createLineItem(name = '') {
  return { id: newAdjustmentId().replace(/^adj-/, 'item-'), name, amount: null, memo: '' };
}

function normalizeLineItem(a) {
  if (!isPlainObject(a)) return null;
  return {
    id: typeof a.id === 'string' && a.id ? a.id : newAdjustmentId().replace(/^adj-/, 'item-'),
    name: typeof a.name === 'string' ? a.name : '',
    amount: isNum(a.amount) ? a.amount : null,
    memo: typeof a.memo === 'string' ? a.memo : '',
  };
}

function normalizeLineItems(list) {
  return Array.isArray(list) ? list.map(normalizeLineItem).filter(Boolean) : [];
}

function normalizeDetails(src, customKeys) {
  const o = {};
  if (!isPlainObject(src)) return o;
  for (const k of customKeys) if (isNum(src[k])) o[k] = src[k];
  return o;
}

function normalizePeriod(p, customKeys = []) {
  if (!isPlainObject(p)) return null;
  return {
    label: typeof p.label === 'string' ? p.label : '',
    pl: normalizeFields(p.pl, PL_FIELDS),
    bs: normalizeFields(p.bs, BS_FIELDS),
    adjustments: Array.isArray(p.adjustments) ? p.adjustments.map(normalizeAdjustment).filter(Boolean) : [],
    debtLikeItems: normalizeLineItems(p.debtLikeItems),
    cashLikeItems: normalizeLineItems(p.cashLikeItems),
    details: normalizeDetails(p.details, customKeys),
  };
}

// 欠けた項目を null で補い、数値以外を null にする。形が壊れていれば null。
// 内訳科目がある親科目は、内訳の合計で更新する。
export function normalizeData(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.periods)) return null;
  const settings = normalizeSettings(raw.settings);
  const customKeys = settings.accounts.custom.map((c) => c.key);
  const periods = raw.periods.map((p) => normalizePeriod(p, customKeys));
  if (periods.some((p) => p === null)) return null;
  return applyAccountTotals({
    version: CURRENT_VERSION,
    companyName: typeof raw.companyName === 'string' ? raw.companyName : '',
    periods: periods.length ? periods : [createEmptyPeriod('')],
    settings,
  });
}

// version を確認して最新形式に移行する。未知の version は null。
export function migrate(raw) {
  if (!isPlainObject(raw)) return null;
  let data = raw;
  if (data.version === 1) data = migrateV1toV2(data);
  if (data.version === 2) data = migrateV2toV3(data);
  if (data.version === 3) data = migrateV3toV4(data);
  if (data.version === 4) data = migrateV4toV5(data);
  if (data.version === 5) data = migrateV5toV6(data);
  if (data.version === CURRENT_VERSION) return data;
  return null;
}

// version 5 → 6：設定に表示テーマ（theme）とマイナスの表示方法（negativeStyle）を追加する（既定は従来どおり）
export function migrateV5toV6(v5) {
  const settings = isPlainObject(v5.settings) ? v5.settings : {};
  return { ...v5, version: 6, settings: normalizeSettings({ ...settings, theme: 'auto', negativeStyle: 'minus' }) };
}

// version 4 → 5：金額の単位を全体で1つ（settings.unit）から区分ごと（settings.units）に変更する。
// 旧設定の単位をすべての区分に引き継ぐ。
export function migrateV4toV5(v4) {
  // normalizeSettings は旧形式の unit を全区分の単位として読み替える
  return { ...v4, version: 5, settings: normalizeSettings(v4.settings) };
}

// version 3 → 4：設定（settings）を既定値で追加し、各期に内訳科目の値（details）を追加する。
// 既存の入力値は変更しない（表示単位の既定は千円で、従来の表示と同じ）。
export function migrateV3toV4(v3) {
  return {
    ...v3,
    version: 4,
    settings: createDefaultSettings(),
    periods: Array.isArray(v3.periods)
      ? v3.periods.map((p) => (isPlainObject(p) ? { ...p, details: {} } : p))
      : v3.periods,
  };
}

// version 2 → 3：キャッシュライク項目（cashLikeItems）を追加し、
// デットライク項目（debtLikeItems）を { id, name, amount, memo } の形にそろえる。
export function migrateV2toV3(v2) {
  return {
    ...v2,
    version: 3,
    periods: Array.isArray(v2.periods)
      ? v2.periods.map((p) => (isPlainObject(p)
        ? { ...p, debtLikeItems: normalizeLineItems(p.debtLikeItems), cashLikeItems: normalizeLineItems(p.cashLikeItems) }
        : p))
      : v2.periods,
  };
}

// version 1 → 2：調整項目（adjustments）を { id, category, description, amount, memo } の形にそろえる。
// version 1 では調整項目の入力欄がなかったため、通常は空配列。万一入っていた場合も可能な範囲で引き継ぐ。
export function migrateV1toV2(v1) {
  return {
    ...v1,
    version: 2,
    periods: Array.isArray(v1.periods)
      ? v1.periods.map((p) => (isPlainObject(p)
        ? { ...p, adjustments: Array.isArray(p.adjustments) ? p.adjustments.map(normalizeAdjustment).filter(Boolean) : [] }
        : p))
      : v1.periods,
  };
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

// ---- JSONバックアップ・復元 ----

export const BACKUP_FORMAT = 'finAnalysisTool-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const LAST_BACKUP_KEY = 'finAnalysisTool.lastBackupAt';
export const BACKUP_REMINDER_DAYS = 30;

const SUPPORTED_DATA_VERSIONS = [1, 2, 3, 4, 5, 6];

export function createBackup(data, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    data,
  };
}

export function backupToJson(data, now = new Date()) {
  return JSON.stringify(createBackup(data, now), null, 2);
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `fin-tool-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

function checkFields(src, fields, where, errors) {
  if (!isPlainObject(src)) {
    errors.push(`${where} がありません`);
    return;
  }
  for (const f of fields) {
    const v = src[f.key];
    if (v !== undefined && v !== null && !isNum(v)) errors.push(`${where}.${f.key} が数値ではありません`);
  }
}

// データ本体の形式を検証する。問題があればエラーメッセージの配列を返す（空なら正常）。
// normalizeData と違い、型の誤りを null に置き換えずにエラーとする。
export function validateData(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return ['データがオブジェクトではありません'];
  if (!SUPPORTED_DATA_VERSIONS.includes(raw.version)) {
    return [`対応していないデータのバージョンです（version: ${JSON.stringify(raw.version)}）`];
  }
  if (raw.companyName !== undefined && typeof raw.companyName !== 'string') errors.push('companyName が文字列ではありません');
  if (raw.settings !== undefined && !isPlainObject(raw.settings)) errors.push('settings が不正です');
  if (!Array.isArray(raw.periods)) return [...errors, 'periods がありません'];
  if (raw.periods.length < 1 || raw.periods.length > MAX_PERIODS) {
    errors.push(`期の数が不正です（1〜${MAX_PERIODS}期）`);
  }
  raw.periods.forEach((p, i) => {
    const where = `periods[${i}]`;
    if (!isPlainObject(p)) {
      errors.push(`${where} が不正です`);
      return;
    }
    if (p.label !== undefined && typeof p.label !== 'string') errors.push(`${where}.label が文字列ではありません`);
    checkFields(p.pl, PL_FIELDS, `${where}.pl`, errors);
    checkFields(p.bs, BS_FIELDS, `${where}.bs`, errors);
    for (const k of ['adjustments', 'debtLikeItems', 'cashLikeItems']) {
      if (p[k] !== undefined && !Array.isArray(p[k])) errors.push(`${where}.${k} が配列ではありません`);
    }
    if (p.details !== undefined) {
      if (!isPlainObject(p.details)) errors.push(`${where}.details が不正です`);
      else {
        for (const [k, v] of Object.entries(p.details)) {
          if (v !== null && !isNum(v)) errors.push(`${where}.details.${k} が数値ではありません`);
        }
      }
    }
    if (Array.isArray(p.adjustments)) {
      p.adjustments.forEach((a, j) => {
        const w = `${where}.adjustments[${j}]`;
        if (!isPlainObject(a)) {
          errors.push(`${w} が不正です`);
          return;
        }
        if (a.amount !== undefined && a.amount !== null && !isNum(a.amount)) errors.push(`${w}.amount が数値ではありません`);
        if (a.category !== undefined && !CATEGORY_IDS.has(a.category)) errors.push(`${w}.category が不明な区分です`);
        for (const k of ['description', 'memo']) {
          if (a[k] !== undefined && typeof a[k] !== 'string') errors.push(`${w}.${k} が文字列ではありません`);
        }
      });
    }
    for (const key of ['debtLikeItems', 'cashLikeItems']) {
      if (!Array.isArray(p[key])) continue;
      p[key].forEach((a, j) => {
        const w = `${where}.${key}[${j}]`;
        if (!isPlainObject(a)) {
          errors.push(`${w} が不正です`);
          return;
        }
        if (a.amount !== undefined && a.amount !== null && !isNum(a.amount)) errors.push(`${w}.amount が数値ではありません`);
        for (const k of ['name', 'memo']) {
          if (a[k] !== undefined && typeof a[k] !== 'string') errors.push(`${w}.${k} が文字列ではありません`);
        }
      });
    }
  });
  return errors;
}

// バックアップファイルの文字列を検証して読み込む。
// 戻り値：{ ok: true, data, exportedAt } または { ok: false, error }
export function parseBackup(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'ファイルが空です' };
  let obj;
  try {
    obj = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'JSON形式ではありません' };
  }
  if (!isPlainObject(obj) || obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'このツールのバックアップファイルではありません' };
  }
  if (obj.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `対応していないバックアップ形式です（formatVersion: ${JSON.stringify(obj.formatVersion)}）` };
  }
  const errors = validateData(obj.data);
  if (errors.length) return { ok: false, error: `データの形式が正しくありません：${errors.slice(0, 3).join('、')}` };
  const data = normalizeData(migrate(obj.data));
  if (!data) return { ok: false, error: 'データを読み込めませんでした' };
  return { ok: true, data, exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null };
}

export function getLastBackupAt(storage = defaultStorage()) {
  try {
    const v = storage?.getItem(LAST_BACKUP_KEY);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function setLastBackupAt(date = new Date(), storage = defaultStorage()) {
  try {
    storage?.setItem(LAST_BACKUP_KEY, date.toISOString());
    return true;
  } catch {
    return false;
  }
}

// 入力データがあり、最終バックアップから days 日以上（または未実施）なら true。days = 0 は案内しない。
export function needsBackupReminder(lastBackupAt, hasData, now = new Date(), days = BACKUP_REMINDER_DAYS) {
  if (!hasData || days === 0) return false;
  if (!(lastBackupAt instanceof Date) || Number.isNaN(lastBackupAt.getTime())) return true;
  return now.getTime() - lastBackupAt.getTime() >= days * 24 * 60 * 60 * 1000;
}

// 何か入力されているか
export function hasAnyData(data) {
  if (!data) return false;
  return Boolean(data.companyName)
    || data.periods.length > 1
    || data.periods.some((p) => p.label
      || Object.values(p.pl).some(isNum)
      || Object.values(p.bs).some(isNum)
      || Object.values(p.details ?? {}).some(isNum));
}

// ---- 調整項目の操作（元のデータは変更せず、新しいデータを返す） ----

function updatePeriod(data, index, fn) {
  if (index < 0 || index >= data.periods.length) return data;
  return { ...data, periods: data.periods.map((p, i) => (i === index ? fn(p) : p)) };
}

export function addAdjustment(data, periodIndex, item = createAdjustment()) {
  return updatePeriod(data, periodIndex, (p) => ({ ...p, adjustments: [...p.adjustments, item] }));
}

export function updateAdjustment(data, periodIndex, id, changes) {
  return updatePeriod(data, periodIndex, (p) => ({
    ...p,
    adjustments: p.adjustments.map((a) => (a.id === id ? { ...a, ...changes } : a)),
  }));
}

export function removeAdjustment(data, periodIndex, id) {
  return updatePeriod(data, periodIndex, (p) => ({ ...p, adjustments: p.adjustments.filter((a) => a.id !== id) }));
}

// ---- デットライク・キャッシュライク項目の操作（listKey = 'debtLikeItems' | 'cashLikeItems'） ----

const LINE_LISTS = ['debtLikeItems', 'cashLikeItems'];

export function addLineItem(data, periodIndex, listKey, item = createLineItem()) {
  if (!LINE_LISTS.includes(listKey)) return data;
  return updatePeriod(data, periodIndex, (p) => ({ ...p, [listKey]: [...(p[listKey] ?? []), item] }));
}

export function updateLineItem(data, periodIndex, listKey, id, changes) {
  if (!LINE_LISTS.includes(listKey)) return data;
  return updatePeriod(data, periodIndex, (p) => ({
    ...p,
    [listKey]: (p[listKey] ?? []).map((a) => (a.id === id ? { ...a, ...changes } : a)),
  }));
}

export function removeLineItem(data, periodIndex, listKey, id) {
  if (!LINE_LISTS.includes(listKey)) return data;
  return updatePeriod(data, periodIndex, (p) => ({ ...p, [listKey]: (p[listKey] ?? []).filter((a) => a.id !== id) }));
}

// すべてのデータを削除する（入力データと最終バックアップ日時）
export function deleteAllData(storage = defaultStorage()) {
  if (!storage) return { ok: false, error: 'この環境ではデータを保存できません' };
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(LAST_BACKUP_KEY);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'データを削除できませんでした' };
  }
}
