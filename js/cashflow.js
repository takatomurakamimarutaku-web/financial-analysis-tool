// キャッシュフローの推計（CF-1）。DOMに依存しない純粋関数。
// 前期と当期のBS、当期のPLから、間接法で営業・投資・財務CFを推計する（CF計算書の入力は使わない）。
// 金額は内部単位（千円）。Δ は「当期末 − 前期末」。
// 区分の振り分けは簡易で、固定資産の売却益は営業CFに、保険積立金・貸付金の増減は投資CFに入るなどの限界がある。
import { BALANCE_TOLERANCE, buildComparison, calcNormalizedEbitda, changeOf, checkBalance, isNum, safeDiv } from './calc.js';

export const CF_REQUIRED = {
  pl: ['netIncome', 'depreciation'],
  bs: ['cash', 'receivables', 'inventory', 'currentAssets', 'fixedAssets', 'payables', 'currentLiabilities', 'fixedLiabilities', 'interestBearingDebt', 'netAssets'],
};

export const CF_LIMITATION = '推計CFは前期・当期のBSの増減と当期のPLから計算した簡易な値です。営業・投資・財務の合計は現預金の増減と一致しますが、区分の振り分けは簡易です（例：固定資産の売却益は営業CFに、保険積立金・貸付金の増減は投資CFに入ります）。';

export const CF_STATUS_MESSAGES = {
  noPrev: '前の期がないため推計できません。前の期を追加して、その期のBSを入力すると推計できます。',
  missing: '推計に必要な項目が未入力です',
  unbalanced: '貸借が一致していない期があるため推計できません（資産合計と負債・純資産合計をご確認ください）',
};

function sub(a, b) {
  return a - b;
}

// 差額で作る「その他」。その他流動資産 = 流動資産 − 現預金 − 売上債権 − 棚卸資産
export function otherCurrentAssets(bs) {
  return bs.currentAssets - bs.cash - bs.receivables - bs.inventory;
}

// その他負債（無利子）= 流動負債 + 固定負債 − 仕入債務 − 有利子負債
export function otherLiabilities(bs) {
  return bs.currentLiabilities + bs.fixedLiabilities - bs.payables - bs.interestBearingDebt;
}

// 期の貸借が一致しているか（流動資産＋固定資産 = 流動負債＋固定負債＋純資産。総資産の入力があればそれとも比べる）
export function isBalanced(bs) {
  const left = bs.currentAssets + bs.fixedAssets;
  const right = bs.currentLiabilities + bs.fixedLiabilities + bs.netAssets;
  if (Math.abs(left - right) >= BALANCE_TOLERANCE) return false;
  const { assetsDiff, liabEquityDiff } = checkBalance(bs);
  return !(isNum(assetsDiff) && Math.abs(assetsDiff) >= BALANCE_TOLERANCE)
    && !(isNum(liabEquityDiff) && Math.abs(liabEquityDiff) >= BALANCE_TOLERANCE);
}

function missingOf(period, prev) {
  const out = [];
  for (const key of CF_REQUIRED.pl) if (!isNum(period?.pl?.[key])) out.push({ section: 'pl', key, when: 'current' });
  for (const key of CF_REQUIRED.bs) {
    if (!isNum(period?.bs?.[key])) out.push({ section: 'bs', key, when: 'current' });
    if (!isNum(prev?.bs?.[key])) out.push({ section: 'bs', key, when: 'prev' });
  }
  return out;
}

