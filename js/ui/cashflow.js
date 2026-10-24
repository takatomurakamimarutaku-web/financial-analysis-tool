// キャッシュフロー（推計）の画面：入力タブの表・比較タブの棒グラフ・図解タブの「お金の流れ」・レポートの表
import {
  CASH_FLOW_ROWS, CF_LIMITATION, CF_STATUS_MESSAGES, buildCashFlowSeries, calcCashFlowIndicators, cashFlowBadge,
} from '../cashflow.js';
import { buildBarChartSvg } from '../chart.js';
import { buildWaterfallSvg } from '../diagrams.js';
import { accountLabel, unitOf } from '../settings.js';
import { $, badgeEl, currentPeriod, el, evaluation, fa, fv, settings, state, unitName } from './core.js';
import { periodName } from './input.js';

function signed(v, scope = 'compare') {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const t = fa(v, scope);
  return v > 0 && t !== '0' ? `+${t}` : t;
}

function missingText(cf, data, index) {
  const names = cf.missing.map((m) => {
    const label = accountLabel(settings(), m.key);
    const when = m.when === 'prev' ? periodName(data.periods[index - 1], index - 1) : periodName(data.periods[index], index);
    return `${when}の${label}`;
  });
  const shown = names.slice(0, 6).join('、');
  return `${CF_STATUS_MESSAGES.missing}：${shown}${names.length > 6 ? ` ほか${names.length - 6}項目` : ''}`;
}

// 推計できないときの理由（できるときは空文字）
export function cashFlowReason(cf, data, index) {
  if (cf.status === 'ok') return '';
  if (cf.status === 'missing') return missingText(cf, data, index);
  return CF_STATUS_MESSAGES[cf.status] ?? '';
}

function current() {
  const i = state.selected;
  const p = currentPeriod();
  return { i, p, ind: calcCashFlowIndicators(p, state.data.periods[i - 1] ?? null, settings().adjustmentCategoryNames) };
}

function row(name, value, cls = '') {
  return el('tr', { className: cls }, [el('th', { scope: 'row', text: name }), el('td', { text: value })]);
}

function withBadge(id, result, text) {
  const b = cashFlowBadge(id, result, evaluation());
  return b ? el('td', {}, [text, ' ', badgeEl(b, true)]) : el('td', { text });
}

// 入力タブ「キャッシュフロー（推計）」
export function renderCashFlowInput() {
  const box = $('cfBody');
  if (!box) return;
  const { i, p, ind } = current();
  const cf = ind.cf;
  $('cfPeriodName').textContent = periodName(p, i);
  const u = unitName();
  const parts = [];
  if (cf.status === 'ok') {
    parts.push(el('table', { className: 'bridge-table' }, [el('tbody', {}, [
      el('tr', {}, [el('th', { scope: 'row', text: '営業CF' }), withBadge('operatingCf', ind.operatingCf, signed(cf.operating))]),
      row('投資CF', signed(cf.investing)),
      row('財務CF', signed(cf.financing)),
      row('合計', signed(cf.total), 'total'),
      row('現預金の増減（BS）', signed(cf.cashChange)),
      row('検算', Math.abs(cf.check) < 0.0005 ? '一致' : `差額 ${signed(cf.check)}`),
      row('フリー・キャッシュフロー（営業CF＋投資CF）', signed(ind.fcf.value), 'total'),
      row('設備投資額（推計）', fa(ind.capex.value)),
      row('営業CFマージン', fv(ind.operatingCfMargin, '%')),
    ])]));
    const lines = (title, list) => [
      el('tr', { className: 'group' }, [el('th', { scope: 'rowgroup', colspan: '2', text: title })]),
      ...list.map((l) => row(l.name, signed(l.value), 'indent')),
    ];
    parts.push(el('details', { className: 'cf-details' }, [
      el('summary', { text: '内訳を見る' }),
      el('table', { className: 'bridge-table' }, [el('tbody', {}, [
        ...lines('営業CF', cf.lines.operating),
        ...lines('投資CF', cf.lines.investing),
        ...lines('財務CF', cf.lines.financing),
      ])]),
    ]));
  } else {
    parts.push(el('p', { className: 'warning cf-reason', text: cashFlowReason(cf, state.data, i) }));
  }
  parts.push(el('table', { className: 'bridge-table cf-simple' }, [el('tbody', {}, [
    row('簡易CF（当期純利益＋減価償却費）', fa(ind.simpleCf.value)),
    el('tr', {}, [el('th', { scope: 'row', text: '債務償還年数（有利子負債 ÷ 簡易CF）' }), withBadge('debtRedemptionYears', ind.debtRedemptionYears, fv(ind.debtRedemptionYears, '年'))]),
  ])]));
  parts.push(el('p', { className: 'note', text: `金額の単位：${u}（「分析結果・比較表・グラフ」の単位）。${CF_LIMITATION}` }));
  box.replaceChildren(...parts);
}

