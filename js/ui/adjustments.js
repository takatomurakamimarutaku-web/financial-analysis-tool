// 正常化EBITDA（調整項目）
import {
  ADJUSTMENT_CATEGORIES, buildEbitdaBridge, calcNormalizedEbitda, getAdjustmentWarnings, isNum,
} from '../calc.js';
import { categoryLabel } from '../settings.js';
import { addAdjustment, createAdjustment, removeAdjustment } from '../store.js';
import { renderCompare } from './compare.js';
import { $, currentPeriod, el, fa, formatInput, fv, scheduleSave, settings, state, unitName } from './core.js';
import { parseInput, periodName } from './input.js';
import { toggle } from './settings-view.js';


export function formatSigned(v, scope) {
  if (!isNum(v)) return '—';
  const t = fa(v, scope);
  return v > 0 && t !== '0' ? `+${t}` : t;
}

export function renderAdjustments() {
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

    const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: unitName('ebitda'), 'data-amount': '' });
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
export function renderAdjustmentSummary() {
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

export function onAdjustmentChanged() {
  renderAdjustmentSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

export function onAddAdjustment() {
  state.data = addAdjustment(state.data, state.selected, createAdjustment('executiveComp'));
  renderAdjustments();
  onAdjustmentChanged();
  const items = $('adjList').querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input[type="text"]')?.focus();
}

export function onRemoveAdjustment(a) {
  const label = a.description ? `「${a.description}」` : 'この調整項目';
  if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
  state.data = removeAdjustment(state.data, state.selected, a.id);
  renderAdjustments();
  onAdjustmentChanged();
}

export function renderBridgeTable() {
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
