// 画面描画とイベント処理
import {
  CATEGORIES, INDICATORS, MAX_PERIODS, CHART_ROWS,
  calcIndicators, getWarnings, formatValue, buildResultText, parseAmount, isNum, negativeMark,
  buildComparison, formatChangeAmount, formatChangeRate, formulaText, daysInYearOf,
  ADJUSTMENT_CATEGORIES, calcNormalizedEbitda, getAdjustmentWarnings, buildEbitdaBridge, formatAmount,
  DEBT_LIKE_EXAMPLES, CASH_LIKE_EXAMPLES, calcWorkingCapital, calcWorkingCapitalSeries,
  calcAdjustedNetDebt, getNetDebtItemWarnings, buildNetDebtBreakdown,
} from './calc.js';
import {
  loadData, saveData, createEmptyData, getSampleMultiData, normalizeData,
  addPeriod, removePeriod, movePeriod,
  backupToJson, backupFileName, parseBackup, getLastBackupAt, setLastBackupAt,
  needsBackupReminder, hasAnyData,
  createAdjustment, addAdjustment, removeAdjustment,
  createLineItem, addLineItem, removeLineItem, deleteAllData,
  createUndoSnapshot, saveUndo, loadUndo, clearUndo,
} from './store.js';
import {
  DISCLAIMER, PRIVACY, REPORT_DISCLAIMER, COPYRIGHT, LICENSE_TEXT, CONTACT, ONBOARDING_STEPS, ONBOARDING_KEY, NA_RULES,
  indicatorHelp, hasHelp, helpCatalog,
} from './help.js';
import { CHANGELOG, LAST_VERSION_KEY, changesSince } from './changelog.js';
import { buildLineChartSvg } from './chart.js';
import {
  plSteps, ebitdaSteps, netDebtSteps, buildWaterfallSvg, bsBoxes, buildBsBoxSvg, cccParts, buildCccSvg,
} from './diagrams.js';
import { buildComparisonCsv, buildBridgeCsv, buildNetDebtCsv, csvFileName, CSV_KINDS } from './csv.js';
import {
  registerServiceWorker, requestPersistentStorage, checkForUpdate, isStoragePersisted, APP_VERSION,
} from './pwa.js';
import {
  AMOUNT_UNITS, UNIT_SCOPES, commonUnit, setUnit, THEMES, NEGATIVE_STYLES, BACKUP_REMINDER_CHOICES, DIGIT_LIMITS, createDefaultSettings, unitOf, toDisplayAmount, fromDisplayAmount,
  formatOptions, accountLabel, accountTree, renameAccount, setAccountHidden, moveAccount, addCustomAccount,
  removeCustomAccount, applyAccountTotalsToPeriod, isComputedAccount, indicatorList, setIndicatorHidden, moveIndicator,
  arrangeComparisonRows, rowLabel, categoryLabel, renameCategory, updateSettings, OTHER_DETAIL_LABEL, MAX_CUSTOM_ACCOUNTS,
} from './settings.js';
import {
  CRITERIA, JFC_INDUSTRIES, BADGE_TARGETS, TKC_TARGETS, badgeFor, badgesFor, criterionLabel, guideFor, ruleFor,
  setCriterion, setOverride, resetOverrides, setTkcValue, setBadgeDisabled, isModified, reportNote,
} from './badges.js';

const SAVE_DELAY_MS = 300;

const state = {
  data: createEmptyData(),
  storageError: null,
  selected: 0, // 入力タブで選択中の期
  view: 'input',
  basis: 'end',
  showChange: true,
  settingsPage: null, // 設定タブで開いている画面（null = 一覧）
};

let saveTimer = null;

const $ = (id) => document.getElementById(id);

function currentPeriod() {
  return state.data.periods[state.selected];
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ---- 設定に応じた表示 ----

function settings() {
  return state.data.settings;
}

// scope = 単位の区分（pl / bs / ebitda / netDebt / compare / report）。省略時は分析結果・比較表の単位
function fmt(scope = 'compare') {
  return formatOptions(settings(), scope);
}

function unitName(scope = 'compare') {
  return unitOf(settings(), scope).name;
}

function days() {
  return daysInYearOf(state.data);
}

function fa(v, scope) {
  return formatAmount(v, fmt(scope));
}

function fv(result, unit, scope) {
  return formatValue(result, unit, fmt(scope));
}

// 入力欄の表示用（内部値は千円。区分の単位に換算し、丸めずにカンマ区切り。マイナスの表記は設定に従う）
function formatInput(v, scope) {
  const d = toDisplayAmount(v, settings(), scope);
  if (!isNum(d)) return '';
  return negativeMark(d.toLocaleString('ja-JP', { maximumFractionDigits: 10 }), fmt(scope));
}

// ---- 表示テーマ ----

const THEME_KEY = 'finAnalysisTool.theme';

// 設定のテーマを画面に反映し、次回の起動時に描画前に読めるよう保存する（index.html の先頭で読む）
function applyTheme() {
  const t = settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // 保存できなくても表示には影響しない
  }
}

// ---- 評価バッジ ----

function evaluation() {
  return settings().evaluation;
}

function badgeEl(b, small = false) {
  return el('span', { className: `badge badge-${b.level}${small ? ' badge-small' : ''}`, text: b.text });
}

// 「評価基準：○○ ›」。タップで設定の評価基準ページを開く
function criterionBar() {
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

// ---- ダイアログ（ヘルプ・初回ガイド） ----

let modalOnClose = null;
let modalReturnFocus = null;

// actions = [{ label, primary, onClick }]。onClick が false を返したときは閉じない
function openModal({ title, body, actions = [{ label: '閉じる', primary: true }], onClose = null }) {
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

function closeModal() {
  if ($('modal').hidden) return;
  $('modal').hidden = true;
  const fn = modalOnClose;
  modalOnClose = null;
  if (fn) fn();
  if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
}

function helpButton(id, name) {
  const b = el('button', { type: 'button', className: 'help-btn', 'aria-label': `${name}の説明`, text: '?' });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp(id);
  });
  return b;
}

function helpBody(h) {
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

function openHelp(id) {
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

function changelogList(entries) {
  return el('div', { className: 'changelog' }, entries.map((e) => el('section', { className: 'changelog-entry' }, [
    el('p', { className: 'changelog-head', text: `${e.version}（${e.date}）` }),
    el('ul', {}, e.items.map((t) => el('li', { text: t }))),
  ])));
}

// 更新後の最初の起動で、前回のバージョンからの変更点を表示する。初めての起動では記録だけする
function showChangesIfUpdated() {
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

function readOnboarded() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== null;
  } catch {
    return true; // 保存できない環境では毎回出さない
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());
  } catch {
    // 保存できなくても使える
  }
}

function isStandalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function openOnboarding(step = 0) {
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

// ---- サマリー（入力タブ先頭） ----

const SUMMARY_ROWS = ['sales', 'operatingIncome', 'ebitda', 'equityRatio'];

function renderSummary() {
  $('summaryPeriodName').textContent = periodName(currentPeriod(), state.selected);
  const cmp = buildComparison(state.data, 'end');
  const i = state.selected;
  const find = (id) => cmp.rows.find((r) => r.id === id);
  // 正常化の調整がある期は、EBITDA の代わりに正常化EBITDA を表示する
  const useNormalized = (currentPeriod().adjustments ?? []).length > 0;
  const ids = SUMMARY_ROWS.map((id) => (id === 'ebitda' && useNormalized ? 'normalizedEbitda' : id));
  const tiles = ids.map((id) => {
    const row = find(id);
    const cell = row.cells[i];
    const r = cell.result;
    const isAmount = row.unit === '千円';
    const value = isAmount ? (isNum(r.value) ? `${fa(r.value)}${unitName()}` : '—') : fv(r, row.unit);
    const subs = [];
    if (id === 'operatingIncome') {
      const m = find('operatingMargin').cells[i].result;
      subs.push(el('span', { text: `営業利益率 ${fv(m, '%')}` }));
    }
    if (cell.change && cell.change.rateStatus !== undefined && i > 0) {
      const ch = cell.change;
      const text = row.unit === '%' ? formatChangeAmount(ch, '%', fmt()) : formatChangeRate(ch, fmt());
      const dir = isNum(ch.amount) ? (ch.amount > 0 ? 'up' : ch.amount < 0 ? 'down' : '') : '';
      if (text !== '—') subs.push(el('span', {}, ['前期比 ', el('span', { className: dir, text })]));
    }
    const cls = ['kpi-value'];
    if (r.status !== 'ok') cls.push('na');
    else if (r.value < 0) cls.push('negative');
    const badge = badgeFor(id, r, currentPeriod(), evaluation());
    return el('div', { className: 'kpi' }, [
      el('span', { className: 'kpi-label', text: rowLabel(settings(), row) }),
      el('span', { className: cls.join(' '), text: value }),
      ...(badge ? [badgeEl(badge, true)] : []),
      ...subs.map((x) => el('span', { className: 'kpi-sub' }, [x])),
    ]);
  });
  $('summaryGrid').replaceChildren(...tiles);
}

// 区分の単位で入力された文字列 → 内部値（千円）。解釈できなければ null
function parseInput(text, scope) {
  return fromDisplayAmount(parseAmount(text), settings(), scope);
}

// 画面内の単位表記（.unit-name の data-scope の区分）を設定に合わせる。data-scope="all" は全区分が同じなら単位、違えば「区分ごと」
function renderUnitLabels() {
  document.querySelectorAll('.unit-name').forEach((n) => {
    const scope = n.dataset.scope || 'compare';
    n.textContent = scope === 'all' ? (commonUnit(settings())?.name ?? '区分ごとに設定') : unitName(scope);
  });
}

function periodName(p, i) {
  return p.label || `第${i + 1}期`;
}

// ---- 保存 ----

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const { ok, error } = saveData(state.data);
  const next = ok ? null : error;
  if (state.storageError !== next) {
    state.storageError = next;
    renderGlobalWarnings();
  }
}

// ---- 入力タブ ----

function amountInput(id, attrs, value, scope) {
  const input = el('input', {
    id, type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', ...attrs,
  });
  input.value = formatInput(value, scope);
  return input;
}

// 科目の入力欄。並び・名称・非表示は設定に従い、内訳科目は親科目の下に並べる。
function renderAmountFields(containerId, section) {
  const container = $(containerId);
  container.replaceChildren();
  const p = currentPeriod();
  for (const a of accountTree(settings(), section)) {
    if (a.hidden) continue;
    const id = `f-${section}-${a.key}`;
    const input = amountInput(id, { 'data-section': section, 'data-key': a.key }, p[section][a.key], section);
    input.addEventListener('input', onFieldInput);
    input.addEventListener('blur', onFieldBlur);
    const sign = el('button', { type: 'button', className: 'sign-btn', 'aria-label': `${a.label}の符号を反転`, text: '±' });
    sign.addEventListener('click', () => toggleSign(section, a.key, input));
    const row = el('div', { className: 'amount-row', 'data-row': a.key }, [el('label', { for: id, text: a.label }), input, sign]);
    container.append(row);
    if (a.children.length) row.append(el('span', { className: 'computed-note', text: '内訳の合計' }));
    for (const c of a.children) {
      const cid = `f-detail-${c.key}`;
      const ci = amountInput(cid, { 'data-detail': c.key, 'data-parent': a.key, 'data-section': section }, p.details?.[c.key], section);
      ci.addEventListener('input', onDetailInput);
      ci.addEventListener('blur', onDetailBlur);
      const cs = el('button', { type: 'button', className: 'sign-btn', 'aria-label': `${c.label}の符号を反転`, text: '±' });
      cs.addEventListener('click', () => toggleDetailSign(c.key, ci));
      container.append(el('div', { className: 'amount-row child' }, [el('label', { for: cid, text: c.label }), ci, cs]));
    }
    refreshParentField(section, a.key);
  }
}

