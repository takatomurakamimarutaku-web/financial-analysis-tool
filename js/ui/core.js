// 共通の状態・表示ヘルパー・保存・通知
import { criterionLabel } from '../badges.js';
import { daysInYearOf, formatAmount, formatValue, isNum, negativeMark } from '../calc.js';
import { formatOptions, toDisplayAmount, unitOf } from '../settings.js';
import { createEmptyData } from '../store.js';
import { activeData, createWorkspace, saveWorkspace, withActiveData } from '../workspace.js';
import { setView } from './app.js';
import { renderGlobalWarnings } from './input.js';
import { toggle } from './settings-view.js';

export const SAVE_DELAY_MS = 300;

export const state = {
  workspace: createWorkspace(), // 全社のデータ（保存の単位）
  data: createEmptyData(), // 選択中の会社のデータ（画面はこれを扱う。保存時に workspace に書き戻す）
  storageError: null,
  selected: 0, // 入力タブで選択中の期
  view: 'input',
  basis: 'end',
  showChange: true,
  settingsPage: null, // 設定タブで開いている画面（null = 一覧）
};

export let saveTimer = null;

export const $ = (id) => document.getElementById(id);

export function currentPeriod() {
  return state.data.periods[state.selected];
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}


export function settings() {
  return state.data.settings;
}

// scope = 単位の区分（pl / bs / ebitda / netDebt / compare / report）。省略時は分析結果・比較表の単位
export function fmt(scope = 'compare') {
  return formatOptions(settings(), scope);
}

export function unitName(scope = 'compare') {
  return unitOf(settings(), scope).name;
}

export function days() {
  return daysInYearOf(state.data);
}

export function fa(v, scope) {
  return formatAmount(v, fmt(scope));
}

export function fv(result, unit, scope) {
  return formatValue(result, unit, fmt(scope));
}

// 入力欄の表示用（内部値は千円。区分の単位に換算し、丸めずにカンマ区切り。マイナスの表記は設定に従う）
export function formatInput(v, scope) {
  const d = toDisplayAmount(v, settings(), scope);
  if (!isNum(d)) return '';
  return negativeMark(d.toLocaleString('ja-JP', { maximumFractionDigits: 10 }), fmt(scope));
}


export const THEME_KEY = 'finAnalysisTool.theme';

// 設定のテーマを画面に反映し、次回の起動時に描画前に読めるよう保存する（index.html の先頭で読む）
export function applyTheme() {
  const t = settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // 保存できなくても表示には影響しない
  }
}


export function evaluation() {
  return settings().evaluation;
}

export function badgeEl(b, small = false) {
  return el('span', { className: `badge badge-${b.level}${small ? ' badge-small' : ''}`, text: b.text });
}

// 「評価基準：○○ ›」。タップで設定の評価基準ページを開く
export function criterionBar() {
  const ev = evaluation();
  const b = el('button', { type: 'button', className: 'criterion-bar' }, [
    el('span', { className: 'criterion-label', text: '評価基準' }),
    el('span', { className: 'criterion-name', text: ev.enabled ? criterionLabel(ev) : 'バッジ表示オフ' }),
    el('span', { className: 'criterion-arrow', 'aria-hidden': 'true', text: '›' }),
  ]);
  b.addEventListener('click', () => {
    state.settingsPage = 'evaluation';
    setView('settings');
  });
  return b;
}


// ワークスペース（全社）を画面に読み込む。selected 省略時は最後の期を選ぶ
export function setWorkspace(ws, selected = null) {
  state.workspace = ws;
  state.data = activeData(ws);
  const n = state.data.periods.length;
  state.selected = Number.isInteger(selected) ? Math.min(Math.max(selected, 0), n - 1) : n - 1;
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

// 保存待ちを取り消す（すべてのデータを削除するとき）
export function cancelPendingSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

export function hasPendingSave() {
  return saveTimer !== null;
}

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  state.workspace = withActiveData(state.workspace, state.data);
  const { ok, error } = saveWorkspace(state.workspace);
  const next = ok ? null : error;
  if (state.storageError !== next) {
    state.storageError = next;
    renderGlobalWarnings();
  }
}


export function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export let toastTimer = null;

// action = { label, onClick }（「元に戻す」など）。ボタンがあるときは長めに表示する
export function showToast(msg, action = null, duration = 2000) {
  const t = $('toast');
  $('toastText').textContent = msg;
  t.querySelector('.toast-action')?.remove();
  if (action) {
    const b = el('button', { type: 'button', className: 'toast-action', text: action.label });
    b.addEventListener('click', () => {
      t.classList.remove('show', 'has-action');
      action.onClick();
    });
    t.append(b);
  }
  t.classList.toggle('has-action', Boolean(action));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show', 'has-action'), duration);
}
