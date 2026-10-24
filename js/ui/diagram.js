// 図解タブ
import { calcAdjustedNetDebt, calcIndicators, calcNormalizedEbitda, isNum } from '../calc.js';
import {
  bsBoxes, buildBsBoxSvg, buildCccSvg, buildWaterfallSvg, cccParts, ebitdaSteps, netDebtSteps, plSteps,
} from '../diagrams.js';
import { formatSigned } from './adjustments.js';
import { $, currentPeriod, days, el, fa, fv, settings, state, unitName } from './core.js';
import { periodName, renderUnitLabels, selectPeriod } from './input.js';


export function pctOf(part, whole) {
  return isNum(part) && isNum(whole) && whole !== 0 ? fv({ value: part / whole, status: 'ok' }, '%') : '—';
}

export function setSvg(id, svg) {
  // svg は diagrams.js で全テキストをエスケープ済み
  $(id).innerHTML = svg;
}

export function renderDiagramPeriods() {
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

export function renderDiagrams() {
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

export function diffOrNull(a, b) {
  return isNum(a) && isNum(b) ? a - b : null;
}