// 親科目の入力欄：内訳に値がある期は合計を表示して編集不可にする
function refreshParentField(section, key) {
  const input = $(`f-${section}-${key}`);
  if (!input) return;
  const p = currentPeriod();
  const computed = isComputedAccount(p, settings(), key);
  input.readOnly = computed;
  input.classList.toggle('computed', computed);
  const row = input.closest('.amount-row');
  row?.querySelector('.computed-note')?.toggleAttribute('hidden', !computed);
  if (computed || document.activeElement !== input) input.value = formatInput(p[section][key], section);
}

function setDetail(key, value) {
  const p = currentPeriod();
  p.details = { ...(p.details ?? {}), [key]: value };
  const q = applyAccountTotalsToPeriod(p, settings());
  p.pl = q.pl;
  p.bs = q.bs;
}

function onDetailInput(e) {
  const input = e.target;
  const text = input.value.trim();
  const v = parseInput(text, input.dataset.section);
  setDetail(input.dataset.detail, v);
  input.setAttribute('aria-invalid', text !== '' && v === null ? 'true' : 'false');
  refreshParentField(input.dataset.section, input.dataset.parent);
  update();
}

function onDetailBlur(e) {
  const v = currentPeriod().details?.[e.target.dataset.detail];
  if (isNum(v)) e.target.value = formatInput(v, e.target.dataset.section);
}

function toggleDetailSign(key, input) {
  const v = currentPeriod().details?.[key];
  if (!isNum(v)) {
    input.value = '-';
    input.focus();
    return;
  }
  setDetail(key, -v);
  input.value = formatInput(-v, input.dataset.section);
  refreshParentField(input.dataset.section, input.dataset.parent);
  update();
}

function renderPeriodBar() {
  const box = $('periodChips');
  box.replaceChildren();
  state.data.periods.forEach((p, i) => {
    const chip = el('button', {
      type: 'button',
      className: 'chip',
      role: 'tab',
      'aria-selected': String(i === state.selected),
      text: periodName(p, i),
    });
    chip.addEventListener('click', () => selectPeriod(i));
    box.append(chip);
  });
  const full = state.data.periods.length >= MAX_PERIODS;
  const add = el('button', { type: 'button', className: 'chip chip-add', text: full ? '上限5期' : '＋ 期を追加' });
  if (full) add.disabled = true;
  add.addEventListener('click', onAddPeriod);
  box.append(add);

  $('periodLabel').value = currentPeriod().label;
  $('btnMoveLeft').disabled = state.selected === 0;
  $('btnMoveRight').disabled = state.selected === state.data.periods.length - 1;
}

function renderForm() {
  applyTheme();
  $('companyName').value = state.data.companyName;
  renderPeriodBar();
  renderAmountFields('plFields', 'pl');
  renderAmountFields('bsFields', 'bs');
  renderUnitLabels();
  renderAdjustments();
  renderNetDebtInputs();
}

function onFieldInput(e) {
  const input = e.target;
  const { section, key } = input.dataset;
  const text = input.value.trim();
  const v = parseInput(text, section);
  currentPeriod()[section][key] = v;
  input.setAttribute('aria-invalid', text !== '' && v === null ? 'true' : 'false');
  update();
}

function onFieldBlur(e) {
  const input = e.target;
  const v = currentPeriod()[input.dataset.section][input.dataset.key];
  if (isNum(v)) input.value = formatInput(v, input.dataset.section);
}

function toggleSign(section, key, input) {
  const v = currentPeriod()[section][key];
  if (!isNum(v)) {
    // 未入力時は「-」を入れて入力を促す
    input.value = '-';
    input.focus();
    return;
  }
  currentPeriod()[section][key] = -v;
  input.value = formatInput(-v, section);
  update();
}

function selectPeriod(i) {
  state.selected = i;
  renderForm();
  renderSummary();
  renderInputWarnings();
  renderInputResults();
}

function onAddPeriod() {
  const next = addPeriod(state.data);
  if (next === state.data) return;
  state.data = next;
  state.selected = next.periods.length - 1;
  renderForm();
  update();
}

function onRemovePeriod() {
  const p = currentPeriod();
  if (!window.confirm(`「${periodName(p, state.selected)}」を削除します。よろしいですか？`)) return;
  const undoable = keepUndo('removePeriod');
  state.data = removePeriod(state.data, state.selected);
  state.selected = Math.min(state.selected, state.data.periods.length - 1);
  renderForm();
  update();
  saveNow();
  showUndoToast(`「${periodName(p, state.selected)}」を削除しました`, undoable);
}

function onMovePeriod(delta) {
  const next = movePeriod(state.data, state.selected, delta);
  if (next === state.data) return;
  state.data = next;
  state.selected += delta;
  renderPeriodBar();
  update();
}

function renderInputWarnings() {
  const box = $('warnings');
  box.replaceChildren();
  for (const w of getWarnings(currentPeriod(), fmt('bs'), fmt('pl'))) {
    box.append(el('div', { className: 'warning', text: w.message }));
  }
}

function renderGlobalWarnings() {
  const box = $('warnings-global');
  box.replaceChildren();
  if (state.storageError) {
    box.append(el('div', { className: 'warning error', text: state.storageError }));
  }
  // 保存できない間は画面上部に常に表示する（スクロールしても消えない）
  $('storageBar').hidden = !state.storageError;
  $('storageBarText').textContent = state.storageError
    ? `${state.storageError}。いまの内容はこの画面を閉じると失われます。` : '';
}

function valueClass(base, r) {
  const c = [base];
  if (!r || r.status !== 'ok') c.push('na');
  else if (r.value < 0) c.push('negative');
  return c.join(' ');
}

function renderInputResults() {
  const results = calcIndicators(currentPeriod(), { days: days() });
  const badges = badgesFor(results, currentPeriod(), evaluation());
  const box = $('results');
  box.replaceChildren(criterionBar());
  const list = indicatorList(settings());
  for (const cat of CATEGORIES) {
    const inds = list.filter((i) => i.category === cat.id);
    if (!inds.length) continue;
    const card = el('section', { className: 'panel category' }, [el('h2', { text: cat.name })]);
    for (const ind of inds) {
      const r = results[ind.id];
      const badge = badges[ind.id];
      const guide = guideFor(ind.id, evaluation());
      const details = el('details', { className: 'indicator' }, [
        el('summary', {}, [
          el('span', { className: 'indicator-name', text: ind.name }),
          helpButton(ind.id, ind.name),
          ...(badge ? [badgeEl(badge)] : []),
          el('span', { className: valueClass('indicator-value', r), text: fv(r, ind.unit) }),
        ]),
        el('dl', { className: 'indicator-detail' }, [
          el('dt', { text: '計算式' }),
          el('dd', { text: formulaText(ind, days()) }),
          el('dt', { text: '一般的な見方' }),
          el('dd', { text: ind.guide }),
          ...(guide ? [
            el('dt', { text: '評価の目安' }),
            el('dd', {}, [
              el('span', { text: `${guide.text}（${guide.source}）` }),
              ...guide.notes.map((n) => el('span', { className: 'guide-note', text: n })),
            ]),
          ] : []),
        ]),
      ]);
      card.append(details);
    }
    box.append(card);
  }
}

// ---- 正常化EBITDA（調整項目） ----

function formatSigned(v, scope) {
  if (!isNum(v)) return '—';
  const t = fa(v, scope);
  return v > 0 && t !== '0' ? `+${t}` : t;
}

function renderAdjustments() {
  const p = currentPeriod();
  $('adjPeriodName').textContent = periodName(p, state.selected);
  const list = $('adjList');
  list.replaceChildren();
  p.adjustments.forEach((a, i) => {
    const idBase = `adj-${i}`;
    const select = el('select', { id: `${idBase}-cat`, 'aria-label': '区分' });
    for (const c of ADJUSTMENT_CATEGORIES) {
      const o = el('option', { value: c.id, text: categoryLabel(settings(), c.id) });
      if (c.id === a.category) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => { a.category = select.value; onAdjustmentChanged(); });

    const desc = el('input', { id: `${idBase}-desc`, type: 'text', autocomplete: 'off', placeholder: '例：本社移転費用' });
    desc.value = a.description;
    desc.addEventListener('input', () => { a.description = desc.value; onAdjustmentChanged(); });

    const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: unitName('ebitda') });
    amount.value = formatInput(a.amount, 'ebitda');
    amount.addEventListener('input', () => {
      const text = amount.value.trim();
      a.amount = parseInput(text, 'ebitda');
      amount.setAttribute('aria-invalid', text !== '' && a.amount === null ? 'true' : 'false');
      onAdjustmentChanged();
    });
    amount.addEventListener('blur', () => { if (isNum(a.amount)) amount.value = formatInput(a.amount, 'ebitda'); });
    const sign = el('button', { type: 'button', className: 'sign-btn', 'aria-label': '金額の符号を反転', text: '±' });
    sign.addEventListener('click', () => {
      if (!isNum(a.amount)) {
        amount.value = '-';
        amount.focus();
        return;
      }
      a.amount = -a.amount;
      amount.value = formatInput(a.amount, 'ebitda');
      onAdjustmentChanged();
    });

    const memo = el('textarea', { id: `${idBase}-memo`, rows: '3', placeholder: '根拠メモ（例：役員報酬の市場水準の根拠、発生が一度限りである理由）' });
    memo.value = a.memo;
    memo.addEventListener('input', () => { a.memo = memo.value; onAdjustmentChanged(); });

    const remove = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
    remove.addEventListener('click', () => onRemoveAdjustment(a));

    const item = el('div', { className: 'adj-item', 'data-adj-id': a.id }, [
      el('label', { className: 'field', for: select.id }, [el('span', { className: 'field-label', text: '区分' }), select]),
      el('label', { className: 'field', for: desc.id }, [el('span', { className: 'field-label', text: '内容' }), desc]),
      el('div', { className: 'field' }, [
        el('label', { className: 'field-label', for: amount.id, text: `金額（${unitName('ebitda')}。EBITDAに加算は＋、減算は−）` }),
        el('div', { className: 'adj-amount' }, [amount, sign]),
      ]),
      el('label', { className: 'field', for: memo.id }, [el('span', { className: 'field-label', text: '根拠メモ' }), memo]),
      el('div', { className: 'adj-foot' }, [el('span', { className: 'adj-badges' }), remove]),
    ]);
    list.append(item);
  });
  renderAdjustmentSummary();
}

