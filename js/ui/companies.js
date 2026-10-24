// 複数社（顧問先・案件）の切り替えと管理
import {
  MAX_COMPANIES, addCompany, companyLabel, duplicateCompany, moveCompany, removeCompany, renameCompany,
  setActiveCompany, workspaceSize,
} from '../workspace.js';
import { keepUndo, onExport, rerenderAll, showUndoToast } from './backup.js';
import { $, el, saveNow, setWorkspace, showToast, state } from './core.js';
import { closeModal, openModal } from './dialogs.js';
import { openSettingsPage, renderSettings, smallBtn } from './settings-view.js';
import { setView } from './app.js';

// 画面上部の「会社：○○ ▾」
export function renderCompanyBar() {
  const n = state.workspace.companies.length;
  const i = state.workspace.companies.findIndex((c) => c.id === state.workspace.activeId);
  const b = el('button', { type: 'button', className: 'company-switch', 'aria-haspopup': 'dialog' }, [
    el('span', { className: 'company-switch-label', text: '会社' }),
    el('span', { className: 'company-switch-name', text: companyLabel(state.data) }),
    el('span', { className: 'company-switch-count', text: n > 1 ? `${i + 1}/${n}` : '' }),
    el('span', { className: 'company-switch-arrow', 'aria-hidden': 'true', text: '▾' }),
  ]);
  b.addEventListener('click', openCompanySwitcher);
  $('companyBar').replaceChildren(b);
}

function applyWorkspace(ws, message) {
  setWorkspace(ws);
  rerenderAll();
  saveNow();
  if (message) showToast(message);
}

export function switchCompany(id) {
  if (id === state.workspace.activeId) return;
  saveNow();
  applyWorkspace(setActiveCompany(state.workspace, id), null);
  showToast(`「${companyLabel(state.data)}」に切り替えました`);
}

export function onAddCompany() {
  saveNow();
  if (state.workspace.companies.length >= MAX_COMPANIES) {
    showToast(`会社は${MAX_COMPANIES}社まで登録できます`);
    return;
  }
  applyWorkspace(addCompany(state.workspace), '新しい会社を追加しました。会社名を入力してください');
  if (state.view !== 'input') setView('input');
  $('companyName').focus();
}

function onDuplicateCompany(c) {
  saveNow();
  if (state.workspace.companies.length >= MAX_COMPANIES) {
    showToast(`会社は${MAX_COMPANIES}社まで登録できます`);
    return;
  }
  applyWorkspace(duplicateCompany(state.workspace, c.id), `「${companyLabel(c)}」を複製しました`);
}

function onRenameCompany(c) {
  const name = window.prompt('会社名', c.companyName);
  if (name === null) return;
  saveNow();
  applyWorkspace(renameCompany(state.workspace, c.id, name.trim()), null);
}

function onRemoveCompany(c) {
  if (state.workspace.companies.length <= 1) return;
  if (!window.confirm(`「${companyLabel(c)}」のデータ（全期の入力・調整項目）を削除します。よろしいですか？`)) return;
  saveNow();
  const undoable = keepUndo('removeCompany');
  setWorkspace(removeCompany(state.workspace, c.id));
  rerenderAll();
  saveNow();
  showUndoToast(`「${companyLabel(c)}」を削除しました`, undoable);
}

function onMoveCompany(c, delta) {
  saveNow();
  applyWorkspace(moveCompany(state.workspace, c.id, delta), null);
}

// 切り替え用のダイアログ
export function openCompanySwitcher() {
  saveNow();
  const list = el('div', { className: 'company-pick' }, state.workspace.companies.map((c) => {
    const current = c.id === state.workspace.activeId;
    const b = el('button', { type: 'button', className: `company-pick-item${current ? ' current' : ''}`, 'aria-current': current ? 'true' : 'false' }, [
      el('span', { className: 'company-pick-name', text: companyLabel(c) }),
      el('span', { className: 'company-pick-meta', text: current ? '選択中' : `${c.periods.length}期` }),
    ]);
    b.addEventListener('click', () => {
      closeModal();
      switchCompany(c.id);
    });
    return b;
  }));
  openModal({
    title: '会社を切り替える',
    body: [list],
    actions: [
      { label: '会社の管理', onClick: () => { state.settingsPage = 'companies'; setView('settings'); } },
      { label: '＋ 会社を追加', onClick: onAddCompany },
      { label: '閉じる', primary: true },
    ],
  });
}

// 設定タブ「会社の管理」
export function renderCompaniesPage(panel) {
  const ws = state.workspace;
  const n = ws.companies.length;
  panel.append(el('p', { className: 'note', text: `顧問先・案件ごとにデータを分けて保存できます（最大${MAX_COMPANIES}社）。設定（単位・科目・評価基準など）は全社共通です。画面上部の「会社」から切り替えられます。` }));
  const list = el('div', { className: 'company-list' });
  ws.companies.forEach((c, i) => {
    const current = c.id === ws.activeId;
    const sel = el('button', { type: 'button', className: 'btn btn-small', text: current ? '選択中' : '選択' });
    sel.disabled = current;
    sel.addEventListener('click', () => { switchCompany(c.id); renderSettings(); });
    list.append(el('div', { className: `company-row${current ? ' current' : ''}` }, [
      el('div', { className: 'company-row-head' }, [
        el('span', { className: 'company-row-name', text: companyLabel(c) }),
        el('span', { className: 'company-row-meta', text: `${c.periods.length}期` }),
      ]),
      el('div', { className: 'company-row-actions' }, [
        sel,
        smallBtn('↑', `${companyLabel(c)}を上へ`, () => { onMoveCompany(c, -1); renderSettings(); }, i === 0),
        smallBtn('↓', `${companyLabel(c)}を下へ`, () => { onMoveCompany(c, 1); renderSettings(); }, i === n - 1),
        textBtn('名前変更', () => { onRenameCompany(c); renderSettings(); }),
        textBtn('複製', () => { onDuplicateCompany(c); renderSettings(); }, n >= MAX_COMPANIES),
        textBtn('削除', () => { onRemoveCompany(c); renderSettings(); }, n <= 1, 'btn-danger'),
      ]),
    ]));
  });
  const add = el('button', { type: 'button', className: 'btn btn-primary', text: '＋ 会社を追加' });
  add.disabled = n >= MAX_COMPANIES;
  add.addEventListener('click', onAddCompany);
  const backupAll = el('button', { type: 'button', className: 'btn', text: '全社のバックアップ' });
  backupAll.addEventListener('click', async () => { await onExport('all'); renderSettings(); });
  const size = workspaceSize(ws);
  panel.append(
    list,
    el('div', { className: 'actions' }, [add, backupAll]),
    el('p', { className: 'note', text: `保存データの大きさ：約${Math.ceil(size / 1024).toLocaleString('ja-JP')}KB（ブラウザの保存領域はおおむね5MBまで）。` }),
    el('p', { className: 'note', text: '1社分のバックアップは入力タブ・データ管理の「この会社のバックアップ」から保存できます。復元するときは、新しい会社として追加するか、選択中の会社に上書きするかを選べます。' }),
  );
  const link = el('button', { type: 'button', className: 'btn', text: 'バックアップ・データ管理へ' });
  link.addEventListener('click', () => openSettingsPage('data'));
  panel.append(el('div', { className: 'actions' }, [link]));
}

function textBtn(text, onClick, disabled = false, cls = '') {
  const b = el('button', { type: 'button', className: `btn btn-small ${cls}`.trim(), text });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}
