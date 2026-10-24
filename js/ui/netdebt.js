// 運転資本・ネットデット
import {
  buildNetDebtBreakdown, calcAdjustedNetDebt, calcWorkingCapital, calcWorkingCapitalSeries, getNetDebtItemWarnings, isNum,
} from '../calc.js';
import { accountLabel } from '../settings.js';
import { addLineItem, createLineItem, removeLineItem } from '../store.js';
import { renderCompare } from './compare.js';
import { $, currentPeriod, el, fa, fmt, formatInput, fv, scheduleSave, settings, state, unitName } from './core.js';
import { parseInput, periodName } from './input.js';
import { toggle } from './settings-view.js';


export const LINE_LISTS = [
  { key: 'debtLikeItems', container: 'debtLikeList', datalist: 'debtLikeExamples', kind: 'デットライク' },
  { key: 'cashLikeItems', container: 'cashLikeList', datalist: 'cashLikeExamples', kind: 'キャッシュライク' },
];

export function pctText(v) {
  return fv({ value: v, status: isNum(v) ? 'ok' : 'na' }, '%');
}

export function amountText(v, scope = 'netDebt') {
  return isNum(v) ? `${fa(v, scope)}${unitName(scope)}` : '—';
}

export function acc(key) {
  return accountLabel(settings(), key);
}

export function renderNetDebtInputs() {
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

      const amount = el('input', { id: `${idBase}-amt`, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: unitName('netDebt'), 'data-amount': '' });
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
export function renderNetDebtSummary() {
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

export function onNetDebtChanged() {
  renderNetDebtSummary();
  if (state.view === 'compare') renderCompare();
  scheduleSave();
}

export function onAddLineItem(def) {
  state.data = addLineItem(state.data, state.selected, def.key, createLineItem());
  renderNetDebtInputs();
  onNetDebtChanged();
  const items = $(def.container).querySelectorAll('.adj-item');
  items[items.length - 1]?.querySelector('input')?.focus();
}

export function headRowFor(labels, extra = []) {
  const head = el('tr', {}, [el('th', { className: 'row-head', scope: 'col', text: '項目' })]);
  labels.forEach((l, i) => head.append(el('th', { scope: 'col', text: l || `第${i + 1}期` })));
  for (const x of extra) head.append(el('th', { scope: 'col', className: 'avg-col', text: x }));
  return el('thead', {}, [head]);
}

export function valueCell(text, v, cls = '') {
  return el('td', { className: cls }, [el('span', { className: `cell-value${isNum(v) ? (v < 0 ? ' negative' : '') : ' na'}`, text })]);
}

export function renderWorkingCapitalTable() {
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

export function renderNetDebtTable() {
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
