// ダイアログ（ヘルプ・初回ガイド・更新履歴）
import { LAST_VERSION_KEY, changesSince } from '../changelog.js';
import { ONBOARDING_KEY, ONBOARDING_STEPS, indicatorHelp } from '../help.js';
import { APP_VERSION } from '../pwa.js';
import { hasAnyData } from '../store.js';
import { setView } from './app.js';
import { onLoadSample } from './backup.js';
import { $, days, el, evaluation, settings, state } from './core.js';


export let modalOnClose = null;

export let modalReturnFocus = null;

// actions = [{ label, primary, onClick }]。onClick が false を返したときは閉じない
export function openModal({ title, body, actions = [{ label: '閉じる', primary: true }], onClose = null }) {
  if ($('modal').hidden) modalReturnFocus = document.activeElement;
  modalOnClose = onClose;
  $('modalTitle').textContent = title;
  $('modalBody').replaceChildren(...body);
  $('modalActions').replaceChildren(...actions.map((a) => {
    const b = el('button', { type: 'button', className: `btn${a.primary ? ' btn-primary' : ''}`, text: a.label });
    b.addEventListener('click', () => {
      if (a.onClick && a.onClick() === false) return;
      closeModal();
    });
    return b;
  }));
  $('modal').hidden = false;
  $('modalBody').scrollTop = 0;
  ($('modalActions').querySelector('.btn-primary') ?? $('modalActions').firstChild)?.focus();
}

export function closeModal() {
  if ($('modal').hidden) return;
  $('modal').hidden = true;
  const fn = modalOnClose;
  modalOnClose = null;
  if (fn) fn();
  if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
}

export function helpButton(id, name) {
  const b = el('button', { type: 'button', className: 'help-btn', 'aria-label': `${name}の説明`, text: '?' });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp(id);
  });
  return b;
}

export function helpBody(h) {
  const dl = el('dl', { className: 'help-list' }, [
    el('dt', { text: '計算式' }), el('dd', { text: h.formula }),
    el('dt', { text: '意味・見方' }), el('dd', { text: h.meaning }),
  ]);
  if (h.guide) {
    dl.append(el('dt', { text: '評価の目安' }), el('dd', {}, [
      el('span', { text: `${h.guide.text}（${h.guide.source}）` }),
      ...h.guide.notes.map((n) => el('span', { className: 'guide-note', text: n })),
    ]));
  }
  return dl;
}

export function openHelp(id) {
  const h = indicatorHelp(id, { days: days(), evaluation: evaluation() });
  if (!h) return;
  openModal({
    title: h.name,
    body: [helpBody(h)],
    actions: [
      { label: '指標の解説一覧', onClick: () => { state.settingsPage = 'glossary'; setView('settings'); } },
      { label: '閉じる', primary: true },
    ],
  });
}

export function changelogList(entries) {
  return el('div', { className: 'changelog' }, entries.map((e) => el('section', { className: 'changelog-entry' }, [
    el('p', { className: 'changelog-head', text: `${e.version}（${e.date}）` }),
    el('ul', {}, e.items.map((t) => el('li', { text: t }))),
  ])));
}

// 更新後の最初の起動で、前回のバージョンからの変更点を表示する。初めての起動では記録だけする
export function showChangesIfUpdated() {
  let prev = null;
  try {
    prev = localStorage.getItem(LAST_VERSION_KEY);
    localStorage.setItem(LAST_VERSION_KEY, APP_VERSION);
  } catch {
    return false;
  }
  // 更新履歴の記録を始める前から使っている人（データあり・記録なし）には最新分を出す
  if (prev === null && hasAnyData(state.data)) prev = 'unknown';
  const changes = changesSince(prev, APP_VERSION);
  if (!changes.length) return false;
  openModal({ title: `${APP_VERSION} に更新しました`, body: [changelogList(changes)] });
  return true;
}

export function readOnboarded() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== null;
  } catch {
    return true; // 保存できない環境では毎回出さない
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());
  } catch {
    // 保存できなくても使える
  }
}

export function isStandalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export function openOnboarding(step = 0) {
  const s = ONBOARDING_STEPS[step];
  const last = step === ONBOARDING_STEPS.length - 1;
  const body = [
    el('p', { className: 'onb-step', text: `${step + 1} / ${ONBOARDING_STEPS.length}` }),
    ...s.lines.map((t) => el('p', { text: t })),
  ];
  if (s.id === 'protect' && isStandalone()) body.push(el('p', { className: 'note', text: 'いまはホーム画面から起動しています（追加済みです）。' }));
  const actions = [];
  if (step > 0) actions.push({ label: '戻る', onClick: () => { openOnboarding(step - 1); return false; } });
  else actions.push({ label: 'スキップ' });
  if (s.action === 'sample') {
    actions.push({ label: 'サンプルで試す', onClick: () => { closeModal(); onLoadSample(); setView('compare'); return false; } });
  }
  actions.push(last
    ? { label: 'はじめる', primary: true }
    : { label: '次へ', primary: true, onClick: () => { openOnboarding(step + 1); return false; } });
  openModal({ title: s.title, body, actions, onClose: markOnboarded });
}
