// 財務指標の計算（DOMに依存しない純粋関数）
// 金額単位は千円。内部では丸めず、丸めは formatValue / formatAmount でのみ行う。

export const PL_FIELDS = [
  { key: 'sales', label: '売上高' },
  { key: 'costOfSales', label: '売上原価' },
  { key: 'sga', label: '販管費' },
  { key: 'operatingIncome', label: '営業利益' },
  { key: 'ordinaryIncome', label: '経常利益' },
  { key: 'netIncome', label: '当期純利益' },
  { key: 'depreciation', label: '減価償却費' },
  { key: 'interestExpense', label: '支払利息' },
];

export const BS_FIELDS = [
  { key: 'cash', label: '現預金' },
  { key: 'receivables', label: '売上債権' },
  { key: 'inventory', label: '棚卸資産' },
  { key: 'currentAssets', label: '流動資産合計' },
  { key: 'fixedAssets', label: '固定資産合計' },
  { key: 'totalAssets', label: '総資産' },
  { key: 'payables', label: '仕入債務' },
  { key: 'currentLiabilities', label: '流動負債合計' },
  { key: 'fixedLiabilities', label: '固定負債合計' },
  { key: 'interestBearingDebt', label: '有利子負債' },
  { key: 'netAssets', label: '純資産（自己資本）' },
];

export const CATEGORIES = [
  { id: 'profitability', name: '収益性' },
  { id: 'safety', name: '安全性' },
  { id: 'efficiency', name: '効率性' },
  { id: 'ma', name: 'M&A' },
];