// 比較タブ「キャッシュフローの推移」（営業・投資・財務・FCFの棒グラフ）
export function renderCashFlowCompare() {
  const box = $('cfChart');
  if (!box) return;
  const data = state.data;
  const series = buildCashFlowSeries(data);
  const labels = data.periods.map((p, i) => periodName(p, i));
  const scale = unitOf(settings(), 'compare').scale;
  const val = (r) => (r.status === 'ok' ? r.value : null);
  const svg = buildBarChartSvg({
    labels,
    title: 'キャッシュフローの推移',
    tickFormat: (v) => Number((v * scale).toPrecision(10)).toLocaleString('ja-JP', { maximumFractionDigits: 2 }),
    series: [
      { name: '営業CF', values: series.map((s) => val(s.operatingCf)), cls: 'bar-op' },
      { name: '投資CF', values: series.map((s) => val(s.investingCf)), cls: 'bar-inv' },
      { name: '財務CF', values: series.map((s) => val(s.financingCf)), cls: 'bar-fin' },
      { name: 'FCF', values: series.map((s) => val(s.fcf)), cls: 'bar-fcf' },
    ],
  });
  // svg は chart.js で全テキストをエスケープ済み
  box.innerHTML = svg;
  const okCount = series.filter((s) => s.cf.status === 'ok').length;
  $('cfChartNote').textContent = okCount
    ? `最初の期は前の期がないため推計しません。${CF_LIMITATION}`
    : '推計できる期がありません。2期以上の期を入力し、各期のBSをすべて入力すると表示します。';
}

// 図解タブ「お金の流れ」：期首の現預金 → 営業CF → 投資CF → 財務CF → 期末の現預金
export function renderCashFlowDiagram() {
  const holder = $('dgCf');
  if (!holder) return;
  const { i, ind } = current();
  const cf = ind.cf;
  const steps = cf.status === 'ok' ? [
    { label: '期首の現預金', value: cf.openingCash, kind: 'total' },
    { label: '＋ 営業CF', value: cf.operating, kind: 'delta' },
    { label: '＋ 投資CF', value: cf.investing, kind: 'delta' },
    { label: '＋ 財務CF', value: cf.financing, kind: 'delta' },
    { label: '期末の現預金', value: cf.closingCash, kind: 'total' },
  ] : null;
  const fmtStep = (v, b) => (b.kind === 'delta' ? signed(v) : fa(v));
  // svg は diagrams.js で全テキストをエスケープ済み
  holder.innerHTML = buildWaterfallSvg({ steps, format: fmtStep, title: 'お金の流れ' });
  const u = unitName();
  if (cf.status !== 'ok') {
    $('dgCfInsight').textContent = cf.status === 'noPrev' ? '前の期が必要です。前の期を追加し、BSを入力すると表示します。' : cashFlowReason(cf, state.data, i);
    return;
  }
  const fcf = ind.fcf.value;
  $('dgCfInsight').textContent = `本業で ${signed(cf.operating)}${u} のお金を生み、設備投資などに ${fa(-cf.investing)}${u} 使いました（フリー・キャッシュフロー ${signed(fcf)}${u}）。借入・増資などで ${signed(cf.financing)}${u} 動き、現預金は ${signed(cf.cashChange)}${u} 変わりました。`;
}

export function renderCashFlowAll() {
  renderCashFlowInput();
  if (state.view === 'compare') renderCashFlowCompare();
  if (state.view === 'diagram') renderCashFlowDiagram();
}

// 印刷用レポートの表（各期の推計CFと指標）
export function reportCashFlowRows(data) {
  const series = buildCashFlowSeries(data);
  const ev = evaluation();
  return CASH_FLOW_ROWS.map((r) => ({
    name: r.name,
    cls: ['fcf'].includes(r.id) ? 'total' : '',
    cells: series.map((s) => {
      const res = s[r.id];
      const text = r.unit === '千円' ? (res.status === 'ok' ? signed(res.value, 'report') : (res.status === 'notApplicable' ? '参考外' : '—')) : fv(res, r.unit, 'report');
      const b = cashFlowBadge(r.id, res, ev);
      return { text, neg: res.status === 'ok' && res.value < 0, badge: b ? { level: b.level, text: b.text } : null };
    }),
  }));
}
