// バックアップ・復元・クリア・元に戻す
import { buildResultText, calcIndicators, getWarnings } from '../calc.js';
import { indicatorList } from '../settings.js';
import {
  backupFileName, backupToJson, clearUndo, createEmptyData, createUndoSnapshot, getLastBackupAt, getSampleMultiData, loadUndo, needsBackupReminder, normalizeData, parseBackup, saveUndo, setLastBackupAt,
} from '../store.js';
import { hasAnyInput, update } from './app.js';
import { $, currentPeriod, days, el, fmt, formatDateTime, saveNow, settings, showToast, state } from './core.js';
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

export async function onExport() {
  saveNow();
  const now = new Date();
  const file = new File([backupToJson(state.data, now)], backupFileName(now), { type: 'application/json' });
  try {
    // iPhone では共有シートから「"ファイル"に保存」できる
    if (!(await saveFile(file))) return; // 共有をキャンセルした
  } catch {
    showToast('バックアップを保存できませんでした');
    return;
  }
  setLastBackupAt(now);
  renderBackupStatus();
  showToast('バックアップを作成しました');
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
  const result = parseBackup(text);
  if (!result.ok) {
    window.alert(`復元できませんでした。\n${result.error}`);
    return;
  }
  const when = result.exportedAt ? `（${formatDateTime(new Date(result.exportedAt))} 作成）` : '';
  if (!window.confirm(`バックアップ${when}で現在のデータを上書きします。よろしいですか？`)) return;
  const undoable = hasAnyInput() && keepUndo('restore');
  state.data = result.data;
  state.selected = state.data.periods.length - 1;
  state.basis = state.data.settings.analysis.defaultBasis;
  if (state.view === 'settings') renderSettings();
  renderForm();
  update();
  saveNow();
  showUndoToast('バックアップから復元しました', undoable);
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
  return saveUndo(createUndoSnapshot(state.data, action, state.selected));
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
  state.data = u.data;
  state.selected = u.selected;
  state.basis = state.data.settings.analysis.defaultBasis;
  clearUndo();
  if (state.view === 'settings') renderSettings();
  renderForm();
  update();
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