// 調整項目の一覧は作り直さず（入力中のフォーカスを保つ）、警告とブリッジだけを更新する
function renderAdjustmentSummary() {
  const p = currentPeriod();
  const warnings = getAdjustmentWarnings(p);
  const box = $('adjWarnings');
  box.replaceChildren();
  const memoCount = warnings.filter((w) => w.type === 'memoMissing').length;
  if (memoCount) box.append(el('div', { className: 'warning', text: `根拠未記載の調整項目が${memoCount}件あります` }));

  $('adjList').querySelectorAll('.adj-item').forEach((node, i) => {
    const mine = warnings.filter((w) => w.index === i);
    node.classList.toggle('warn', mine.length > 0);
    const badges = node.querySelector('.adj-badges');
    badges.replaceChildren(...mine.map((w) => el('span', {
      className: 'badge-warn',
      text: w.type === 'memoMissing' ? '根拠未記載' : '金額未入力',
    })));
  });

  const r = calcNormalizedEbitda(p, settings().adjustmentCategoryNames);
  const table = $('bridgeSingle');
  table.replaceChildren();
  const u = unitName('ebitda');
  const row = (name, value, cls = '') => el('tr', { className: cls }, [el('th', { scope: 'row', text: name }), el('td', { text: value })]);
  table.append(row('報告EBITDA（営業利益＋減価償却費）', isNum(r.reported) ? `${fa(r.reported, 'ebitda')}${u}` : '—'));
  for (const c of r.byCategory.filter((x) => x.count > 0)) {
    table.append(row(`${c.name}（${c.count}件）`, `${formatSigned(c.total, 'ebitda')}${u}`, 'indent'));
  }
  table.append(row('調整額合計', `${formatSigned(r.adjustmentTotal, 'ebitda')}${u}`));
  table.append(row('正常化EBITDA', isNum(r.normalized) ? `${fa(r.normalized, 'ebitda')}${u}` : '—', 'total'));
  table.append(row('正常化EBITDAマージン', fv({ value: r.margin, status: isNum(r.margin) ? 'ok' : 'na' }, '%')));
}

function onAdjustmentChanged() {
  renderAdjustmentSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

function onAddAdjustment() {
  state.data = addAdjustment(state.data, state.selected, createAdjustment('executiveComp'));
  renderAdjustments();
  onAdjustmentChanged();
  const items = $('adjList').querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input[type="text"]')?.focus();
}

function onRemoveAdjustment(a) {
  const label = a.description ? `「${a.description}」` : 'この調整項目';
  if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
  state.data = removeAdjustment(state.data, state.selected, a.id);
  renderAdjustments();
  onAdjustmentChanged();
}

function renderBridgeTable() {
  const b = buildEbitdaBridge(state.data);
  const table = $('bridgeTable');
  table.replaceChildren();
  const head = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '項目' })]);
  b.labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  table.append(el('thead', {}, [head]));
  const tbody = el('tbody');
  for (const r of b.rows) {
    const cls = r.kind === 'adjustment' ? 'indent' : r.kind === 'total' ? 'total' : '';
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: r.name })]);
    for (const v of r.values) {
      let text;
      if (r.unit === '%') text = fv({ value: v, status: isNum(v) ? 'ok' : 'na' }, '%');
      else if (r.kind === 'adjustment' || r.kind === 'subtotal') text = formatSigned(v, 'ebitda');
      else text = isNum(v) ? fa(v, 'ebitda') : '—';
      tr.append(el('td', {}, [el('span', { className: `cell-value${isNum(v) ? (v < 0 ? ' negative' : '') : ' na'}`, text })]));
    }
    tbody.append(tr);
  }
  table.append(tbody);
}

// ---- 運転資本・ネットデット ----

const LINE_LISTS = [
  { key: 'debtLikeItems', container: 'debtLikeList', datalist: 'debtLikeExamples', kind: 'デットライク' },
  { key: 'cashLikeItems', container: 'cashLikeList', datalist: 'cashLikeExamples', kind: 'キャッシュライク' },
];

function pctText(v) {
  return fv({ value: v, status: isNum(v) ? 'ok' : 'na' }, '%');
}

function amountText(v, scope = 'netDebt') {
  return isNum(v) ? `${fa(v, scope)}${unitName(scope)}` : '—';
}

function acc(key) {
  return accountLabel(settings(), key);
}

function renderNetDebtInputs() {
  const p = currentPeriod();
  $('ndPeriodName').textContent = periodName(p, state.selected);
  for (const def of LINE_LISTS) {
    const list = $(def.container);
    list.replaceChildren();
    (p[def.key] ?? []).forEach((it, i) => {
      const idBase = `${def.key}-${i}`;
      const name = el('input', { id: `${idBase}-name`, type: 'text', autocomplete: 'off', list: def.datalist, placeholder: '名称' });
      name.value = it.name;
      name.addEventListener('input', () => { it.name = name.value; onNetDebtChanged(); });

      const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: unitName('netDebt') });
      amount.value = formatInput(it.amount, 'netDebt');
      amount.addEventListener('input', () => {
        const text = amount.value.trim();
        it.amount = parseInput(text, 'netDebt');
        amount.setAttribute('aria-invalid', text !== '' && it.amount === null ? 'true' : 'false');
        onNetDebtChanged();
      });
      amount.addEventListener('blur', () => { if (isNum(it.amount)) amount.value = formatInput(it.amount, 'netDebt'); });
      const sign = el('button', { type: 'button', className: 'sign-btn', 'aria-label': '金額の符号を反転', text: '±' });
      sign.addEventListener('click', () => {
        if (!isNum(it.amount)) {
          amount.value = '-';
          amount.focus();
          return;
        }
        it.amount = -it.amount;
        amount.value = formatInput(it.amount, 'netDebt');
        onNetDebtChanged();
      });

      const memo = el('textarea', { id: `${idBase}-memo`, rows: '2', placeholder: '根拠メモ（例：債務とみなす理由、換金性の根拠）' });
      memo.value = it.memo;
      memo.addEventListener('input', () => { it.memo = memo.value; onNetDebtChanged(); });

      const remove = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
      remove.addEventListener('click', () => {
        const label = it.name ? `「${it.name}」` : 'この項目';
        if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
        state.data = removeLineItem(state.data, state.selected, def.key, it.id);
        renderNetDebtInputs();
        onNetDebtChanged();
      });

      list.append(el('div', { className: 'adj-item', 'data-list': def.key }, [
        el('label', { className: 'field', for: name.id }, [el('span', { className: 'field-label', text: '名称' }), name]),
        el('div', { className: 'field' }, [
          el('label', { className: 'field-label', for: amount.id, text: `金額（${unitName('netDebt')}）` }),
          el('div', { className: 'adj-amount' }, [amount, sign]),
        ]),
        el('label', { className: 'field', for: memo.id }, [el('span', { className: 'field-label', text: '根拠メモ' }), memo]),
        el('div', { className: 'adj-foot' }, [el('span', { className: 'adj-badges' }), remove]),
      ]));
    });
  }
  renderNetDebtSummary();
}

// 入力欄は作り直さず、警告と集計表だけを更新する
function renderNetDebtSummary() {
  const p = currentPeriod();
  const warnings = getNetDebtItemWarnings(p);
  const box = $('ndWarnings');
  box.replaceChildren();
  const memoCount = warnings.filter((w) => w.type === 'memoMissing').length;
  if (memoCount) box.append(el('div', { className: 'warning', text: `根拠未記載のデットライク・キャッシュライク項目が${memoCount}件あります` }));
  for (const def of LINE_LISTS) {
    $(def.container).querySelectorAll('.adj-item').forEach((node, i) => {
      const mine = warnings.filter((w) => w.list === def.key && w.index === i);
      node.classList.toggle('warn', mine.length > 0);
      node.querySelector('.adj-badges').replaceChildren(...mine.map((w) => el('span', {
        className: 'badge-warn',
        text: w.type === 'memoMissing' ? '根拠未記載' : '金額未入力',
      })));
    });
  }

  const row = (name, value, cls = '') => el('tr', { className: cls }, [el('th', { scope: 'row', text: name }), el('td', { text: value })]);
  const wc = calcWorkingCapital(p);
  const bs = p.bs;
  $('wcSingle').replaceChildren(
    row(acc('receivables'), amountText(bs.receivables), 'indent'),
    row(`＋ ${acc('inventory')}`, amountText(bs.inventory), 'indent'),
    row(`− ${acc('payables')}`, amountText(bs.payables), 'indent'),
    row('運転資本', amountText(wc.amount), 'total'),
    row('売上高に対する比率', pctText(wc.ratio)),
  );

  const nd = calcAdjustedNetDebt(p);
  $('ndSingle').replaceChildren(
    row(acc('interestBearingDebt'), amountText(nd.interestBearingDebt)),
    row('＋ デットライク項目', amountText(nd.debtLikeTotal), 'indent'),
    row(`− ${acc('cash')}`, amountText(nd.cash), 'indent'),
    row('− キャッシュライク項目', amountText(nd.cashLikeTotal), 'indent'),
    row('調整後ネットデット', amountText(nd.adjusted), 'total'),
    row('正常化EBITDA', amountText(nd.normalizedEbitda)),
    row('調整後ネットデット ÷ 正常化EBITDA', fv(nd.multiple, '倍')),
  );
}

function onNetDebtChanged() {
  renderNetDebtSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

function onAddLineItem(def) {
  state.data = addLineItem(state.data, state.selected, def.key, createLineItem());
  renderNetDebtInputs();
  onNetDebtChanged();
  const items = $(def.container).querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input')?.focus();
}

function headRowFor(labels, extra = []) {
  const head = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  for (const x of extra) head.append(el('th', { scope: 'col', className: 'avg-col', text: x }));
  return el('thead', {}, [head]);
}

function valueCell(text, v, cls = '') {
  return el('td', { className: cls }, [el('span', { className: `cell-value${isNum(v) ? (v < 0 ? ' negative' : '') : ' na'}`, text })]);
}

function renderWorkingCapitalTable() {
  const s = calcWorkingCapitalSeries(state.data);
  const periods = state.data.periods;
  const table = $('wcTable');
  table.replaceChildren(headRowFor(s.labels, ['参考：平均']));
  const tbody = el('tbody');
  const line = (name, values, avg, fmt, cls = '') => {
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: name })]);
    values.forEach((v) => tr.append(valueCell(fmt(v), v)));
    tr.append(valueCell(avg === undefined ? '' : fmt(avg), avg ?? null, 'avg-col'));
    tbody.append(tr);
  };
  const amt = (v) => (isNum(v) ? fa(v, 'netDebt') : '—');
  line(acc('receivables'), periods.map((p) => p.bs.receivables), undefined, amt, 'indent');
  line(`＋ ${acc('inventory')}`, periods.map((p) => p.bs.inventory), undefined, amt, 'indent');
  line(`− ${acc('payables')}`, periods.map((p) => p.bs.payables), undefined, amt, 'indent');
  line('運転資本', s.items.map((x) => x.amount), s.average, amt, 'total');
  line('売上高に対する比率', s.items.map((x) => x.ratio), s.averageRatio, pctText);
  table.append(tbody);
}

function renderNetDebtTable() {
  const b = buildNetDebtBreakdown(state.data);
  const table = $('ndTable');
  table.replaceChildren(headRowFor(b.labels));
  const tbody = el('tbody');
  for (const r of b.rows) {
    const cls = r.kind === 'total' ? 'total' : r.kind === 'reference' ? 'reference' : r.kind === 'base' ? '' : 'indent';
    const tr = el('tr', { className: cls }, [el('th', { className: 'row-head', scope: 'row', text: r.name })]);
    r.values.forEach((v) => tr.append(valueCell(isNum(v) ? fa(v, 'netDebt') : '—', v)));
    tbody.append(tr);
  }
  const tr = el('tr', {}, [el('th', { className: 'row-head', scope: 'row', text: '調整後ネットデット ÷ 正常化EBITDA' })]);
  b.multiples.forEach((m) => tr.append(valueCell(fv(m, '倍'), m.status === 'ok' ? m.value : null)));
  tbody.append(tr);
  table.append(tbody);
}

// ---- 出力（CSV・印刷用レポート） ----

// iPhone では共有シート（「"ファイル"に保存」など）、それ以外はダウンロード。
// 戻り値：true（保存した）/ false（キャンセル）。失敗時は例外。
async function saveFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  downloadFile(file);
  return true;
}