// 推計CF。戻り値：
// { status: 'ok' | 'noPrev' | 'missing' | 'unbalanced', missing: [{ section, key, when }],
//   operating, investing, financing, total, cashChange, check（total − 現預金の増減）, openingCash, closingCash,
//   lines: { operating: [{ id, name, value }], investing: [...], financing: [...] } }
export function estimateCashFlow(period, prev) {
  const empty = { missing: [], operating: null, investing: null, financing: null, total: null, cashChange: null, check: null, openingCash: null, closingCash: null, lines: null };
  if (!prev) return { ...empty, status: 'noPrev' };
  const missing = missingOf(period, prev);
  if (missing.length) return { ...empty, status: 'missing', missing };
  const pl = period.pl;
  const bs = period.bs;
  const pb = prev.bs;
  if (!isBalanced(bs) || !isBalanced(pb)) return { ...empty, status: 'unbalanced' };
  const d = (f) => sub(f(bs), f(pb));
  const k = (key) => (b) => b[key];
  const operatingLines = [
    { id: 'netIncome', name: '当期純利益', value: pl.netIncome },
    { id: 'depreciation', name: '減価償却費', value: pl.depreciation },
    { id: 'receivables', name: '売上債権の増減', value: -d(k('receivables')) },
    { id: 'inventory', name: '棚卸資産の増減', value: -d(k('inventory')) },
    { id: 'payables', name: '仕入債務の増減', value: d(k('payables')) },
    { id: 'otherCurrentAssets', name: 'その他流動資産の増減', value: -d(otherCurrentAssets) },
    { id: 'otherLiabilities', name: 'その他負債（無利子）の増減', value: d(otherLiabilities) },
  ];
  const investingLines = [
    { id: 'capex', name: '設備投資など（固定資産の増減＋減価償却費）', value: -(d(k('fixedAssets')) + pl.depreciation) },
  ];
  const financingLines = [
    { id: 'interestBearingDebt', name: '有利子負債の増減', value: d(k('interestBearingDebt')) },
    { id: 'equityOther', name: '利益以外の純資産の増減（増資・配当など）', value: d(k('netAssets')) - pl.netIncome },
  ];
  const total = (lines) => clean(lines.reduce((s, l) => s + l.value, 0));
  const lines = {
    operating: operatingLines.map((l) => ({ ...l, value: clean(l.value) })),
    investing: investingLines.map((l) => ({ ...l, value: clean(l.value) })),
    financing: financingLines.map((l) => ({ ...l, value: clean(l.value) })),
  };
  const operating = total(lines.operating);
  const investing = total(lines.investing);
  const financing = total(lines.financing);
  const sum = clean(operating + investing + financing);
  const cashChange = clean(bs.cash - pb.cash);
  return {
    status: 'ok', missing: [], operating, investing, financing, total: sum, cashChange, check: clean(sum - cashChange),
    openingCash: pb.cash, closingCash: bs.cash, lines,
  };
}

// 浮動小数の誤差（千円で小数第6位まで）をならす
function clean(v) {
  return isNum(v) ? Math.round(v * 1e6) / 1e6 : v;
}

function ok(v) {
  return isNum(v) ? { value: v, status: 'ok' } : { value: null, status: 'na' };
}

// CFの指標。戻り値は既存と同じ { value, status } の形。
// 簡易CF・債務償還年数は前期がなくても出す。債務償還年数 = 有利子負債 ÷ 簡易CF（簡易CFが0以下なら参考外）
export function calcCashFlowIndicators(period, prev, names) {
  const cf = estimateCashFlow(period, prev);
  const pl = period?.pl ?? {};
  const bs = period?.bs ?? {};
  const simple = isNum(pl.netIncome) && isNum(pl.depreciation) ? clean(pl.netIncome + pl.depreciation) : null;
  let years = { value: null, status: 'na' };
  if (isNum(simple) && isNum(bs.interestBearingDebt)) {
    years = simple <= 0 ? { value: null, status: 'notApplicable' } : ok(bs.interestBearingDebt / simple);
  }
  const capex = cf.status === 'ok' ? -cf.investing : null;
  const normalized = calcNormalizedEbitda(period, names).normalized;
  return {
    cf,
    operatingCf: ok(cf.operating),
    investingCf: ok(cf.investing),
    financingCf: ok(cf.financing),
    fcf: ok(cf.status === 'ok' ? clean(cf.operating + cf.investing) : null),
    simpleCf: ok(simple),
    operatingCfMargin: cf.status === 'ok' && isNum(pl.sales) && pl.sales > 0 ? ok(safeDiv(cf.operating, pl.sales)) : { value: null, status: 'na' },
    capex: ok(capex),
    debtRedemptionYears: years,
    normalizedEbitdaLessCapex: ok(isNum(normalized) && isNum(capex) ? clean(normalized - capex) : null),
  };
}