// 貸借差額をこの値未満なら一致とみなす（千円単位で0.5円。浮動小数点誤差対策）
export const BALANCE_TOLERANCE = 0.0005;

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function safeDiv(a, b) {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

export function sumOf(...vals) {
  if (!vals.every(isNum)) return null;
  return vals.reduce((s, v) => s + v, 0);
}

export function diff(a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  return a - b;
}

function times(a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  return a * b;
}

// 入力文字列を数値に変換する。空欄・解釈できない値は null。
// 対応：カンマ、全角数字、全角記号、先頭の「-」「−」「△」「▲」（負数）
export function parseAmount(str) {
  if (isNum(str)) return str;
  if (typeof str !== 'string') return null;
  let s = str
    .replace(/[０-９．，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s,]/g, '');
  if (s === '') return null;
  let negative = false;
  if (/^[-−‐ー－△▲]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function isInsolvent(bs) {
  return isNum(bs?.netAssets) && bs.netAssets < 0;
}

const DAYS = 365;

function receivableDays({ pl, bs }) {
  return times(safeDiv(bs.receivables, pl.sales), DAYS);
}
function inventoryDays({ pl, bs }) {
  return times(safeDiv(bs.inventory, pl.costOfSales), DAYS);
}
function payableDays({ pl, bs }) {
  return times(safeDiv(bs.payables, pl.costOfSales), DAYS);
}
function ebitda({ pl }) {
  return sumOf(pl.operatingIncome, pl.depreciation);
}
function netDebt({ bs }) {
  return diff(bs.interestBearingDebt, bs.cash);
}

// 指標定義。compute は { pl, bs } を受け取り number または null を返す。
// notApplicable(ctx) が true のときは「参考外」とする。
export const INDICATORS = [
  // 収益性
  {
    id: 'grossMargin', category: 'profitability', name: '売上総利益率', unit: '%',
    formula: '(売上高 − 売上原価) ÷ 売上高',
    guide: '商品・サービス自体の利益率。業種差が大きく、同業他社や過去との比較で見る。低下は値下げや原価高騰のサイン。',
    compute: ({ pl }) => safeDiv(diff(pl.sales, pl.costOfSales), pl.sales),
  },
  {
    id: 'operatingMargin', category: 'profitability', name: '営業利益率', unit: '%',
    formula: '営業利益 ÷ 売上高',
    guide: '本業の稼ぐ力。一般に5%以上で良好、10%以上で高収益とされることが多い（業種差あり）。',
    compute: ({ pl }) => safeDiv(pl.operatingIncome, pl.sales),
  },
  {
    id: 'ordinaryMargin', category: 'profitability', name: '経常利益率', unit: '%',
    formula: '経常利益 ÷ 売上高',
    guide: '金融収支を含めた経常的な収益力。営業利益率との差が大きい場合は支払利息等の負担を確認する。',
    compute: ({ pl }) => safeDiv(pl.ordinaryIncome, pl.sales),
  },
  {
    id: 'roa', category: 'profitability', name: 'ROA（総資産経常利益率）', unit: '%',
    averageable: true,
    formula: '経常利益 ÷ 総資産',
    guide: '資産全体をどれだけ効率よく利益に結びつけたか。中小企業では5%程度が一つの目安。',
    compute: ({ pl, bs }) => safeDiv(pl.ordinaryIncome, bs.totalAssets),
  },
  {
    id: 'roe', category: 'profitability', name: 'ROE（自己資本利益率）', unit: '%',
    averageable: true,
    formula: '当期純利益 ÷ 自己資本',
    guide: '株主の資本でどれだけ利益を上げたか。8〜10%以上が一つの目安。自己資本が小さいと高く出やすい点に注意。',
    insolventNA: true,
    compute: ({ pl, bs }) => safeDiv(pl.netIncome, bs.netAssets),
  },
  // 安全性
  {
    id: 'currentRatio', category: 'safety', name: '流動比率', unit: '%',
    formula: '流動資産 ÷ 流動負債',
    guide: '1年以内の支払能力。一般に200%以上が理想、100%を下回ると資金繰りに注意。',
    compute: ({ bs }) => safeDiv(bs.currentAssets, bs.currentLiabilities),
  },
  {
    id: 'quickRatio', category: 'safety', name: '当座比率', unit: '%',
    formula: '(現預金 + 売上債権) ÷ 流動負債',
    guide: '換金性の高い資産での短期支払能力。100%以上が一つの目安。',
    compute: ({ bs }) => safeDiv(sumOf(bs.cash, bs.receivables), bs.currentLiabilities),
  },
  {
    id: 'equityRatio', category: 'safety', name: '自己資本比率', unit: '%',
    formula: '自己資本 ÷ 総資産',
    guide: '返済不要の資本の割合。30%以上で安定、40%以上で優良とされることが多い。マイナスは債務超過。',
    compute: ({ bs }) => safeDiv(bs.netAssets, bs.totalAssets),
  },
  {
    id: 'fixedRatio', category: 'safety', name: '固定比率', unit: '%',
    formula: '固定資産 ÷ 自己資本',
    guide: '固定資産を自己資本でまかなえているか。100%以下が理想。',
    insolventNA: true,
    compute: ({ bs }) => safeDiv(bs.fixedAssets, bs.netAssets),
  },
  {
    id: 'fixedLongTermRatio', category: 'safety', name: '固定長期適合率', unit: '%',
    formula: '固定資産 ÷ (自己資本 + 固定負債)',
    guide: '固定資産を長期の資金でまかなえているか。100%以下が望ましく、超える場合は短期資金で長期投資をしている。',
    notApplicable: ({ bs }) => {
      const d = sumOf(bs.netAssets, bs.fixedLiabilities);
      return isNum(d) && d < 0;
    },
    compute: ({ bs }) => safeDiv(bs.fixedAssets, sumOf(bs.netAssets, bs.fixedLiabilities)),
  },
  {
    id: 'deRatio', category: 'safety', name: 'D/Eレシオ', unit: '倍',
    formula: '有利子負債 ÷ 自己資本',
    guide: '自己資本に対する借入の大きさ。1倍以下が一つの目安。高いほど財務レバレッジが大きい。',
    insolventNA: true,
    compute: ({ pl, bs }) => safeDiv(bs.interestBearingDebt, bs.netAssets),
  },
  {
    id: 'icr', category: 'safety', name: 'インタレスト・カバレッジ・レシオ', unit: '倍',
    formula: '営業利益 ÷ 支払利息',
    guide: '利息の支払余力。高いほど安全で、1倍を下回ると営業利益で利息を払えていない。',
    compute: ({ pl }) => safeDiv(pl.operatingIncome, pl.interestExpense),
  },
  // 効率性
  {
    id: 'assetTurnover', category: 'efficiency', name: '総資産回転率', unit: '回',
    formula: '売上高 ÷ 総資産',
    guide: '資産がどれだけ売上を生んだか。高いほど資産効率が良い。業種差が大きい。',
    compute: ({ pl, bs }) => safeDiv(pl.sales, bs.totalAssets),
  },
  {
    id: 'receivableDays', category: 'efficiency', name: '売上債権回転日数', unit: '日',
    averageable: true,
    formula: '売上債権 ÷ 売上高 × 365',
    guide: '売上の回収にかかる日数。取引条件（サイト）と比べて長い場合は回収遅延や不良債権に注意。',
    compute: receivableDays,
  },
  {
    id: 'inventoryDays', category: 'efficiency', name: '棚卸資産回転日数', unit: '日',
    averageable: true,
    formula: '棚卸資産 ÷ 売上原価 × 365',
    guide: '在庫が何日分あるか。長期化は過剰在庫・滞留在庫の可能性。',
    compute: inventoryDays,
  },
  {
    id: 'payableDays', category: 'efficiency', name: '仕入債務回転日数', unit: '日',
    averageable: true,
    formula: '仕入債務 ÷ 売上原価 × 365',
    guide: '仕入代金の支払までの日数。長いほど資金繰りは楽だが、急な短縮は取引条件悪化のサイン。',
    compute: payableDays,
  },
  {
    id: 'ccc', category: 'efficiency', name: 'CCC（キャッシュ・コンバージョン・サイクル）', unit: '日',
    averageable: true,
    formula: '売上債権回転日数 + 棚卸資産回転日数 − 仕入債務回転日数',
    guide: '仕入の支払から売上の回収までに資金が寝る日数。短いほど運転資金負担が小さい。',
    compute: (ctx) => {
      const s = sumOf(receivableDays(ctx), inventoryDays(ctx));
      return diff(s, payableDays(ctx));
    },
  },
  // M&A
  {
    id: 'ebitda', category: 'ma', name: 'EBITDA', unit: '千円',
    formula: '営業利益 + 減価償却費',
    guide: '設備投資の償却方針や資金調達構造の影響を除いた収益力。企業価値評価（EV/EBITDA倍率）の基礎となる。',
    compute: ebitda,
  },
  {
    id: 'netDebt', category: 'ma', name: 'ネットデット', unit: '千円',
    formula: '有利子負債 − 現預金',
    guide: '実質的な借入額。マイナスは借入より現預金が多い（ネットキャッシュ）状態。株式価値 = 企業価値 − ネットデット。',
    compute: netDebt,
  },
  {
    id: 'netDebtToEbitda', category: 'ma', name: 'ネットデット ÷ EBITDA', unit: '倍',
    formula: 'ネットデット ÷ EBITDA',
    guide: '借入を何年分のEBITDAで返済できるか。3倍以下が一つの目安、5倍超は借入過大とされやすい。EBITDAがマイナスの場合は参考外。',
    notApplicable: (ctx) => {
      const e = ebitda(ctx);
      return isNum(e) && e < 0;
    },
    compute: (ctx) => safeDiv(netDebt(ctx), ebitda(ctx)),
  },
];

function toCtx(period) {
  return { pl: period?.pl ?? {}, bs: period?.bs ?? {} };
}

export const BASES = [
  { id: 'end', name: '期末残高' },
  { id: 'average', name: '平均残高' },
];

// 平均残高 = (前期末 + 当期末) ÷ 2。どちらかが未入力、または前期がなければ null。
export function averageBs(bs = {}, prevBs) {
  const o = {};
  for (const f of BS_FIELDS) {
    const s = prevBs ? sumOf(bs[f.key], prevBs[f.key]) : null;
    o[f.key] = isNum(s) ? s / 2 : null;
  }
  return o;
}

// 全指標を計算する。戻り値：{ [id]: { value: number|null, status: 'ok'|'na'|'notApplicable' } }
// options.basis = 'end'（既定。期末残高）| 'average'（平均残高。averageable な指標のみ）
// options.prevPeriod = 平均残高の計算に使う前期
export function calcIndicators(period, options = {}) {
  const endCtx = toCtx(period);
  const avgCtx = options.basis === 'average'
    ? { pl: endCtx.pl, bs: averageBs(endCtx.bs, options.prevPeriod?.bs) }
    : null;
  const results = {};
  for (const ind of INDICATORS) {
    const ctx = avgCtx && ind.averageable ? avgCtx : endCtx;
    if ((ind.insolventNA && isInsolvent(ctx.bs)) || (ind.notApplicable && ind.notApplicable(ctx))) {
      results[ind.id] = { value: null, status: 'notApplicable' };
      continue;
    }
    const v = ind.compute(ctx);
    results[ind.id] = isNum(v) ? { value: v, status: 'ok' } : { value: null, status: 'na' };
  }
  return results;
}

// 貸借の整合チェック。必要項目が未入力なら null（判定しない）。差額 = 総資産 − 合計。
export function checkBalance(bs = {}) {
  return {
    assetsDiff: diff(bs.totalAssets, sumOf(bs.currentAssets, bs.fixedAssets)),
    liabEquityDiff: diff(bs.totalAssets, sumOf(bs.currentLiabilities, bs.fixedLiabilities, bs.netAssets)),
  };
}

export function getWarnings(period) {
  const { bs } = toCtx(period);
  const warnings = [];
  const { assetsDiff, liabEquityDiff } = checkBalance(bs);
  if (isNum(assetsDiff) && Math.abs(assetsDiff) >= BALANCE_TOLERANCE) {
    warnings.push({
      type: 'assetsMismatch',
      message: `総資産と「流動資産＋固定資産」が一致しません（差額 ${formatAmount(assetsDiff)}千円）`,
    });
  }
  if (isNum(liabEquityDiff) && Math.abs(liabEquityDiff) >= BALANCE_TOLERANCE) {
    warnings.push({
      type: 'liabEquityMismatch',
      message: `総資産と「流動負債＋固定負債＋純資産」が一致しません（差額 ${formatAmount(liabEquityDiff)}千円）`,
    });
  }
  if (isInsolvent(bs)) {
    const names = INDICATORS.filter((i) => i.insolventNA).map((i) => i.name.replace(/（.*）/, ''));
    warnings.push({
      type: 'insolvent',
      message: `債務超過です（純資産がマイナス）。${names.join('・')}は参考外としています。`,
    });
  }
  return warnings;
}

const DIGITS = { '%': 1, '日': 1, '倍': 2, '回': 2, '千円': 0 };

function formatNumber(v, digits) {
  // -0.0 のような表示を避ける
  const rounded = Number(v.toFixed(digits));
  const n = Object.is(rounded, -0) ? 0 : rounded;
  return n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatAmount(v) {
  if (!isNum(v)) return '—';
  return formatNumber(v, 0);
}

// 表示用の整形。result は calcIndicators の各要素
export function formatValue(result, unit) {
  if (!result || result.status === 'notApplicable') return result ? '参考外' : '—';
  if (result.status !== 'ok' || !isNum(result.value)) return '—';
  if (unit === '%') return `${formatNumber(result.value * 100, DIGITS['%'])}%`;
  if (unit === '千円') return `${formatNumber(result.value, 0)}千円`;
  return `${formatNumber(result.value, DIGITS[unit] ?? 2)}${unit}`;
}

// 「結果をテキストでコピー」用の本文（periodIndex の期。既定は先頭の期）
export function buildResultText(data, results, warnings = [], periodIndex = 0) {
  const period = data?.periods?.[periodIndex];
  const lines = [];
  lines.push(`【財務分析結果】${data?.companyName || '（会社名未入力）'} ${period?.label || ''}`.trim());
  lines.push('（金額単位：千円、期末残高ベース）');
  if (warnings.length) {
    lines.push('');
    lines.push('■ 警告');
    for (const w of warnings) lines.push(`・${w.message}`);
  }
  for (const cat of CATEGORIES) {
    lines.push('');
    lines.push(`■ ${cat.name}`);
    for (const ind of INDICATORS.filter((i) => i.category === cat.id)) {
      lines.push(`${ind.name}：${formatValue(results[ind.id], ind.unit)}`);
    }
  }
  return lines.join('\n');
}

// ---- 複数期比較 ----

export const MAX_PERIODS = 5;

// 比較表の先頭に載せる金額行
export const KEY_AMOUNTS = [
  { id: 'sales', name: '売上高', get: ({ pl }) => pl.sales },
  { id: 'grossProfit', name: '売上総利益', get: ({ pl }) => diff(pl.sales, pl.costOfSales) },
  { id: 'operatingIncome', name: '営業利益', get: ({ pl }) => pl.operatingIncome },
  { id: 'ordinaryIncome', name: '経常利益', get: ({ pl }) => pl.ordinaryIncome },
  { id: 'netIncome', name: '当期純利益', get: ({ pl }) => pl.netIncome },
  { id: 'totalAssets', name: '総資産', get: ({ bs }) => bs.totalAssets },
  { id: 'netAssets', name: '純資産', get: ({ bs }) => bs.netAssets },
];

// 推移グラフの対象（比較表の行 id）
export const CHART_ROWS = ['sales', 'operatingIncome', 'ebitda', 'operatingMargin', 'equityRatio'];

// 前期比。amount = 当期 − 前期。rate = (当期 − 前期) ÷ 前期。
// 前期が0 → rate は 'na'（—）、前期がマイナス → rate は 'notApplicable'（参考外）。
export function changeOf(curr, prev) {
  if (!isNum(curr) || !isNum(prev)) return { amount: null, rate: null, rateStatus: 'na' };
  const amount = curr - prev;
  if (prev === 0) return { amount, rate: null, rateStatus: 'na' };
  if (prev < 0) return { amount, rate: null, rateStatus: 'notApplicable' };
  return { amount, rate: amount / prev, rateStatus: 'ok' };
}

function signed(text, v) {
  return v > 0 && text !== '0' && !/^0[.,]?0*$/.test(text) ? `+${text}` : text;
}

// 増減額の表示。% の指標はポイント（pt）で表示する。
export function formatChangeAmount(change, unit) {
  if (!change || !isNum(change.amount)) return '—';
  const v = change.amount;
  if (unit === '%') return `${signed(formatNumber(v * 100, 1), v)}pt`;
  if (unit === '千円') return `${signed(formatNumber(v, 0), v)}千円`;
  return `${signed(formatNumber(v, DIGITS[unit] ?? 2), v)}${unit}`;
}

export function formatChangeRate(change) {
  if (!change || change.rateStatus === 'na') return '—';
  if (change.rateStatus === 'notApplicable') return '参考外';
  return `${signed(formatNumber(change.rate * 100, 1), change.rate)}%`;
}

function amountResult(v) {
  return isNum(v) ? { value: v, status: 'ok' } : { value: null, status: 'na' };
}

// 比較表のデータを作る。
// 戻り値：{ labels: [期名], rows: [{ id, name, unit, group, averageable, cells: [{ result, change }] }] }
// change は先頭の期では null。
export function buildComparison(data, basis = 'end') {
  const periods = data?.periods ?? [];
  const perPeriod = periods.map((p, i) => calcIndicators(p, { basis, prevPeriod: periods[i - 1] }));
  const makeCells = (getResult) => {
    const results = periods.map((p, i) => getResult(p, i));
    return results.map((result, i) => ({
      result,
      change: i === 0 ? null : changeOf(
        result.status === 'ok' ? result.value : null,
        results[i - 1].status === 'ok' ? results[i - 1].value : null,
      ),
    }));
  };
  const rows = [];
  for (const a of KEY_AMOUNTS) {
    rows.push({
      id: a.id, name: a.name, unit: '千円', group: 'amounts', averageable: false,
      cells: makeCells((p) => amountResult(a.get(toCtx(p)))),
    });
  }
  for (const ind of INDICATORS) {
    rows.push({
      id: ind.id, name: ind.name, unit: ind.unit, group: ind.category,
      averageable: Boolean(ind.averageable),
      cells: makeCells((p, i) => perPeriod[i][ind.id]),
    });
  }
  return { labels: periods.map((p) => p.label), rows };
}