async function exportCsv(kind, build) {
  saveNow();
  try {
    const csv = build();
    const file = new File([csv], csvFileName(kind), { type: 'text/csv;charset=utf-8' });
    if (await saveFile(file)) showToast(`${CSV_KINDS[kind]}のCSVを出力しました`);
  } catch {
    showToast('CSVを出力できませんでした');
  }
}

// レポートに載せる主要指標（比較表の行 id）
const REPORT_ROWS = [
  'sales', 'operatingIncome', 'ebitda', 'normalizedEbitda',
  'grossMargin', 'operatingMargin', 'normalizedEbitdaMargin', 'roe', 'roa',
  'equityRatio', 'currentRatio', 'deRatio', 'icr', 'ccc',
  'workingCapital', 'workingCapitalRatio', 'adjustedNetDebt', 'adjustedNetDebtToNormalizedEbitda',
];

function reportTable(labels, rows) {
  const head = el('tr', {}, [el('th', { scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { className: r.cls || '' }, [el('th', { scope: 'row', text: r.name })]);
    r.cells.forEach((c) => tr.append(el('td', { className: c.neg ? 'neg' : '' }, [
      c.text, ...(c.badge ? [el('span', { className: `report-badge badge-${c.badge.level}`, text: c.badge.text })] : []),
    ])));
    tbody.append(tr);
  }
  return el('table', {}, [el('thead', {}, [head]), tbody]);
}

function renderReport() {
  const data = state.data;
  const labels = data.periods.map((p, i) => periodName(p, i));
  const box = $('report');
  box.replaceChildren();
  const now = new Date();
  box.append(
    el('h1', { text: '財務分析レポート' }),
    el('p', { className: 'report-app', text: '数字のミカタ' }),
    el('p', { className: 'report-meta', text: `会社名：${data.companyName || '（未入力）'}　対象期：${labels.join('、')}　作成日：${formatDateTime(now).slice(0, 10)}　金額単位：${unitName('report')}` }),
  );

  // 主要指標
  const cmp = buildComparison(data, 'end');
  const rows = REPORT_ROWS.map((id) => cmp.rows.find((r) => r.id === id)).filter(Boolean).map((r) => ({
    name: rowLabel(settings(), r),
    cells: r.cells.map((c, ci) => ({
      badge: badgeFor(r.id, c.result, data.periods[ci], evaluation()),
      text: r.group === 'amounts' || r.unit === '千円'
        ? (isNum(c.result.value) ? fa(c.result.value, 'report') : (c.result.status === 'notApplicable' ? '参考外' : '—'))
        : fv(c.result, r.unit, 'report'),
      neg: c.result.status === 'ok' && c.result.value < 0,
    })),
  }));
  box.append(el('section', {}, [el('h2', { text: '主要指標（期末残高ベース）' }), reportTable(labels, rows)]));

  // EBITDAブリッジ
  const b = buildEbitdaBridge(data);
  box.append(el('section', {}, [
    el('h2', { text: 'EBITDAブリッジ' }),
    reportTable(labels, b.rows.map((r) => ({
      name: r.name,
      cls: r.kind === 'adjustment' ? 'indent' : r.kind === 'total' ? 'total' : '',
      cells: r.values.map((v) => ({
        text: r.unit === '%' ? pctText(v) : r.kind === 'adjustment' || r.kind === 'subtotal' ? formatSigned(v, 'report') : (isNum(v) ? fa(v, 'report') : '—'),
        neg: isNum(v) && v < 0,
      })),
    }))),
  ]));

  // 調整項目の明細
  const adjRows = [];
  data.periods.forEach((p, i) => {
    for (const a of p.adjustments) adjRows.push([labels[i], categoryLabel(settings(), a.category), a.description || '—', a.amount, a.memo || '（根拠未記載）']);
  });
  if (adjRows.length) {
    const tbody = el('tbody');
    for (const [l, cat, desc, amt, memo] of adjRows) {
      tbody.append(el('tr', {}, [
        el('td', { className: 'text', text: l }), el('td', { className: 'text', text: cat }), el('td', { className: 'text', text: desc }),
        el('td', { className: isNum(amt) && amt < 0 ? 'neg' : '', text: formatSigned(amt, 'report') }), el('td', { className: 'text', text: memo }),
      ]));
    }
    box.append(el('section', {}, [
      el('h2', { text: '正常化調整の明細' }),
      el('table', {}, [el('thead', {}, [el('tr', {}, ['期', '区分', '内容', '金額', '根拠'].map((t) => el('th', { scope: 'col', text: t })))]), tbody]),
    ]));
  }

  // ネットデット内訳
  const nd = buildNetDebtBreakdown(data);
  const ndRows = nd.rows.map((r) => ({
    name: r.name,
    cls: r.kind === 'total' ? 'total' : ['debtLike', 'cash', 'cashLike'].includes(r.kind) ? 'indent' : '',
    cells: r.values.map((v) => ({ text: isNum(v) ? fa(v, 'report') : '—', neg: isNum(v) && v < 0 })),
  }));
  ndRows.push({ name: '調整後ネットデット ÷ 正常化EBITDA', cells: nd.multiples.map((m) => ({ text: fv(m, '倍', 'report'), neg: m.status === 'ok' && m.value < 0 })) });
  box.append(el('section', {}, [el('h2', { text: 'ネットデット内訳' }), reportTable(labels, ndRows)]));

  // 運転資本
  const wc = calcWorkingCapitalSeries(data);
  box.append(el('section', {}, [
    el('h2', { text: '運転資本（トレード）' }),
    reportTable([...labels, '参考：平均'], [
      { name: '運転資本', cells: [...wc.items.map((x) => x.amount), wc.average].map((v) => ({ text: isNum(v) ? fa(v, 'report') : '—', neg: isNum(v) && v < 0 })) },
      { name: '売上高に対する比率', cells: [...wc.items.map((x) => x.ratio), wc.averageRatio].map((v) => ({ text: pctText(v) })) },
    ]),
  ]));

  // 警告・注記
  const warnings = [];
  data.periods.forEach((p, i) => {
    for (const w of [...getWarnings(p, fmt('report'), fmt('report')), ...getAdjustmentWarnings(p), ...getNetDebtItemWarnings(p)]) warnings.push(`${labels[i]}：${w.message}`);
  });
  const notes = [
    `金額単位は${unitName('report')}。計算は入力値をそのまま用い、表示時のみ丸めています。`,
    `回転日数は1年を${days()}日として計算しています。`,
    '指標は期末残高ベースです。分母が0または未入力の指標は「—」、債務超過等で意味をなさない指標は「参考外」としています。',
    '正常化EBITDA ＝ 報告EBITDA（営業利益＋減価償却費）＋ 調整額合計。調整の妥当性は各根拠メモをご確認ください。',
    '調整後ネットデット ＝ 有利子負債 ＋ デットライク項目 − 現預金 − キャッシュライク項目。',
    '参考：平均運転資本は、本来は月次残高で算定すべきものであり、本値は期末残高による簡易的な目安です。',
    ...(reportNote(evaluation()) ? [reportNote(evaluation())] : []),
    REPORT_DISCLAIMER,
  ];
  box.append(el('section', { className: 'notes' }, [
    el('h2', { text: '警告・注記' }),
    el('ul', {}, [...warnings.map((w) => el('li', { text: `【警告】${w}` })), ...notes.map((n) => el('li', { text: n }))]),
  ]));
}

function onDeleteAll() {
  if (!window.confirm('この端末に保存されているすべてのデータ（全期の入力・調整項目・最終バックアップ日時）を削除します。元に戻せません。\n\n削除する前にバックアップを保存することをおすすめします。削除してよろしいですか？')) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const { ok, error } = deleteAllData();
  if (!ok) {
    showToast(error);
    return;
  }
  state.data = createEmptyData();
  state.selected = 0;
  renderForm();
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
  renderBackupStatus();
  showToast('すべてのデータを削除しました');
}

// ---- 比較タブ ----

function groupName(group) {
  if (group === 'amounts') return `主要数値（${unitName()}）`;
  return CATEGORIES.find((c) => c.id === group)?.name ?? '';
}

function renderCompare() {
  document.querySelectorAll('.seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.basis === state.basis)));
  $('showChange').checked = state.showChange;
  $('basisNote').textContent = state.basis === 'average'
    ? '平均残高ベース：ROA・ROE・回転日数・CCC の BS 項目を (前期末 + 当期末) ÷ 2 で計算します（★印）。前期がない期は「—」。その他の指標は期末残高です。'
    : '期末残高ベース：BS 項目は各期の期末残高を使います。';

  const cmp = buildComparison(state.data, state.basis);
  const table = $('compareTable');
  table.replaceChildren();
  $('compareCriterion').replaceChildren(criterionBar());

  const headRow = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '指標' })]);
  cmp.labels.forEach((l, i) => headRow.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  table.append(el('thead', {}, [headRow]));

  const tbody = el('tbody');
  let group = null;
  for (const row of arrangeComparisonRows(settings(), cmp.rows)) {
    if (row.group !== group) {
      group = row.group;
      tbody.append(el('tr', { className: 'group-row' }, [
        el('th', { colspan: String(cmp.labels.length + 1), scope: 'colgroup' }, [el('span', { text: groupName(group) })]),
      ]));
    }
    const head = el('th', { className: 'row-head', scope: 'row' }, [el('span', { text: rowLabel(settings(), row) })]);
    if (hasHelp(row.id)) head.append(helpButton(row.id, row.name));
    if (state.basis === 'average' && row.averageable) head.append(el('span', { className: 'avg-mark', text: '★' }));
    const tr = el('tr', {}, [head]);
    row.cells.forEach((cell, ci) => {
      const badge = badgeFor(row.id, cell.result, state.data.periods[ci], evaluation());
      const td = el('td', {}, [
        el('span', {
          className: valueClass('cell-value', cell.result),
          text: row.unit === '千円' && row.group === 'amounts'
            ? (isNum(cell.result.value) ? fa(cell.result.value) : '—')
            : fv(cell.result, row.unit),
        }),
      ]);
      if (badge) td.append(badgeEl(badge, true));
      if (state.showChange && cell.change) {
        td.append(el('span', { className: 'cell-change', text: formatChangeAmount(cell.change, row.unit, fmt()) }));
        td.append(el('span', { className: 'cell-change', text: formatChangeRate(cell.change, fmt()) }));
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);

  renderBridgeTable();
  renderWorkingCapitalTable();
  renderNetDebtTable();
  renderCharts(cmp);
}

// グラフの値は内部値（千円）のまま描き、目盛りの表示だけ表示単位に換算する
function tickFormatFor(unit) {
  if (unit === '%') return (v) => `${Number((v * 100).toPrecision(6))}%`;
  const scale = unit === '千円' ? unitOf(settings()).scale : 1;
  return (v) => Number((v * scale).toPrecision(10)).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

function renderCharts(cmp) {
  const box = $('charts');
  box.replaceChildren();
  const labels = cmp.labels.map((l, i) => l || `第${i + 1}期`);
  for (const id of CHART_ROWS) {
    const row = cmp.rows.find((r) => r.id === id);
    const values = row.cells.map((c) => (c.result.status === 'ok' ? c.result.value : null));
    const svg = buildLineChartSvg({
      labels,
      values,
      title: row.name,
      format: (v) => fv({ value: v, status: 'ok' }, row.unit),
      tickFormat: tickFormatFor(row.unit),
    });
    const card = el('div', { className: 'panel chart-card' }, [el('h3', { text: row.unit === '千円' ? `${rowLabel(settings(), row)}（${unitName()}）` : rowLabel(settings(), row) })]);
    // svg は chart.js で全テキストをエスケープ済み
    const holder = el('div');
    holder.innerHTML = svg;
    card.append(holder);
    box.append(card);
  }
}

// ---- 項目へのジャンプ ----

const SECTION_NAV = {
  input: [
    ['sec-summary', 'サマリー'],
    ['sec-basic', '基本情報'],
    ['sec-pl', 'PL入力'],
    ['sec-bs', 'BS入力'],
    ['results', '分析結果'],
    ['sec-adj', '正常化EBITDA'],
    ['sec-nd', '運転資本・ネットデット'],
    ['sec-backup', 'バックアップ'],
  ],
  diagram: [
    ['sec-dg-period', '期'],
    ['sec-dg-pl', '損益'],
    ['sec-dg-bs', '財産と集め方'],
    ['sec-dg-ccc', 'お金の回収'],
    ['sec-dg-ebitda', '正常化EBITDA'],
    ['sec-dg-nd', '実質的な借入'],
  ],
  compare: [
    ['sec-cmp-setting', '基準'],
    ['sec-cmp-table', '比較表'],
    ['sec-bridge', 'EBITDAブリッジ'],
    ['sec-wc', '運転資本'],
    ['sec-ndb', 'ネットデット'],
    ['sec-charts', 'グラフ'],
    ['sec-export', '出力'],
  ],
};

let sectionObserver = null;

function updateNavHeight() {
  const nav = document.querySelector('.sticky-nav');
  if (nav) document.documentElement.style.setProperty('--nav-height', `${nav.offsetHeight + 8}px`);
}

function setCurrentSection(id) {
  $('sectionNav').querySelectorAll('.section-link').forEach((b) => {
    const on = b.dataset.target === id;
    b.setAttribute('aria-current', String(on));
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function jumpTo(id) {
  const target = $(id);
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  updateNavHeight();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setCurrentSection(id);
}

function renderSectionNav(view) {
  const nav = $('sectionNav');
  const items = SECTION_NAV[view] ?? [];
  nav.hidden = items.length === 0;
  nav.replaceChildren(...items.map(([id, label]) => {
    const b = el('button', { type: 'button', className: 'section-link', 'data-target': id, text: label });
    b.addEventListener('click', () => jumpTo(id));
    return b;
  }));
  // 画面に見えている項目をメニュー上で強調する
  if (sectionObserver) sectionObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setCurrentSection(visible[0].target.id);
  }, { rootMargin: '-120px 0px -60% 0px' });
  for (const [id] of items) if ($(id)) sectionObserver.observe($(id));
  updateNavHeight();
}

// ---- 図解タブ ----

function pctOf(part, whole) {
  return isNum(part) && isNum(whole) && whole !== 0 ? fv({ value: part / whole, status: 'ok' }, '%') : '—';
}

function setSvg(id, svg) {
  // svg は diagrams.js で全テキストをエスケープ済み
  $(id).innerHTML = svg;
}

function renderDiagramPeriods() {
  const box = $('dgPeriodChips');
  box.replaceChildren(...state.data.periods.map((p, i) => {
    const chip = el('button', { type: 'button', className: 'chip', role: 'tab', 'aria-selected': String(i === state.selected), text: periodName(p, i) });
    chip.addEventListener('click', () => {
      selectPeriod(i);
      renderDiagrams();
    });
    return chip;
  }));
}

function renderDiagrams() {
  renderDiagramPeriods();
  renderUnitLabels();
  const p = currentPeriod();
  const amt = (v) => (isNum(v) ? `${fa(v)}` : '—');
  const signedAmt = (v, b) => (b.kind === 'delta' ? formatSigned(v) : amt(v));
  // 名称を変更した科目はその名称、変更していなければ図に合う短い名称（例：「流動資産合計」→「流動資産」）
  const label = (k, d) => {
    const a = [...settings().accounts.pl, ...settings().accounts.bs].find((x) => x.key === k);
    return (a?.label ?? '').trim() || d;
  };
  const u = unitName();

  // 損益の滝グラフ
  const pl = p.pl;
  setSvg('dgPl', buildWaterfallSvg({ steps: plSteps(pl, label), format: signedAmt, title: '損益の滝グラフ' }));
  $('dgPlInsight').textContent = isNum(pl.sales) && pl.sales > 0
    ? `売上高 ${amt(pl.sales)}${u} のうち、売上総利益は ${pctOf(diffOrNull(pl.sales, pl.costOfSales), pl.sales)}、営業利益は ${pctOf(pl.operatingIncome, pl.sales)}${isNum(pl.netIncome) ? `、当期純利益は ${pctOf(pl.netIncome, pl.sales)}` : ''} が残っています。`
    : '売上高・売上原価・販管費・営業利益を入力すると表示します。';

  // BS の面積図
  const bs = p.bs;
  const boxes = bsBoxes(bs);
  setSvg('dgBs', buildBsBoxSvg({ boxes, format: amt, label }));
  if (!boxes) $('dgBsInsight').textContent = '流動資産・固定資産・流動負債・固定負債・純資産を入力すると表示します。';
  else if (boxes.insolvent) $('dgBsInsight').textContent = `負債が資産を ${amt(-bs.netAssets)}${u} 上回っています（債務超過）。返済不要の純資産がマイナスの状態です。`;
  else {
    const r = calcIndicators(p, { days: days() });
    $('dgBsInsight').textContent = `資産の ${fv(r.equityRatio, '%')} を返済不要の純資産でまかなっています（自己資本比率）。1年以内に払う流動負債に対し、流動資産は ${fv(r.currentRatio, '%')} あります（流動比率）。${boxes.balanced ? '' : '※資産合計と負債・純資産合計が一致していないため、左右の高さがずれています。'}`;
  }

  // CCC
  const parts = cccParts(calcIndicators(p, { days: days() }));
  const dayFmt = (v) => fv({ value: v, status: 'ok' }, '日');
  setSvg('dgCcc', buildCccSvg({ parts, format: dayFmt }));
  if (!parts) $('dgCccInsight').textContent = '売上高・売上原価・売上債権・棚卸資産・仕入債務を入力すると表示します。';
  else if (parts.ccc > 0) $('dgCccInsight').textContent = `仕入代金を支払ってから売上代金を回収するまで、約 ${dayFmt(parts.ccc)} 分のお金を会社が立て替えています。`;
  else $('dgCccInsight').textContent = `仕入代金を支払う前に売上代金を回収できています（CCC ${dayFmt(parts.ccc)}）。運転資金の負担が小さい状態です。`;

  // EBITDA の正常化
  const n = calcNormalizedEbitda(p, settings().adjustmentCategoryNames);
  setSvg('dgEbitda', buildWaterfallSvg({ steps: ebitdaSteps(n), format: signedAmt, title: 'EBITDAの正常化' }));
  if (!isNum(n.reported)) $('dgEbitdaInsight').textContent = '営業利益・減価償却費を入力すると表示します。';
  else if (!(p.adjustments ?? []).length) $('dgEbitdaInsight').textContent = `報告EBITDAは ${amt(n.reported)}${u} です。調整項目を登録すると、正常化EBITDAまでの流れを表示します。`;
  else $('dgEbitdaInsight').textContent = `調整により、EBITDAは ${formatSigned(n.adjustmentTotal)}${u}（${pctOf(n.adjustmentTotal, n.reported)}）変わり、正常化EBITDAは ${amt(n.normalized)}${u} です。`;

  // 調整後ネットデット
  const nd = calcAdjustedNetDebt(p, settings().adjustmentCategoryNames);
  setSvg('dgNd', buildWaterfallSvg({ steps: netDebtSteps(nd, label), format: signedAmt, title: '調整後ネットデット' }));
  if (!isNum(nd.adjusted)) $('dgNdInsight').textContent = '有利子負債・現預金を入力すると表示します。';
  else if (nd.adjusted < 0) $('dgNdInsight').textContent = `手元資金が実質的な借入を ${amt(-nd.adjusted)}${u} 上回っています（ネットキャッシュ）。`;
  else $('dgNdInsight').textContent = `実質的な借入は ${amt(nd.adjusted)}${u} です。${nd.multiple.status === 'ok' ? `正常化EBITDAの ${fv(nd.multiple, '倍')} 分にあたり、何年分の稼ぎで返せるかの目安になります。` : ''}`;
}

function diffOrNull(a, b) {
  return isNum(a) && isNum(b) ? a - b : null;
}

// ---- 設定タブ ----

const SETTINGS_PAGES = [
  { id: 'unit', title: '金額の単位', summary: () => (commonUnit(settings()) ? `すべて${commonUnit(settings()).name}` : '区分ごとに設定') },
  { id: 'pl', title: 'PL科目', summary: () => accountSummary('pl') },
  { id: 'bs', title: 'BS科目', summary: () => accountSummary('bs') },
  { id: 'indicators', title: '指標の表示・並び順', summary: () => `${INDICATORS.length}件中${indicatorList(settings()).length}件を表示` },
  { id: 'evaluation', title: '評価基準（バッジ）', summary: () => (evaluation().enabled ? criterionLabel(evaluation()) : 'バッジを表示しない') },
  { id: 'glossary', title: '指標の解説（計算式一覧）', summary: () => '計算式・意味・評価の目安' },
  { id: 'analysis', title: '分析の基本設定', summary: () => `1年＝${days()}日・比較の初期値：${settings().analysis.defaultBasis === 'average' ? '平均残高' : '期末残高'}` },
  { id: 'display', title: '画面の表示', summary: () => `テーマ：${THEMES.find((t) => t.id === settings().theme).name}・マイナス：${settings().negativeStyle === 'triangle' ? '△' : '−'}` },
  { id: 'digits', title: '表示桁数', summary: () => `%：${settings().digits.pct}桁・日：${settings().digits.days}桁・倍/回：${settings().digits.times}桁` },
  { id: 'categories', title: '正常化EBITDAの調整区分', summary: () => `${Object.keys(settings().adjustmentCategoryNames).length}件を名称変更` },
  { id: 'data', title: 'バックアップ・データ管理', summary: () => (settings().backupReminderDays ? `${settings().backupReminderDays}日ごとに案内` : 'バックアップの案内なし') },
  { id: 'about', title: 'このアプリについて', summary: () => `バージョン ${APP_VERSION}` },
];

function accountSummary(section) {
  const tree = accountTree(settings(), section);
  const hidden = tree.filter((a) => a.hidden).length;
  const kids = tree.reduce((n, a) => n + a.children.length, 0);
  const parts = [`${tree.length}科目`];
  if (hidden) parts.push(`非表示${hidden}`);
  if (kids) parts.push(`内訳${kids}`);
  return parts.join('・');
}

// 設定を変更して保存し、関係する画面を描き直す
function changeSettings(next, { rerenderPage = true } = {}) {
  state.data = next;
  renderForm();
  update();
  if (rerenderPage) renderSettings();
}

function openSettingsPage(id) {
  state.settingsPage = id;
  renderSettings();
  window.scrollTo(0, 0);
}

function renderSettings() {
  const box = $('settingsBody');
  box.replaceChildren();
  const page = SETTINGS_PAGES.find((p) => p.id === state.settingsPage);
  if (!page) {
    const list = el('ul', { className: 'settings-list' });
    for (const p of SETTINGS_PAGES) {
      const b = el('button', { type: 'button', className: 'settings-item' }, [
        el('span', { className: 'settings-item-title', text: p.title }),
        el('span', { className: 'settings-item-summary', text: p.summary() }),
        el('span', { className: 'settings-item-arrow', 'aria-hidden': 'true', text: '›' }),
      ]);
      b.addEventListener('click', () => openSettingsPage(p.id));
      list.append(el('li', {}, [b]));
    }
    box.append(el('section', { className: 'panel' }, [el('h2', { className: 'panel-title', text: '設定' }), list]));
    box.append(el('p', { className: 'note', text: '設定はこの端末のデータと一緒に保存され、JSONバックアップにも含まれます。' }));
    return;
  }
  const back = el('button', { type: 'button', className: 'btn settings-back', text: '← 設定に戻る' });
  back.addEventListener('click', () => openSettingsPage(null));
  const panel = el('section', { className: 'panel settings-page' }, [el('h2', { className: 'panel-title', text: page.title })]);
  box.append(back, panel);
  SETTINGS_RENDERERS[page.id](panel);
}

function radioGroup(name, options, current, onChange) {
  const group = el('div', { className: 'choice-list', role: 'radiogroup' });
  for (const o of options) {
    const input = el('input', { type: 'radio', name, value: String(o.value) });
    input.checked = o.value === current;
    input.addEventListener('change', () => onChange(o.value));
    group.append(el('label', { className: 'choice' }, [input, el('span', {}, [
      el('span', { className: 'choice-title', text: o.label }),
      ...(o.note ? [el('span', { className: 'choice-note', text: o.note })] : []),
    ])]));
  }
  return group;
}

function smallBtn(text, label, onClick, disabled = false) {
  const b = el('button', { type: 'button', className: 'btn btn-icon btn-small', 'aria-label': label, text });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function toggle(label, checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'check toggle' }, [input, el('span', { text: label })]);
}

function unitSelect(scope, label) {
  const select = el('select', { id: `unit-${scope}`, 'aria-label': `${label}の単位` });
  for (const u of AMOUNT_UNITS) {
    const o = el('option', { value: u.id, text: u.name });
    if (u.id === unitOf(settings(), scope).id) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { units: setUnit(settings(), scope, select.value).units })));
  return select;
}

function renderUnitPage(panel) {
  panel.append(el('p', { className: 'note', text: '区分ごとに、入力と表示に使う金額の単位を選べます。保存されている金額（内部は千円）は変わらず、入力・表示のときだけ換算します（例：1,000千円 → 1,000,000円）。百万円は小数第1位まで表示します。' }));
  for (const x of UNIT_SCOPES) {
    panel.append(el('label', { className: 'field unit-field', for: `unit-${x.id}` }, [
      el('span', { className: 'unit-field-name', text: x.name }),
      unitSelect(x.id, x.name),
      el('span', { className: 'note unit-field-note', text: x.note }),
    ]));
  }
  const all = el('div', { className: 'actions' }, AMOUNT_UNITS.map((u) => {
    const b = el('button', { type: 'button', className: 'btn', text: `すべて${u.name}` });
    b.addEventListener('click', () => changeSettings(updateSettings(state.data, { units: setUnit(settings(), 'all', u.id).units })));
    return b;
  }));
  panel.append(el('h3', { className: 'sub-title', text: 'まとめて変更' }), all);
}

function renderAccountsPage(section, panel) {
  panel.append(el('p', { className: 'note', text: '↑↓で並び替え、名称を書き換えると入力画面の表示名が変わります（空欄にすると標準名に戻ります）。計算に使う標準科目は削除できないため、使わない科目は「表示」を外してください（入力済みの値は計算に使われます）。' }));
  panel.append(el('p', { className: 'note', text: `「＋内訳」で科目の内訳を追加できます。内訳に金額を入れた期は、親科目が内訳の合計で自動計算されます。親科目に入力済みの金額は「${OTHER_DETAIL_LABEL}」の内訳に移すため、合計は変わりません。` }));
  const tree = accountTree(settings(), section);
  const list = el('div', { className: 'acc-list' });
  const full = settings().accounts.custom.length >= MAX_CUSTOM_ACCOUNTS;
  tree.forEach((a, i) => {
    const name = el('input', { type: 'text', autocomplete: 'off', placeholder: a.standardLabel, 'aria-label': `${a.standardLabel}の表示名` });
    name.value = a.renamed ? a.label : '';
    name.addEventListener('change', () => changeSettings(updateSettings(state.data, { accounts: renameAccount(settings(), a.key, name.value.trim()).accounts })));
    const card = el('div', { className: `acc-item${a.hidden ? ' is-hidden' : ''}`, 'data-key': a.key }, [
      el('div', { className: 'acc-row' }, [
        name,
        smallBtn('↑', `${a.label}を上へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), a.key, -1).accounts })), i === 0),
        smallBtn('↓', `${a.label}を下へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), a.key, 1).accounts })), i === tree.length - 1),
      ]),
      el('div', { className: 'acc-meta' }, [
        el('span', { className: 'acc-std', text: a.renamed ? `標準名：${a.standardLabel}` : '標準科目' }),
        toggle('表示', !a.hidden, (on) => changeSettings(updateSettings(state.data, { accounts: setAccountHidden(settings(), a.key, !on).accounts }))),
      ]),
    ]);
    a.children.forEach((c, j) => {
      const cn = el('input', { type: 'text', autocomplete: 'off', placeholder: '内訳の名称', 'aria-label': `${a.label}の内訳の名称`, 'data-child': c.key });
      cn.value = settings().accounts.custom.find((x) => x.key === c.key)?.label ?? '';
      cn.addEventListener('change', () => changeSettings(updateSettings(state.data, { accounts: renameAccount(settings(), c.key, cn.value.trim()).accounts })));
      const del = el('button', { type: 'button', className: 'btn btn-danger btn-small', text: '削除' });
      del.addEventListener('click', () => {
        if (!window.confirm(`内訳「${c.label}」を削除します。全期の入力値も削除され、${a.label}は残りの内訳の合計で再計算されます。よろしいですか？`)) return;
        changeSettings(removeCustomAccount(state.data, c.key));
        showToast('内訳を削除しました');
      });
      card.append(el('div', { className: 'acc-row acc-child' }, [
        cn,
        smallBtn('↑', `${c.label}を上へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), c.key, -1).accounts })), j === 0),
        smallBtn('↓', `${c.label}を下へ`, () => changeSettings(updateSettings(state.data, { accounts: moveAccount(settings(), c.key, 1).accounts })), j === a.children.length - 1),
        del,
      ]));
    });
    const add = el('button', { type: 'button', className: 'btn btn-small acc-add', text: `＋ ${a.label}の内訳` });
    add.disabled = full;
    add.addEventListener('click', () => {
      const moved = !a.children.length && state.data.periods.some((p) => isNum(p[section][a.key]));
      const { data, key } = addCustomAccount(state.data, a.key, '');
      if (!key) return;
      changeSettings(data);
      if (moved) showToast(`入力済みの金額は内訳「${OTHER_DETAIL_LABEL}」に移しました`);
      $('settingsBody').querySelector(`[data-child="${key}"]`)?.focus();
    });
    card.append(add);
    list.append(card);
  });
  panel.append(list);
  if (full) panel.append(el('p', { className: 'note', text: `内訳は全体で${MAX_CUSTOM_ACCOUNTS}件までです。` }));
  const reset = el('button', { type: 'button', className: 'btn', text: '名称・並び・表示を初期状態に戻す' });
  reset.addEventListener('click', () => {
    if (!window.confirm('この表の科目の名称・並び順・表示を初期状態に戻します（内訳と入力値はそのまま）。よろしいですか？')) return;
    changeSettings(updateSettings(state.data, { accounts: { ...settings().accounts, [section]: createDefaultSettings().accounts[section] } }));
  });
  panel.append(el('div', { className: 'actions' }, [reset]));
}

function renderIndicatorsPage(panel) {
  panel.append(el('p', { className: 'note', text: '「表示」を外した指標は、入力タブの分析結果・比較表・比較表CSV・結果テキストに表示しません（計算はされています）。↑↓で区分内の並び順を変えられます。印刷用レポートは常に主要指標を載せます。' }));
  const all = indicatorList(settings(), true);
  for (const cat of CATEGORIES) {
    const inds = all.filter((i) => i.category === cat.id);
    const list = el('div', { className: 'acc-list' });
    inds.forEach((ind, i) => {
      list.append(el('div', { className: `acc-item${ind.hidden ? ' is-hidden' : ''}` }, [
        el('div', { className: 'acc-row' }, [
          el('span', { className: 'ind-name', text: ind.name }),
          smallBtn('↑', `${ind.name}を上へ`, () => changeSettings(updateSettings(state.data, { indicators: moveIndicator(settings(), ind.id, -1).indicators })), i === 0),
          smallBtn('↓', `${ind.name}を下へ`, () => changeSettings(updateSettings(state.data, { indicators: moveIndicator(settings(), ind.id, 1).indicators })), i === inds.length - 1),
        ]),
        el('div', { className: 'acc-meta' }, [
          el('span', { className: 'acc-std', text: formulaText(ind, days()) }),
          toggle('表示', !ind.hidden, (on) => changeSettings(updateSettings(state.data, { indicators: setIndicatorHidden(settings(), ind.id, !on).indicators }))),
        ]),
      ]));
    });
    panel.append(el('h3', { className: 'sub-title', text: cat.name }), list);
  }
}

function renderAnalysisPage(panel) {
  const an = settings().analysis;
  panel.append(
    el('h3', { className: 'sub-title', text: '回転日数の1年の日数' }),
    el('p', { className: 'note', text: '売上債権・棚卸資産・仕入債務の回転日数とCCCの計算に使います。' }),
    radioGroup('days', [
      { value: 365, label: '365日', note: '一般的な計算' },
      { value: 360, label: '360日', note: '金融機関などで使われる簡便法' },
    ], an.daysInYear, (v) => changeSettings(updateSettings(state.data, { analysis: { ...settings().analysis, daysInYear: v } }))),
    el('h3', { className: 'sub-title', text: '比較タブの計算基準（初期値）' }),
    el('p', { className: 'note', text: 'アプリを開いたときの比較タブの基準です。比較タブで一時的に切り替えることもできます。' }),
    radioGroup('basis', [
      { value: 'end', label: '期末残高' },
      { value: 'average', label: '平均残高', note: 'ROA・ROE・回転日数・CCC を (前期末＋当期末)÷2 で計算' },
    ], an.defaultBasis, (v) => {
      state.basis = v;
      changeSettings(updateSettings(state.data, { analysis: { ...settings().analysis, defaultBasis: v } }));
    }),
  );
}

function digitSelect(label, key, unitLabel) {
  const [min, max] = DIGIT_LIMITS[key];
  const select = el('select', { 'aria-label': label });
  for (let d = min; d <= max; d += 1) {
    const o = el('option', { value: String(d), text: `${d}桁` });
    if (d === settings().digits[key]) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { digits: { ...settings().digits, [key]: Number(select.value) } })));
  const sample = { pct: 0.123456, days: 45.6789, times: 1.23456 }[key];
  const unit = { pct: '%', days: '日', times: '倍' }[key];
  return el('label', { className: 'field digit-field' }, [
    el('span', { className: 'field-label', text: `${label}（例：${fv({ value: sample, status: 'ok' }, unit)}）` }),
    select,
    el('span', { className: 'note', text: unitLabel }),
  ]);
}

function renderDigitsPage(panel) {
  panel.append(
    el('p', { className: 'note', text: '小数点以下の表示桁数です。計算は丸めずに行い、表示のときだけ四捨五入します。' }),
    digitSelect('%の指標', 'pct', '利益率・ROE・自己資本比率など（前期比のpt・増減率も同じ桁数）'),
    digitSelect('日数の指標', 'days', '回転日数・CCC'),
    digitSelect('倍・回の指標', 'times', 'D/Eレシオ・ICR・総資産回転率など'),
  );
}

function renderCategoriesPage(panel) {
  panel.append(el('p', { className: 'note', text: '正常化EBITDAの調整区分の表示名を変更できます（空欄にすると元の名称に戻ります）。区分の追加・削除はできません。該当しない調整は「その他」を使ってください。' }));
  for (const c of ADJUSTMENT_CATEGORIES) {
    const input = el('input', { type: 'text', autocomplete: 'off', placeholder: c.name, 'aria-label': `${c.name}の表示名` });
    input.value = settings().adjustmentCategoryNames[c.id] ?? '';
    input.addEventListener('change', () => changeSettings(updateSettings(state.data, { adjustmentCategoryNames: renameCategory(settings(), c.id, input.value.trim()).adjustmentCategoryNames })));
    panel.append(el('label', { className: 'field' }, [el('span', { className: 'field-label', text: `標準名：${c.name}` }), input]));
  }
}

function renderDataPage(panel) {
  const select = el('select', { 'aria-label': 'バックアップの案内' });
  for (const d of BACKUP_REMINDER_CHOICES) {
    const o = el('option', { value: String(d), text: d ? `${d}日ごと` : '案内しない' });
    if (d === settings().backupReminderDays) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => changeSettings(updateSettings(state.data, { backupReminderDays: Number(select.value) })));
  const last = getLastBackupAt();
  const btn = (text, cls, fn) => {
    const b = el('button', { type: 'button', className: `btn ${cls}`, text });
    b.addEventListener('click', fn);
    return b;
  };
  panel.append(
    el('label', { className: 'field' }, [el('span', { className: 'field-label', text: 'バックアップの案内' }), select]),
    el('p', { className: 'note', text: `最終バックアップ：${last ? formatDateTime(last) : '未実施'}。前回のバックアップから設定した日数がたつと、入力タブに案内を表示します。` }),
    el('div', { className: 'actions' }, [
      btn('バックアップを保存', '', async () => { await onExport(); renderSettings(); }),
      btn('バックアップから復元', '', onImportClick),
    ]),
    ...undoSection(),
    el('h3', { className: 'sub-title', text: '初期化' }),
    el('div', { className: 'actions' }, [
      btn('設定を初期値に戻す', '', onResetSettings),
      btn('すべてのデータを削除', 'btn-danger', () => { onDeleteAll(); renderSettings(); }),
    ]),
    el('p', { className: 'note', text: '「設定を初期値に戻す」は入力した金額を残します（内訳科目は削除し、親科目は内訳の合計のまま入力欄に戻ります）。' }),
  );
}

function undoSection() {
  const u = loadUndo();
  if (!u) return [];
  const b = el('button', { type: 'button', className: 'btn', text: `「${u.label}」の前の状態に戻す` });
  b.addEventListener('click', () => {
    if (!window.confirm(`「${u.label}」の前の状態${u.at ? `（${formatDateTime(u.at)}）` : ''}に戻します。いまの入力内容は置き換わります。よろしいですか？`)) return;
    onUndo();
    renderSettings();
  });
  return [
    el('h3', { className: 'sub-title', text: '元に戻す' }),
    el('p', { className: 'note', text: '直前の「クリア」「期の削除」「バックアップからの復元」「サンプルデータの読込」の前の状態を1つだけ、この端末内に退避しています。' }),
    el('div', { className: 'actions' }, [b]),
  ];
}

function onResetSettings() {
  if (!window.confirm('すべての設定（表示単位・科目・指標・桁数など）を初期値に戻します。内訳科目は削除されます（親科目の金額は残ります）。よろしいですか？')) return;
  // 内訳の値だけを消し、親科目は現在の金額（内訳の合計）のまま残す
  const periods = state.data.periods.map((p) => ({ ...p, details: {} }));
  state.basis = 'end';
  changeSettings({ ...state.data, periods, settings: createDefaultSettings() });
  showToast('設定を初期値に戻しました');
}

function renderAboutPage(panel) {
  const persisted = el('dd', { text: '確認中…' });
  isStoragePersisted().then((v) => { persisted.textContent = v === true ? '保護あり（自動削除されにくい）' : v === false ? '保護なし（空き容量不足などで消えることがあります）' : '確認できません'; });
  const check = el('button', { type: 'button', className: 'btn', text: '更新を確認' });
  const guide = el('button', { type: 'button', className: 'btn', text: '使い方ガイドを見る' });
  guide.addEventListener('click', () => openOnboarding(0));
  check.addEventListener('click', async () => {
    check.disabled = true;
    const r = await checkForUpdate();
    check.disabled = false;
    if (r === 'checked') showToast($('updateBar').hidden ? '確認しました（新しいバージョンがあれば画面下に表示されます）' : '新しいバージョンがあります。画面下の［更新］を押してください');
    else showToast('この環境では更新を確認できません');
  });
  panel.append(
    el('dl', { className: 'about-list' }, [
      el('dt', { text: 'アプリのバージョン' }), el('dd', { text: APP_VERSION }),
      el('dt', { text: 'データ形式' }), el('dd', { text: `version ${state.data.version}` }),
      el('dt', { text: '保存先' }), el('dd', { text: 'この端末のブラウザ内（外部には送信しません）' }),
      el('dt', { text: '保存データの保護' }), persisted,
    ]),
    el('div', { className: 'actions' }, [check, guide]),
    el('h3', { className: 'sub-title', text: '更新履歴' }),
    changelogList(CHANGELOG),
    el('h3', { className: 'sub-title', text: 'ご利用にあたって（免責事項）' }),
    el('ul', { className: 'legal-list' }, DISCLAIMER.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: 'プライバシー' }),
    el('ul', { className: 'legal-list' }, PRIVACY.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: '著作権・ライセンス' }),
    el('p', { className: 'note', text: COPYRIGHT }),
    el('ul', { className: 'legal-list' }, LICENSE_TEXT.map((t) => el('li', { text: t }))),
    el('h3', { className: 'sub-title', text: 'お問い合わせ' }),
    el('p', { className: 'note', text: CONTACT ?? '準備中です。' }),
  );
}

function renderDisplayPage(panel) {
  panel.append(
    el('h3', { className: 'sub-title', text: '表示テーマ' }),
    radioGroup('theme', THEMES.map((t) => ({
      value: t.id, label: t.name,
      note: t.id === 'auto' ? 'iPhone の「ライト／ダーク」の設定に合わせて自動で切り替えます' : '',
    })), settings().theme, (v) => changeSettings(updateSettings(state.data, { theme: v }))),
    el('h3', { className: 'sub-title', text: 'マイナスの表示' }),
    el('p', { className: 'note', text: '画面・レポートの表示に使います。入力欄でも△で表示し、△・▲・− のどれで入力しても負の数として扱います。CSV は数値（-1000）のまま出力します。' }),
    radioGroup('negative', NEGATIVE_STYLES.map((t) => ({ value: t.id, label: t.name })), settings().negativeStyle,
      (v) => changeSettings(updateSettings(state.data, { negativeStyle: v }))),
  );
}

// ---- 評価基準 ----

function saveEvaluation(next) {
  changeSettings(updateSettings(state.data, { evaluation: next }));
}

function criterionDetails(c) {
  const lines = [el('p', { text: c.summary }), el('p', { className: 'note', text: `出典：${c.source}` })];
  if (c.id === 'standard') {
    lines.push(el('p', { className: 'note', text: '業種による差は考慮しません。回転日数・CCC・金額の指標は評価しません。' }));
  }
  if (c.id === 'furutado') {
    lines.push(el('p', { className: 'note', text: '自己資本比率・ROA・流動比率・当座比率・総資産回転率を古田土会計の目安に置き換え、それ以外の指標と、示されていない側の境界は標準の値を使います。指標ごとの目安で、どれが標準から引き継いだ値か確認できます。' }));
  }
  if (c.id === 'jfc') {
    lines.push(el('p', { className: 'note', text: '小企業（原則従業者20人未満）を対象とした調査の「業種全体」の表を使います。建設業・製造業は2024年度調査（2025年8月公表）、ほかの業種は2025年度調査（2026年8月公表）です。調査の対象は9指標（売上総利益率・営業利益率・経常利益率・ROA・総資産回転率・流動比率・当座比率・固定長期適合率・自己資本比率）で、それ以外の指標は標準で評価します。規模の大きい会社では参考程度にしてください。' }));
    const ul = el('ul', { className: 'note source-list' });
    for (const x of JFC_INDUSTRIES) ul.append(el('li', { text: `${x.name}：${x.year}調査・${x.count.toLocaleString('ja-JP')}社（うち黒字かつ自己資本プラス${x.goodCount.toLocaleString('ja-JP')}社）・公庫ウェブサイト ${x.file}` }));
    lines.push(ul);
  }
  if (c.id === 'tkc') {
    lines.push(el('p', { className: 'note', text: c.notice }));
    lines.push(el('p', { className: 'note', text: '入力した値はこの端末にだけ保存され、JSONバックアップに含まれます。未入力の指標は標準の基準で評価し、指標の詳しい説明にその旨を表示します。' }));
  }
  return el('details', { className: 'criterion-detail' }, [el('summary', { text: `${c.name}について詳しく` }), ...lines]);
}

function boundInput(label, value, unit, onSave) {
  const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': label, value: isNum(value) ? String(value) : '' });
  input.addEventListener('change', () => onSave(parseAmount(input.value)));
  return el('label', { className: 'bound-field' }, [el('span', { className: 'bound-label', text: label }), input, el('span', { className: 'bound-unit', text: unit })]);
}

function renderEvaluationPage(panel) {
  const ev = evaluation();
  panel.append(
    el('p', { className: 'note', text: '分析結果・比較表・レポートの指標に「良好」「注意」のバッジを付けます。どちらでもない場合はバッジを付けません。判定は丸める前の値で行い、境界の値は良好側に含めます。バッジは目安との比較で、業種・規模・事業モデルによって適切な水準は異なります。' }),
    toggle('評価バッジを表示する', ev.enabled, (v) => saveEvaluation({ ...ev, enabled: v })),
    el('h3', { className: 'sub-title', text: '評価基準' }),
    radioGroup('criterion', CRITERIA.map((c) => ({ value: c.id, label: c.name, note: c.summary })), ev.criterion, (v) => saveEvaluation(setCriterion(ev, v))),
  );
  if (ev.criterion === 'jfc') {
    const select = el('select', { id: 'jfcIndustry', 'aria-label': '業種' });
    for (const x of JFC_INDUSTRIES) {
      const o = el('option', { value: x.id, text: `${x.name}（${x.year}）` });
      if (x.id === ev.jfcIndustry) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => saveEvaluation({ ...ev, jfcIndustry: select.value }));
    panel.append(el('label', { className: 'field', for: 'jfcIndustry' }, [el('span', { className: 'field-label', text: '業種（公庫）' }), select]));
  }
  if (ev.criterion === 'tkc') {
    const input = el('input', { type: 'text', id: 'tkcIndustry', maxlength: '40', autocomplete: 'off', placeholder: '例：金属製品製造業', value: ev.tkc.industry });
    input.addEventListener('change', () => saveEvaluation({ ...ev, tkc: { ...ev.tkc, industry: input.value.trim() } }));
    panel.append(
      el('label', { className: 'field', for: 'tkcIndustry' }, [el('span', { className: 'field-label', text: '業種名（TKC）' }), input]),
      el('p', { className: 'note notice', text: CRITERIA.find((c) => c.id === 'tkc').notice }),
    );
  }
  panel.append(el('h3', { className: 'sub-title', text: '基準の説明' }), ...CRITERIA.map(criterionDetails));

  // 指標ごとの目安・変更・オン/オフ
  const tkc = ev.criterion === 'tkc';
  panel.append(
    el('h3', { className: 'sub-title', text: `指標ごとの目安（${criterionLabel(ev)}）` }),
    el('p', { className: 'note', text: tkc
      ? '「優良企業平均」以上で良好、「黒字企業平均」未満で注意とします（低いほど良い指標は逆）。空欄の指標は標準の基準で評価します。'
      : '境界の値を書き換えると、この基準の値として保存されます（空欄にするとその側は判定しません）。変更は基準ごとに保存され、「元に戻す」で基準の値に戻ります。' }),
  );
  const list = el('div', { className: 'eval-list' });
  for (const t of BADGE_TARGETS) {
    const g = guideFor(t.id, ev);
    const rule = ruleFor(t.id, ev);
    const hi = t.dir === 'high';
    const row = el('div', { className: 'eval-row' }, [
      el('div', { className: 'eval-head' }, [
        el('span', { className: 'eval-name', text: t.name }),
        toggle('表示', !ev.disabled.includes(t.id), (v) => saveEvaluation(setBadgeDisabled(ev, t.id, !v))),
      ]),
      el('p', { className: 'eval-bounds', text: `${g.text}（${g.source}）` }),
      ...g.notes.filter((n) => !n.startsWith('この指標のバッジは')).map((n) => el('p', { className: 'note eval-note', text: n })),
    ]);
    if (tkc && TKC_TARGETS.includes(t.id)) {
      const v = ev.tkc.values[t.id] ?? {};
      row.append(el('div', { className: 'bound-fields' }, [
        boundInput('優良企業平均', v.good, t.unit, (x) => saveEvaluation(setTkcValue(ev, t.id, { ...v, good: x }))),
        boundInput('黒字企業平均', v.caution, t.unit, (x) => saveEvaluation(setTkcValue(ev, t.id, { ...v, caution: x }))),
      ]));
    } else if (!tkc) {
      const bounds = { good: rule.good, caution: rule.caution };
      const fields = el('div', { className: 'bound-fields' }, [
        boundInput(`良好（${hi ? '以上' : '以下'}）`, rule.good, t.unit, (x) => saveEvaluation(setOverride(ev, t.id, { ...bounds, good: x }))),
        boundInput(`注意（${hi ? '未満' : '超'}）`, rule.caution, t.unit, (x) => saveEvaluation(setOverride(ev, t.id, { ...bounds, caution: x }))),
      ]);
      if (rule.modified) fields.append(smallBtn('元に戻す', `${t.name}の目安を元に戻す`, () => saveEvaluation(setOverride(ev, t.id, null))));
      const edit = el('details', { className: 'bound-edit' }, [el('summary', { text: rule.modified ? '目安を変更（変更あり）' : '目安を変更' }), fields]);
      edit.open = rule.modified;
      row.append(edit);
    }
    list.append(row);
  }
  panel.append(list);
  if (isModified(ev)) {
    const reset = el('button', { type: 'button', className: 'btn', text: `${CRITERIA.find((c) => c.id === ev.criterion).name}の変更をすべて元に戻す` });
    reset.addEventListener('click', () => {
      if (window.confirm('この基準で変更した目安をすべて元の値に戻します。よろしいですか？')) saveEvaluation(resetOverrides(ev));
    });
    panel.append(el('div', { className: 'actions' }, [reset]));
  }
}

function renderGlossaryPage(panel) {
  panel.append(el('p', { className: 'note', text: `計算式は期末残高ベースです（比較タブの「平均残高」では★の指標のBS項目を前期末と当期末の平均で計算します）。回転日数は1年を${days()}日として計算します。評価の目安は現在の評価基準（${criterionLabel(evaluation())}）です。` }));
  for (const g of helpCatalog({ days: days(), evaluation: evaluation() })) {
    panel.append(el('h3', { className: 'sub-title', text: g.name }));
    for (const h of g.items) {
      panel.append(el('details', { className: 'glossary-item' }, [
        el('summary', {}, [el('span', { className: 'glossary-name', text: h.name }), el('span', { className: 'glossary-formula', text: h.formula })]),
        helpBody(h),
      ]));
    }
  }
  panel.append(
    el('h3', { className: 'sub-title', text: '計算できない場合の表示' }),
    el('ul', { className: 'note' }, NA_RULES.map((t) => el('li', { text: t }))),
  );
}

const SETTINGS_RENDERERS = {
  glossary: renderGlossaryPage,
  evaluation: renderEvaluationPage,
  display: renderDisplayPage,
  unit: renderUnitPage,
  pl: (panel) => renderAccountsPage('pl', panel),
  bs: (panel) => renderAccountsPage('bs', panel),
  indicators: renderIndicatorsPage,
  analysis: renderAnalysisPage,
  digits: renderDigitsPage,
  categories: renderCategoriesPage,
  data: renderDataPage,
  about: renderAboutPage,
};

// ---- 共通 ----

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  $('view-input').hidden = view !== 'input';
  $('view-compare').hidden = view !== 'compare';
  $('view-settings').hidden = view !== 'settings';
  $('view-diagram').hidden = view !== 'diagram';
  const reporting = view === 'report';
  document.body.classList.toggle('reporting', reporting);
  document.querySelector('.app-header').hidden = reporting;
  document.querySelector('.sticky-nav').hidden = reporting;
  document.querySelector('.app-main').hidden = reporting;
  if (!reporting) renderSectionNav(view);
  $('view-report').hidden = !reporting;
  if (view === 'compare') renderCompare();
  if (view === 'settings') renderSettings();
  if (view === 'diagram') renderDiagrams();
  if (reporting) renderReport();
  window.scrollTo(0, 0);
}

function update() {
  renderSummary();
  renderInputWarnings();
  renderInputResults();
  renderAdjustmentSummary();
  renderNetDebtSummary();
  renderBackupStatus();
  if (state.view === 'compare') renderCompare();
  if (state.view === 'diagram') renderDiagrams();
  scheduleSave();
}

function hasAnyInput() {
  return hasAnyData(state.data);
}

// ---- バックアップ・復元 ----

function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderBackupStatus() {
  const last = getLastBackupAt();
  $('lastBackup').textContent = last ? `最終バックアップ：${formatDateTime(last)}` : '最終バックアップ：未実施';
  $('backupReminder').hidden = !needsBackupReminder(last, hasAnyInput(), new Date(), settings().backupReminderDays);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function onExport() {
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

function onImportClick() {
  $('importFile').value = '';
  $('importFile').click();
}

async function onImportFile(e) {
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

function onLoadSample() {
  if (hasAnyInput() && !window.confirm('入力中のデータをサンプルデータで上書きします。よろしいですか？')) return;
  const undoable = hasAnyInput() && keepUndo('sample');
  state.data = normalizeData({ ...getSampleMultiData(), settings: settings() });
  state.selected = state.data.periods.length - 1;
  renderForm();
  update();
  saveNow();
  showUndoToast('サンプルデータを読み込みました', undoable);
}

function onClear() {
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
function keepUndo(action) {
  saveNow();
  return saveUndo(createUndoSnapshot(state.data, action, state.selected));
}

function showUndoToast(msg, undoable) {
  if (undoable) showToast(msg, { label: '元に戻す', onClick: onUndo }, 8000);
  else showToast(msg);
}

function onUndo() {
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

async function copyText(text) {
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

async function onCopy() {
  const p = currentPeriod();
  const opts = { ...fmt(), indicators: indicatorList(settings()) };
  const text = buildResultText(state.data, calcIndicators(p, { days: days() }), getWarnings(p, fmt('bs'), fmt('pl')), state.selected, opts);
  const ok = await copyText(text);
  showToast(ok ? `${periodName(p, state.selected)}の結果をコピーしました` : 'コピーできませんでした');
}

let toastTimer = null;
// action = { label, onClick }（「元に戻す」など）。ボタンがあるときは長めに表示する
function showToast(msg, action = null, duration = 2000) {
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

function init() {
  window.__fatalBackup = () => { onExport().catch(() => window.__saveRawBackup?.()); };
  const { data, error } = loadData();
  state.data = data;
  state.storageError = error;
  state.selected = data.periods.length - 1;
  state.basis = data.settings.analysis.defaultBasis;
  renderForm();
  renderGlobalWarnings();
  renderSummary();
  renderInputWarnings();
  renderInputResults();
  renderBackupStatus();

  $('companyName').addEventListener('input', (e) => {
    state.data.companyName = e.target.value;
    scheduleSave();
  });
  $('periodLabel').addEventListener('input', (e) => {
    currentPeriod().label = e.target.value;
    // チップの表示だけ更新（入力欄のフォーカスを保つ）
    const chip = $('periodChips').children[state.selected];
    if (chip) chip.textContent = periodName(currentPeriod(), state.selected);
    $('adjPeriodName').textContent = periodName(currentPeriod(), state.selected);
    $('ndPeriodName').textContent = periodName(currentPeriod(), state.selected);
    scheduleSave();
  });
  $('btnMoveLeft').addEventListener('click', () => onMovePeriod(-1));
  $('btnMoveRight').addEventListener('click', () => onMovePeriod(1));
  $('btnRemovePeriod').addEventListener('click', onRemovePeriod);
  $('btnSample').addEventListener('click', onLoadSample);
  $('btnClear').addEventListener('click', onClear);
  $('btnCopy').addEventListener('click', onCopy);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    state.basis = b.dataset.basis;
    renderCompare();
  }));
  $('showChange').addEventListener('change', (e) => {
    state.showChange = e.target.checked;
    renderCompare();
  });
  $('btnAddAdj').addEventListener('click', onAddAdjustment);
  $('btnAddDebtLike').addEventListener('click', () => onAddLineItem(LINE_LISTS[0]));
  $('btnAddCashLike').addEventListener('click', () => onAddLineItem(LINE_LISTS[1]));
  $('debtLikeExamples').replaceChildren(...DEBT_LIKE_EXAMPLES.map((v) => el('option', { value: v })));
  $('cashLikeExamples').replaceChildren(...CASH_LIKE_EXAMPLES.map((v) => el('option', { value: v })));
  $('btnExport').addEventListener('click', onExport);
  $('btnDeleteAll').addEventListener('click', onDeleteAll);
  $('btnCsvCompare').addEventListener('click', () => exportCsv('comparison', () => buildComparisonCsv(state.data, state.basis)));
  $('btnCsvBridge').addEventListener('click', () => exportCsv('bridge', () => buildBridgeCsv(state.data)));
  $('btnCsvNetDebt').addEventListener('click', () => exportCsv('netDebt', () => buildNetDebtCsv(state.data)));
  $('btnReport').addEventListener('click', () => setView('report'));
  $('btnReportBack').addEventListener('click', () => setView('compare'));
  $('btnPrint').addEventListener('click', () => window.print());
  $('btnImport').addEventListener('click', onImportClick);
  $('importFile').addEventListener('change', onImportFile);
  $('btnStorageBackup').addEventListener('click', onExport);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  registerServiceWorker((apply) => {
    $('updateBar').hidden = false;
    $('btnUpdate').onclick = () => {
      $('btnUpdate').disabled = true;
      saveNow();
      apply();
    };
  });
  requestPersistentStorage();

  renderSectionNav('input');
  window.addEventListener('resize', updateNavHeight);

  // 閉じる直前に未保存分を書き込む
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  // 初めて使う人（データなし・ガイド未表示）には使い方ガイドを出す
  if (!readOnboarded() && !hasAnyData(state.data)) {
    openOnboarding(0);
    try { localStorage.setItem(LAST_VERSION_KEY, APP_VERSION); } catch { /* 記録できなくても使える */ }
  } else showChangesIfUpdated();
}

init();
