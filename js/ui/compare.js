// 比較タブ
import { badgeFor } from '../badges.js';
import { CATEGORIES, CHART_ROWS, buildComparison, formatChangeAmount, formatChangeRate, isNum } from '../calc.js';
import { buildLineChartSvg } from '../chart.js';
import { hasHelp } from '../help.js';
import { arrangeComparisonRows, rowLabel, unitOf } from '../settings.js';
import { renderBridgeTable } from './adjustments.js';
import { $, badgeEl, criterionBar, el, evaluation, fa, fmt, fv, settings, state, unitName } from './core.js';
import { helpButton } from './dialogs.js';
import { valueClass } from './input.js';
import { renderNetDebtTable, renderWorkingCapitalTable } from './netdebt.js';


export function groupName(group) {
  if (group === 'amounts') return `主要数値（${unitName()}）`;
  return CATEGORIES.find((c) => c.id === group)?.name ?? '';
}

export function renderCompare() {
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
export function tickFormatFor(unit) {
  if (unit === '%') return (v) => `${Number((v * 100).toPrecision(6))}%`;
  const scale = unit === '千円' ? unitOf(settings()).scale : 1;
  return (v) => Number((v * scale).toPrecision(10)).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

export function renderCharts(cmp) {
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
