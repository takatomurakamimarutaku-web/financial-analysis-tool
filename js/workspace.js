// 複数社（顧問先・案件）の管理。DOMに依存しない純粋関数（保存の読み書きだけ storage を受け取る）。
// 保存形式 version 8（ワークスペース）：{ version: 8, activeId, companies: [{ id, companyName, periods }], settings }
// 設定（settings）は全社で共通。画面は「選択中の会社のデータ」（version 7 と同じ形：companyName・periods・settings）を扱う。
import {
  CURRENT_VERSION, STORAGE_KEY, UNDO_KEY, BACKUP_FORMAT, BACKUP_FORMAT_VERSION,
  createEmptyData, normalizeData, migrate, validateData,
} from './store.js';
import { normalizeSettings } from './settings.js';

export const WORKSPACE_VERSION = 8;
export const MAX_COMPANIES = 30;
export const UNNAMED_COMPANY = '（会社名未入力）';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let seq = 0;
export function newCompanyId(now = Date.now()) {
  seq = (seq + 1) % 1e6;
  return `co-${now.toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function companyFrom(data, id = newCompanyId()) {
  return { id, companyName: data.companyName, periods: data.periods };
}

export function isWorkspace(raw) {
  return isPlainObject(raw) && raw.version === WORKSPACE_VERSION && Array.isArray(raw.companies);
}

// 1社分のデータ（version 1〜7）から、その会社だけのワークスペースを作る（version 7 → 8 の移行）
export function migrateV7toV8(data) {
  const d = normalizeData(migrate(data));
  if (!d) return null;
  const c = companyFrom(d);
  return { version: WORKSPACE_VERSION, activeId: c.id, companies: [c], settings: d.settings };
}

export function createWorkspace(settings) {
  return migrateV7toV8(createEmptyData(settings));
}

// 欠けた項目を補い、各社のデータを正規化する。形が壊れていれば null
export function normalizeWorkspace(raw) {
  if (!isWorkspace(raw)) return null;
  const settings = normalizeSettings(raw.settings);
  const seen = new Set();
  const companies = [];
  for (const c of raw.companies.slice(0, MAX_COMPANIES)) {
    if (!isPlainObject(c)) return null;
    const d = normalizeData({ version: CURRENT_VERSION, companyName: c.companyName, periods: c.periods, settings });
    if (!d) return null;
    let id = typeof c.id === 'string' && c.id && !seen.has(c.id) ? c.id : newCompanyId();
    while (seen.has(id)) id = newCompanyId();
    seen.add(id);
    companies.push({ id, companyName: d.companyName, periods: d.periods });
  }
  if (!companies.length) return createWorkspace(settings);
  const activeId = companies.some((c) => c.id === raw.activeId) ? raw.activeId : companies[0].id;
  return { version: WORKSPACE_VERSION, activeId, companies, settings };
}

// 保存データ・バックアップ（version 1〜8）をワークスペースにする。読めなければ null
export function toWorkspace(raw) {
  if (isWorkspace(raw)) return normalizeWorkspace(raw);
  return migrateV7toV8(raw);
}

// ワークスペースの形式チェック（バックアップの復元用）。問題があればエラーメッセージの配列
export function validateWorkspace(raw) {
  if (!isWorkspace(raw)) return ['データの形式が正しくありません'];
  if (raw.companies.length < 1 || raw.companies.length > MAX_COMPANIES) return [`会社の数が不正です（1〜${MAX_COMPANIES}社）`];
  const errors = [];
  raw.companies.forEach((c, i) => {
    if (!isPlainObject(c)) {
      errors.push(`companies[${i}] が不正です`);
      return;
    }
    for (const e of validateData({ version: CURRENT_VERSION, companyName: c.companyName, periods: c.periods, settings: raw.settings })) {
      errors.push(`companies[${i}]：${e}`);
    }
  });
  return errors;
}

export function activeCompany(ws) {
  return ws.companies.find((c) => c.id === ws.activeId) ?? ws.companies[0];
}

// 選択中の会社のデータ（画面が扱う形）
export function activeData(ws) {
  const c = activeCompany(ws);
  return { version: CURRENT_VERSION, companyName: c.companyName, periods: c.periods, settings: ws.settings };
}

// 画面のデータ（選択中の会社）をワークスペースに書き戻す。設定は全社共通として更新する
export function withActiveData(ws, data) {
  return {
    ...ws,
    settings: data.settings,
    companies: ws.companies.map((c) => (c.id === ws.activeId ? { ...c, companyName: data.companyName, periods: data.periods } : c)),
  };
}

export function companyLabel(c) {
  return (typeof c?.companyName === 'string' && c.companyName.trim()) || UNNAMED_COMPANY;
}

export function setActiveCompany(ws, id) {
  return ws.companies.some((c) => c.id === id) ? { ...ws, activeId: id } : ws;
}

// 会社を追加して選択する。data を渡すとその内容で追加（バックアップの取り込み）。上限なら ws のまま
export function addCompany(ws, data = null) {
  if (ws.companies.length >= MAX_COMPANIES) return ws;
  const d = data ?? createEmptyData(ws.settings);
  const c = companyFrom(d);
  return { ...ws, activeId: c.id, companies: [...ws.companies, c] };
}

export function duplicateCompany(ws, id) {
  const i = ws.companies.findIndex((c) => c.id === id);
  if (i < 0 || ws.companies.length >= MAX_COMPANIES) return ws;
  const src = ws.companies[i];
  const copy = {
    id: newCompanyId(),
    companyName: `${companyLabel(src)}（コピー）`,
    periods: JSON.parse(JSON.stringify(src.periods)),
  };
  const companies = [...ws.companies];
  companies.splice(i + 1, 0, copy);
  return { ...ws, activeId: copy.id, companies };
}

export function renameCompany(ws, id, name) {
  return { ...ws, companies: ws.companies.map((c) => (c.id === id ? { ...c, companyName: String(name ?? '').slice(0, 100) } : c)) };
}

// 削除。最後の1社は削除できない（ws のまま）。選択中の会社を消したら隣の会社を選ぶ
export function removeCompany(ws, id) {
  const i = ws.companies.findIndex((c) => c.id === id);
  if (i < 0 || ws.companies.length <= 1) return ws;
  const companies = ws.companies.filter((c) => c.id !== id);
  const activeId = ws.activeId === id ? companies[Math.min(i, companies.length - 1)].id : ws.activeId;
  return { ...ws, activeId, companies };
}

export function moveCompany(ws, id, delta) {
  const i = ws.companies.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ws.companies.length) return ws;
  const companies = [...ws.companies];
  [companies[i], companies[j]] = [companies[j], companies[i]];
  return { ...ws, companies };
}

// ---- 保存・読込（localStorage。キーは従来と同じ） ----

export function loadWorkspace(storage = defaultStorage()) {
  if (!storage) return { workspace: createWorkspace(), error: 'この環境ではデータを保存できません' };
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { workspace: createWorkspace(), error: '保存データを読み込めませんでした' };
  }
  if (text === null || text === undefined) return { workspace: createWorkspace(), error: null };
  try {
    const ws = toWorkspace(JSON.parse(text));
    if (!ws) return { workspace: createWorkspace(), error: '保存データの形式が正しくないため読み込めませんでした' };
    return { workspace: ws, error: null };
  } catch {
    return { workspace: createWorkspace(), error: '保存データが壊れているため読み込めませんでした' };
  }
}

export function saveWorkspace(ws, storage = defaultStorage()) {
  if (!storage) return { ok: false, error: 'この環境ではデータを保存できません' };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ws));
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'データを保存できませんでした（容量不足またはブラウザの設定）' };
  }
}

// 保存データの大きさ（文字数）。localStorage の上限（多くのブラウザで約500万文字）の目安表示に使う
export function workspaceSize(ws) {
  return JSON.stringify(ws).length;
}

// ---- バックアップ（1社分と全社） ----
// 1社分：従来と同じ形式（data は version 7 の1社分）。全社：data にワークスペース（version 8）を入れる。

export function workspaceBackupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `fin-tool-backup-all-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// バックアップファイルを読む。
// 戻り値：{ ok: true, kind: 'company', data, exportedAt } | { ok: true, kind: 'workspace', workspace, exportedAt } | { ok: false, error }
export function parseAnyBackup(text) {
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
  const exportedAt = typeof obj.exportedAt === 'string' ? obj.exportedAt : null;
  if (isWorkspace(obj.data)) {
    const errors = validateWorkspace(obj.data);
    if (errors.length) return { ok: false, error: `データの形式が正しくありません：${errors.slice(0, 3).join('、')}` };
    const workspace = normalizeWorkspace(obj.data);
    return workspace ? { ok: true, kind: 'workspace', workspace, exportedAt } : { ok: false, error: 'データを読み込めませんでした' };
  }
  const errors = validateData(obj.data);
  if (errors.length) return { ok: false, error: `データの形式が正しくありません：${errors.slice(0, 3).join('、')}` };
  const data = normalizeData(migrate(obj.data));
  return data ? { ok: true, kind: 'company', data, exportedAt } : { ok: false, error: 'データを読み込めませんでした' };
}

// ---- 元に戻す（クリア・期の削除・復元・サンプル読込・会社の削除の直前の状態） ----
// 直前の全社の状態を1つだけ端末内（localStorage）に退避し、再読み込み後も戻せる。

export const UNDO_ACTIONS = {
  clear: 'クリア',
  removePeriod: '期の削除',
  restore: 'バックアップからの復元',
  sample: 'サンプルデータの読込',
  removeCompany: '会社の削除',
};

export function createUndoSnapshot(ws, action, selected = 0, now = new Date()) {
  return { action: action in UNDO_ACTIONS ? action : 'clear', selected, at: now.toISOString(), workspace: ws };
}

// 保存できなかったときは false（退避できなくても操作は続ける）
export function saveUndo(snapshot, storage = defaultStorage()) {
  try {
    storage?.setItem(UNDO_KEY, JSON.stringify(snapshot));
    return Boolean(storage);
  } catch {
    return false;
  }
}

// 退避した状態を読む。v15〜v17 の1社分の退避（data）も読める。壊れている・形式が違うときは null
export function loadUndo(storage = defaultStorage()) {
  try {
    const text = storage?.getItem(UNDO_KEY);
    if (!text) return null;
    const raw = JSON.parse(text);
    if (!isPlainObject(raw) || !(raw.action in UNDO_ACTIONS)) return null;
    const src = raw.workspace ?? raw.data;
    if (isWorkspace(src) ? validateWorkspace(src).length : validateData(src).length) return null;
    const workspace = toWorkspace(src);
    if (!workspace) return null;
    const at = new Date(raw.at);
    const n = activeCompany(workspace).periods.length;
    const selected = Number.isInteger(raw.selected) ? Math.min(Math.max(raw.selected, 0), n - 1) : 0;
    return { action: raw.action, label: UNDO_ACTIONS[raw.action], selected, at: Number.isNaN(at.getTime()) ? null : at, workspace };
  } catch {
    return null;
  }
}

export function clearUndo(storage = defaultStorage()) {
  try {
    storage?.removeItem(UNDO_KEY);
  } catch {
    // 消せなくても次の退避で上書きされる
  }
}
