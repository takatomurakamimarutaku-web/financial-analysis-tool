// バックアップ・復元・クリア・元に戻す
import { buildResultText, calcIndicators, getWarnings } from '../calc.js';
import { indicatorList } from '../settings.js';
import {
  backupFileName, backupToJson, createEmptyData, getLastBackupAt, getSampleMultiData, needsBackupReminder, normalizeData, setLastBackupAt,
} from '../store.js';
import {
  MAX_COMPANIES, activeData, addCompany, clearUndo, companyLabel, createUndoSnapshot, loadUndo, parseAnyBackup, saveUndo,
  workspaceBackupFileName,
} from '../workspace.js';
import { renderCompanyBar } from './companies.js';
import { openModal } from './dialogs.js';
import { hasAnyInput, update } from './app.js';
import { $, currentPeriod, days, el, fmt, formatDateTime, saveNow, setWorkspace, settings, showToast, state } from './core.js';
import { periodName, renderForm } from './input.js';
import { saveFile } from './report.js';
import { renderSettings } from './settings-view.js';

export function renderBackupStatus() {
  const last = getLastBackupAt();
  $('lastBackup').textContent = last ? `最終バックアップ：${formatDateTime(last)}` : '最終バックアップ：未実施';
  $('backupReminder').hidden = !needsBackupReminder(last, hasAnyInput(), new Date(), settings().backupReminderDays);
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// scope = 'company'（選択中の会社だけ）| 'all'（全社）
export async function onExport(scope = 'company') {
  saveNow();
  const now = new Date();
  const all = scope === 'all';
  const file = new File(
    [backupToJson(all ? state.workspace : state.data, now)],
    all ? workspaceBackupFileName(now) : backupFileName(now),
    { type: 'application/json' },
  );
  try {
    // iPhone では共有シートから「"ファイル"に保存」できる
    if (!(await saveFile(file))) return; // 共有をキャンセルした
  } catch {
    showToast('バックアップを保存できませんでした');
    return;
  }
  setLastBackupAt(now);
  renderBackupStatus();
  showToast(all ? `全社（${state.workspace.companies.length}社）のバックアップを作成しました` : `「${companyLabel(state.data)}」のバックアップを作成しました`);
}

export function onImportClick() {
  $('importFile').value = '';
  $('importFile').click();
}

export async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    showToast('ファイルを読み込めませんでした');
    return;
  }
  const result = parseAnyBackup(text);
  if (!result.ok) {
    window.alert(`復元できませんでした。\n${result.error}`);
    return;
  }
  const when = result.exportedAt ? `（${formatDateTime(new Date(result.exportedAt))} 作成）` : '';
  if (result.kind === 'workspace') {
    const n = result.workspace.companies.length;
    if (!window.confirm(`全社のバックアップ${when}（${n}社）で、この端末のすべての会社のデータと設定を置き換えます。よろしいですか？`)) return;
    restoreWorkspace(result.workspace, '全社のバックアップから復元しました');
    return;
  }
  // 1社分のバックアップ：新しい会社として追加するか、選択中の会社に上書きするかを選ぶ
  const name = companyLabel(result.data);
  const actions = [];
  if (state.workspace.companies.length < MAX_COMPANIES) {
    actions.push({ label: '新しい会社として追加', primary: true, onClick: () => restoreCompany(result.data, 'add') });
  }
  actions.push({ label: `「${companyLabel(state.data)}」に上書き`, onClick: () => restoreCompany(result.data, 'overwrite') });
  actions.push({ label: 'やめる' });
  openModal({
    title: '1社分のバックアップを復元',
    body: [
      el('p', { text: `「${name}」のバックアップ${when}です。` }),
      el('p', { className: 'note', text: '「上書き」は選択中の会社のデータと、全社共通の設定をバックアップの内容に置き換えます。「追加」は今の設定のまま会社を追加します。' }),
    ],
    actions,
  });
}

function restoreWorkspace(ws, message) {
  const undoable = keepUndo('restore');
  setWorkspace(ws);
  state.basis = state.data.settings.analysis.defaultBasis;
  rerenderAll();
  saveNow();
  showUndoToast(message, undoable);
}

function restoreCompany(data, mode) {
  saveNow();
  if (mode === 'add') {
    restoreWorkspace(addCompany(state.workspace, { ...data, settings: state.workspace.settings }), `「${companyLabel(data)}」を追加しました`);
    return;
  }
  const undoable = keepUndo('restore');
  state.data = data;
  state.selected = state.data.periods.length - 1;
  state.basis = state.data.settings.analysis.defaultBasis;
  rerenderAll();
  saveNow();
  showUndoToast('バックアップから復元しました', undoable);
}

// 会社の切り替え・復元などで画面全体を描き直す
export function rerenderAll() {
  if (state.view === 'settings') renderSettings();
  renderCompanyBar();
  renderForm();
  update();
}

export function onLoadSample() {
  if (hasAnyInput() && !window.confirm('入力中のデータをサンプルデータで上書きします。よろしいですか？')) return;
  const undoable = hasAnyInput() && keepUndo('sample');
  state.data = normalizeData({ ...getSampleMultiData(), settings: settings() });
  state.selected = state.data.periods.length - 1;
  renderForm();
  update();
  saveNow();
  showUndoToast('サンプルデータを読み込みました', undoable);
}

export function onClear() {
  if (!window.confirm('すべての期の入力内容をクリアします（設定はそのまま）。よろしいですか？')) return;
  const undoable = keepUndo('clear');
  state.data = createEmptyData(settings());
  state.selected = 0;
  renderForm();
  update();
  saveNow();
  showUndoToast('クリアしました', undoable);
}

// 操作の直前の状態を退避する。退避できたら true
export function keepUndo(action) {
  saveNow();
  return saveUndo(createUndoSnapshot(state.workspace, action, state.selected));
}

export function showUndoToast(msg, undoable) {
  if (undoable) showToast(msg, { label: '元に戻す', onClick: onUndo }, 8000);
  else showToast(msg);
}

export function onUndo() {
  const u = loadUndo();
  if (!u) {
    showToast('元に戻せるデータがありません');
    return;
  }
  setWorkspace(u.workspace, u.selected);
  state.basis = state.data.settings.analysis.defaultBasis;
  clearUndo();
  rerenderAll();
  saveNow();
  showToast(`「${u.label}」の前の状態に戻しました`);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 下の方式で再試行する
  }
  try {
    const ta = el('textarea', { readonly: '', style: 'position:fixed;top:0;left:0;opacity:0;' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function onCopy() {
  const p = currentPeriod();
  const opts = { ...fmt(), indicators: indicatorList(settings()) };
  const text = buildResultText(state.data, calcIndicators(p, { days: days() }), getWarnings(p, fmt('bs'), fmt('pl')), state.selected, opts);
  const ok = await copyText(text);
  showToast(ok ? `${periodName(p, state.selected)}の結果をコピーしました` : 'コピーできませんでした');
}