// 比較表・CSV・レポートに追加する行
export const CASH_FLOW_ROWS = [
  { id: 'operatingCf', name: '営業CF（推計）', unit: '千円' },
  { id: 'investingCf', name: '投資CF（推計）', unit: '千円' },
  { id: 'financingCf', name: '財務CF（推計）', unit: '千円' },
  { id: 'fcf', name: 'フリー・キャッシュフロー（FCF）', unit: '千円' },
  { id: 'simpleCf', name: '簡易CF（当期純利益＋減価償却費）', unit: '千円' },
  { id: 'operatingCfMargin', name: '営業CFマージン', unit: '%' },
  { id: 'capex', name: '設備投資額（推計）', unit: '千円' },
  { id: 'debtRedemptionYears', name: '債務償還年数', unit: '年' },
  { id: 'normalizedEbitdaLessCapex', name: '正常化EBITDA − 設備投資額（参考）', unit: '千円' },
];

export const CASH_FLOW_GROUP = { id: 'cashflow', name: 'キャッシュフロー（推計）' };

export function buildCashFlowSeries(data) {
  const periods = data?.periods ?? [];
  const names = data?.settings?.adjustmentCategoryNames;
  return periods.map((p, i) => calcCashFlowIndicators(p, periods[i - 1] ?? null, names));
}

// 比較表の行（buildComparison と同じ形）
export function cashFlowComparisonRows(data) {
  const series = buildCashFlowSeries(data);
  return CASH_FLOW_ROWS.map((r) => {
    const results = series.map((s) => s[r.id]);
    return {
      id: r.id, name: r.name, unit: r.unit, group: CASH_FLOW_GROUP.id, averageable: false,
      cells: results.map((result, i) => ({
        result,
        change: i === 0 ? null : changeOf(
          result.status === 'ok' ? result.value : null,
          results[i - 1].status === 'ok' ? results[i - 1].value : null,
        ),
      })),
    };
  });
}

// 比較表（既存の行のあとにCFの行）
export function buildComparisonWithCashFlow(data, basis = 'end') {
  const cmp = buildComparison(data, basis);
  return { ...cmp, rows: [...cmp.rows, ...cashFlowComparisonRows(data)] };
}

// CFの評価バッジ。「標準」の基準でだけ付ける（ほかの基準の目安は未確認のため）。
// 債務償還年数：10年以下で良好、20年超で注意。営業CFがマイナスなら注意。
export const CF_BADGE_RULES = { debtRedemptionYears: { good: 10, caution: 20 } };

export function cashFlowBadge(id, result, evaluation) {
  if (!evaluation || evaluation.enabled === false || (evaluation.criterion ?? 'standard') !== 'standard') return null;
  if (!result) return null;
  if (id === 'operatingCf' && result.status === 'ok' && result.value < 0) {
    return { level: 'caution', label: '注意', note: 'マイナス', text: '注意（マイナス）', source: 'standard' };
  }
  if (id === 'debtRedemptionYears') {
    if (result.status === 'notApplicable') return { level: 'caution', label: '注意', note: '返済原資なし', text: '注意（返済原資なし）', source: 'standard' };
    if (result.status !== 'ok') return null;
    const r = CF_BADGE_RULES.debtRedemptionYears;
    if (result.value <= r.good + 1e-9) return { level: 'good', label: '良好', note: '', text: '良好', source: 'standard' };
    if (result.value > r.caution + 1e-9) return { level: 'caution', label: '注意', note: '', text: '注意', source: 'standard' };
  }
  return null;
}
