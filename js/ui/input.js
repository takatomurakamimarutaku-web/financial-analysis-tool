// 入力タブ（サマリー・PL/BS入力・分析結果）
import { badgeFor, badgesFor, guideFor } from '../badges.js';
import {
  CATEGORIES, MAX_PERIODS, buildComparison, calcIndicators, formatChangeAmount, formatChangeRate, formulaText, getWarnings, isNum, parseAmount,
} from '../calc.js';
import {
  accountTree, applyAccountTotalsToPeriod, commonUnit, fromDisplayAmount, indicatorList, isComputedAccount, rowLabel,
} from '../settings.js';
import { copyFromPrevious, liveGroup, missingRequired } from '../input-helpers.js';
import { addPeriod, movePeriod, removePeriod } from '../store.js';
import { renderAdjustments } from './adjustments.js';
import { update } from './app.js';
import { keepUndo, showUndoToast } from './backup.js';
import {
  $, applyTheme, badgeEl, criterionBar, currentPeriod, days, el, evaluation, fa, fmt, formatInput, fv, saveNow, settings, showToast, state, unitName,
} from './core.js';
import { helpButton } from './dialogs.js';
import { renderNetDebtInputs } from './netdebt.js';
import { toggle } from './settings-view.js';


export const SUMMARY_ROWS = ['sales', 'operatingIncome', 'ebitda', 'equityRatio'];

export function renderSummary() {
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
export function parseInput(text, scope) {
  return fromDisplayAmount(parseAmount(text), settings(), scope);
}

// 画面内の単位表記（.unit-name の data-scope の区分）を設定に合わせる。data-scope="all" は全区分が同じなら単位、違えば「区分ごと」
export function renderUnitLabels() {
  document.querySelectorAll('.unit-name').forEach((n) => {
    const scope = n.dataset.scope || 'compare';
    n.textContent = scope === 'all' ? (commonUnit(settings())?.name ?? '区分ごとに設定') : unitName(scope);
  });
}

export function periodName(p, i) {
  return p.label || `第${i + 1}期`;
}


export function amountInput(id, attrs, value, scope) {
  const input = el('input', {
    id, type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', 'data-amount': '', ...attrs,
  });
  input.value = formatInput(value, scope);
  return input;
}

// 科目の入力欄。並び・名称・非表示は設定に従い、内訳科目は親科目の下に並べる。
export function renderAmountFields(containerId, section) {
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
export function refreshParentField(section, key) {
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

export function setDetail(key, value) {
  const p = currentPeriod();
  p.details = { ...(p.details ?? {}), [key]: value };
  const q = applyAccountTotalsToPeriod(p, settings());
  p.pl = q.pl;
  p.bs = q.bs;
}

export function onDetailInput(e) {
  const input = e.target;
  const text = input.value.trim();
  const v = parseInput(text, input.dataset.section);
  setDetail(input.dataset.detail, v);
  input.setAttribute('aria-invalid', text !== '' && v === null ? 'true' : 'false');
  refreshParentField(input.dataset.section, input.dataset.parent);
  update();
}

export function onDetailBlur(e) {
  const v = currentPeriod().details?.[e.target.dataset.detail];
  if (isNum(v)) e.target.value = formatInput(v, e.target.dataset.section);
}

export function toggleDetailSign(key, input) {
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

export function renderPeriodBar() {
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
  $('btnCopyPrev').disabled = state.selected === 0;
  $('btnMoveRight').disabled = state.selected === state.data.periods.length - 1;
}

export function renderForm() {
  applyTheme();
  $('companyName').value = state.data.companyName;
  renderPeriodBar();
  renderAmountFields('plFields', 'pl');
  renderAmountFields('bsFields', 'bs');
  renderUnitLabels();
  renderAdjustments();
  renderNetDebtInputs();
  renderMissingFields();
}

export function onFieldInput(e) {
  const input = e.target;
  const { section, key } = input.dataset;
  const text = input.value.trim();
  const v = parseInput(text, section);
  currentPeriod()[section][key] = v;
  input.setAttribute('aria-invalid', text !== '' && v === null ? 'true' : 'false');
  update();
}

export function onFieldBlur(e) {
  const input = e.target;
  const v = currentPeriod()[input.dataset.section][input.dataset.key];
  if (isNum(v)) input.value = formatInput(v, input.dataset.section);
}

export function toggleSign(section, key, input) {
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

export function selectPeriod(i) {
  state.selected = i;
  renderForm();
  renderSummary();
  renderInputWarnings();
  renderInputResults();
}

export function onAddPeriod() {
  const next = addPeriod(state.data);
  if (next === state.data) return;
  state.data = next;
  state.selected = next.periods.length - 1;
  renderForm();
  update();
}

export function onRemovePeriod() {
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

// 金額の入力欄（data-amount）に、入力中から3桁ごとのカンマを入れる（日本語入力の変換中は除く）
export function attachLiveGrouping() {
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-amount') || e.isComposing || t.readOnly) return;
    const caret = t.selectionStart ?? t.value.length;
    const r = liveGroup(t.value, caret);
    if (r.text === t.value) return;
    t.value = r.text;
    try {
      t.setSelectionRange(r.caret, r.caret);
    } catch {
      // カーソル位置を設定できない入力欄では何もしない
    }
  }, true);
}

// 未入力の主な科目（選択中の期）。押すとその入力欄へ移動する
export function renderMissingFields() {
  const box = $('missingFields');
  if (!box) return;
  const hidden = [...settings().accounts.pl, ...settings().accounts.bs].filter((a) => a.hidden).map((a) => a.key);
  const missing = missingRequired(currentPeriod(), hidden);
  box.hidden = missing.length === 0;
  if (!missing.length) {
    box.replaceChildren();
    return;
  }
  const labelOf = (section, key) => accountTree(settings(), section).find((a) => a.key === key)?.label ?? key;
  box.replaceChildren(
    el('span', { className: 'missing-head', text: `未入力の主な科目（${missing.length}）` }),
    el('div', { className: 'missing-list' }, missing.map((f) => {
      const b = el('button', { type: 'button', className: 'missing-item', title: `${f.uses}に使います`, text: labelOf(f.section, f.key) });
      b.addEventListener('click', () => {
        const input = $(`f-${f.section}-${f.key}`);
        if (!input) return;
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input.focus({ preventScroll: true });
      });
      return b;
    })),
  );
}

// 前の期の金額を、選択中の期の未入力の欄にだけコピーする
export function onCopyPrevious() {
  const i = state.selected;
  if (i === 0) return;
  const prev = state.data.periods[i - 1];
  const { period, count } = copyFromPrevious(currentPeriod(), prev, settings().accounts.custom);
  if (!count) {
    showToast('コピーできる金額がありません（未入力の欄がないか、前の期が未入力です）');
    return;
  }
  const undoable = keepUndo('copyPrev');
  state.data.periods[i] = applyAccountTotalsToPeriod(period, settings());
  renderForm();
  update();
  saveNow();
  showUndoToast(`「${periodName(prev, i - 1)}」から${count}項目をコピーしました`, undoable);
}

export function onMovePeriod(delta) {
  const next = movePeriod(state.data, state.selected, delta);
  if (next === state.data) return;
  state.data = next;
  state.selected += delta;
  renderPeriodBar();
  update();
}

export function renderInputWarnings() {
  const box = $('warnings');
  box.replaceChildren();
  for (const w of getWarnings(currentPeriod(), fmt('bs'), fmt('pl'))) {
    box.append(el('div', { className: 'warning', text: w.message }));
  }
}

export function renderGlobalWarnings() {
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

export function valueClass(base, r) {
  const c = [base];
  if (!r || r.status !== 'ok') c.push('na');
  else if (r.value < 0) c.push('negative');
  return c.join(' ');
}

export function renderInputResults() {
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
