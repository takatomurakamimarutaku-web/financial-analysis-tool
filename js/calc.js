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

// 回転日数の年日数（設定で 360 も選べる）
export const DEFAULT_DAYS = 365;

function daysOf(ctx) {
  return ctx.days === 360 ? 360 : DEFAULT_DAYS;
}

// data.settings から年日数を取り出す
export function daysInYearOf(data) {
  return data?.settings?.analysis?.daysInYear === 360 ? 360 : DEFAULT_DAYS;
}

function receivableDays(ctx) {
  return times(safeDiv(ctx.bs.receivables, ctx.pl.sales), daysOf(ctx));
}
function inventoryDays(ctx) {
  return times(safeDiv(ctx.bs.inventory, ctx.pl.costOfSales), daysOf(ctx));
}
function payableDays(ctx) {
  return times(safeDiv(ctx.bs.payables, ctx.pl.costOfSales), daysOf(ctx));
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
    guide: '本業の稼ぐ力。マイナスは本業で赤字。業種差が大きいため、同業他社や過去との比較でも見る。',
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
    guide: '資産全体をどれだけ効率よく利益に結びつけたか。マイナスは経常赤字。',
    compute: ({ pl, bs }) => safeDiv(pl.ordinaryIncome, bs.totalAssets),
  },
  {
    id: 'roe', category: 'profitability', name: 'ROE（自己資本利益率）', unit: '%',
    averageable: true,
    formula: '当期純利益 ÷ 自己資本',
    guide: '株主の資本でどれだけ利益を上げたか。自己資本が小さいと高く出やすいため、自己資本比率と合わせて見る。',
    insolventNA: true,
    compute: ({ pl, bs }) => safeDiv(pl.netIncome, bs.netAssets),
  },
  // 安全性
  {
    id: 'currentRatio', category: 'safety', name: '流動比率', unit: '%',
    formula: '流動資産 ÷ 流動負債',
    guide: '1年以内の支払能力。高いほど短期の資金繰りに余裕があり、100%を下回ると流動負債を流動資産で返しきれない。',
    compute: ({ bs }) => safeDiv(bs.currentAssets, bs.currentLiabilities),
  },
  {
    id: 'quickRatio', category: 'safety', name: '当座比率', unit: '%',
    formula: '(現預金 + 売上債権) ÷ 流動負債',
    guide: '換金性の高い資産（現預金・売上債権）での短期支払能力。在庫を除くため流動比率より厳しい見方。',
    compute: ({ bs }) => safeDiv(sumOf(bs.cash, bs.receivables), bs.currentLiabilities),
  },
  {
    id: 'equityRatio', category: 'safety', name: '自己資本比率', unit: '%',
    formula: '自己資本 ÷ 総資産',
    guide: '返済不要の資本の割合。高いほど財務が安定する。マイナスは債務超過。',
    compute: ({ bs }) => safeDiv(bs.netAssets, bs.totalAssets),
  },
  {
    id: 'fixedRatio', category: 'safety', name: '固定比率', unit: '%',
    formula: '固定資産 ÷ 自己資本',
    guide: '固定資産を自己資本でまかなえているか。100%以下なら自己資本の範囲内で、低いほど安定。',
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
    guide: '自己資本に対する借入の大きさ。高いほど財務レバレッジが大きく、金利上昇や業績悪化の影響を受けやすい。',
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
    guide: '借入を何年分のEBITDAで返済できるか。小さいほど返済余力がある。マイナスはネットキャッシュ。EBITDAがマイナスの場合は参考外。',
    notApplicable: (ctx) => {
      const e = ebitda(ctx);
      return isNum(e) && e < 0;
    },
    compute: (ctx) => safeDiv(netDebt(ctx), ebitda(ctx)),
  },
];

function toCtx(period, days = DEFAULT_DAYS) {
  return { pl: period?.pl ?? {}, bs: period?.bs ?? {}, days };
}

// 計算式の表示用（年日数の設定を反映する）
export function formulaText(ind, days = DEFAULT_DAYS) {
  return ind.formula.replace('× 365', `× ${days}`);
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
// options.days = 回転日数の年日数（365 または 360。既定 365）
export function calcIndicators(period, options = {}) {
  const endCtx = toCtx(period, options.days === 360 ? 360 : DEFAULT_DAYS);
  const avgCtx = options.basis === 'average'
    ? { pl: endCtx.pl, bs: averageBs(endCtx.bs, options.prevPeriod?.bs), days: endCtx.days }
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

// PL の整合チェック。営業利益 −（売上高 − 売上原価 − 販管費）。いずれかが未入力なら null（判定しない）
export function checkPl(pl = {}) {
  return { operatingDiff: diff(pl.operatingIncome, diff(diff(pl.sales, pl.costOfSales), pl.sga)) };
}

// opts は formatAmount と同じ表示オプション（BS の金額の単位）。plOpts は PL の警告用（省略時は opts）
export function getWarnings(period, opts, plOpts = opts) {
  const { pl, bs } = toCtx(period);
  const unit = opts?.amountUnit ?? '千円';
  const warnings = [];
  const { assetsDiff, liabEquityDiff } = checkBalance(bs);
  if (isNum(assetsDiff) && Math.abs(assetsDiff) >= BALANCE_TOLERANCE) {
    warnings.push({
      type: 'assetsMismatch',
      message: `総資産と「流動資産＋固定資産」が一致しません（差額 ${formatAmount(assetsDiff, opts)}${unit}）`,
    });
  }
  if (isNum(liabEquityDiff) && Math.abs(liabEquityDiff) >= BALANCE_TOLERANCE) {
    warnings.push({
      type: 'liabEquityMismatch',
      message: `総資産と「流動負債＋固定負債＋純資産」が一致しません（差額 ${formatAmount(liabEquityDiff, opts)}${unit}）`,
    });
  }
  const { operatingDiff } = checkPl(pl);
  if (isNum(operatingDiff) && Math.abs(operatingDiff) >= BALANCE_TOLERANCE) {
    warnings.push({
      type: 'plMismatch',
      message: `営業利益が「売上高−売上原価−販管費」と一致しません（差額 ${formatAmount(operatingDiff, plOpts)}${plOpts?.amountUnit ?? '千円'}）`,
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

const DIGITS = { '%': 1, '日': 1, '倍': 2, '回': 2, '千円': 0, '年': 1 };

// 表示オプション（すべて省略可。省略時は千円・従来の桁数）
// opts = { amountScale: 千円からの倍率, amountUnit: '円'|'千円'|'百万円', amountDigits, digits: { '%', '日', '倍', '回' } }
function digitsFor(unit, opts) {
  const d = opts?.digits?.[unit];
  return Number.isInteger(d) ? d : (DIGITS[unit] ?? 2);
}

export function formatNumber(v, digits) {
  // -0.0 のような表示を避ける
  const rounded = Number(v.toFixed(digits));
  const n = Object.is(rounded, -0) ? 0 : rounded;
  return n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// opts.negativeStyle = 'triangle' のとき、マイナスを「△」で表示する（会計ソフトの表記）
export function negativeMark(text, opts) {
  return opts?.negativeStyle === 'triangle' ? text.replace(/^-/, '△') : text;
}

// 金額（内部は千円）を表示単位に換算して整形する
export function formatAmount(v, opts) {
  if (!isNum(v)) return '—';
  return negativeMark(formatNumber(v * (opts?.amountScale ?? 1), opts?.amountDigits ?? 0), opts);
}

// 表示用の整形。result は calcIndicators の各要素
export function formatValue(result, unit, opts) {
  if (!result || result.status === 'notApplicable') return result ? '参考外' : '—';
  if (result.status !== 'ok' || !isNum(result.value)) return '—';
  if (unit === '%') return `${negativeMark(formatNumber(result.value * 100, digitsFor('%', opts)), opts)}%`;
  if (unit === '千円') return `${formatAmount(result.value, opts)}${opts?.amountUnit ?? '千円'}`;
  return `${negativeMark(formatNumber(result.value, digitsFor(unit, opts)), opts)}${unit}`;
}

// 「結果をテキストでコピー」用の本文（periodIndex の期。既定は先頭の期）
// opts は formatValue と同じ表示オプション。opts.indicators を渡すとその順序・表示設定で出力する。
export function buildResultText(data, results, warnings = [], periodIndex = 0, opts) {
  const period = data?.periods?.[periodIndex];
  const indicators = opts?.indicators ?? INDICATORS;
  const lines = [];
  lines.push(`【財務分析結果｜数字のミカタ】${data?.companyName || '（会社名未入力）'} ${period?.label || ''}`.trim());
  lines.push(`（金額単位：${opts?.amountUnit ?? '千円'}、期末残高ベース）`);
  if (warnings.length) {
    lines.push('');
    lines.push('■ 警告');
    for (const w of warnings) lines.push(`・${w.message}`);
  }
  for (const cat of CATEGORIES) {
    lines.push('');
    lines.push(`■ ${cat.name}`);
    const list = indicators.filter((i) => i.category === cat.id);
    if (!list.length) {
      lines.pop();
      lines.pop();
      continue;
    }
    for (const ind of list) {
      lines.push(`${ind.name}：${formatValue(results[ind.id], ind.unit, opts)}`);
    }
  }
  const items = Array.isArray(period?.adjustments) ? period.adjustments : [];
  if (items.length) {
    const n = calcNormalizedEbitda(period, data?.settings?.adjustmentCategoryNames);
    const signedAmount = (v) => (v > 0 ? `+${formatAmount(v, opts)}` : formatAmount(v, opts));
    lines.push('');
    lines.push('■ 正常化EBITDA');
    lines.push(`報告EBITDA：${formatAmount(n.reported, opts)}`);
    for (const c of n.byCategory.filter((x) => x.count > 0)) lines.push(`　${c.name}：${signedAmount(c.total)}`);
    lines.push(`正常化EBITDA：${formatAmount(n.normalized, opts)}`);
    lines.push(`正常化EBITDAマージン：${formatValue({ value: n.margin, status: isNum(n.margin) ? 'ok' : 'na' }, '%', opts)}`);
    for (const w of getAdjustmentWarnings(period)) lines.push(`※${w.message}`);
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
export function formatChangeAmount(change, unit, opts) {
  if (!change || !isNum(change.amount)) return '—';
  const v = change.amount;
  if (unit === '%') return `${signed(negativeMark(formatNumber(v * 100, digitsFor('%', opts)), opts), v)}pt`;
  if (unit === '千円') return `${signed(formatAmount(v, opts), v)}${opts?.amountUnit ?? '千円'}`;
  return `${signed(negativeMark(formatNumber(v, digitsFor(unit, opts)), opts), v)}${unit}`;
}

export function formatChangeRate(change, opts) {
  if (!change || change.rateStatus === 'na') return '—';
  if (change.rateStatus === 'notApplicable') return '参考外';
  return `${signed(negativeMark(formatNumber(change.rate * 100, digitsFor('%', opts)), opts), change.rate)}%`;
}

function amountResult(v) {
  return isNum(v) ? { value: v, status: 'ok' } : { value: null, status: 'na' };
}

// 比較表に追加する正常化EBITDAの行（Phase 3）
export const NORMALIZED_ROWS = [
  { id: 'normalizedEbitda', name: '正常化EBITDA', unit: '千円', get: (r) => r.normalized },
  { id: 'normalizedEbitdaMargin', name: '正常化EBITDAマージン', unit: '%', get: (r) => r.margin },
];

// 比較表のデータを作る。
// 戻り値：{ labels: [期名], rows: [{ id, name, unit, group, averageable, cells: [{ result, change }] }] }
// change は先頭の期では null。
// 年日数は data.settings（なければ 365）、調整区分の名称も data.settings に従う。
export function buildComparison(data, basis = 'end') {
  const periods = data?.periods ?? [];
  const days = daysInYearOf(data);
  const names = data?.settings?.adjustmentCategoryNames;
  const perPeriod = periods.map((p, i) => calcIndicators(p, { basis, prevPeriod: periods[i - 1], days }));
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
  for (const r of NORMALIZED_ROWS) {
    rows.push({
      id: r.id, name: r.name, unit: r.unit, group: 'ma', averageable: false,
      cells: makeCells((p) => amountResult(r.get(calcNormalizedEbitda(p, names)))),
    });
  }
  for (const r of NET_DEBT_ROWS) {
    rows.push({
      id: r.id, name: r.name, unit: r.unit, group: 'ma', averageable: false,
      cells: makeCells((p) => r.get(p, names)),
    });
  }
  return { labels: periods.map((p) => p.label), rows };
}

// ---- 正常化EBITDA（Phase 3） ----

export const ADJUSTMENT_CATEGORIES = [
  { id: 'executiveComp', name: '役員報酬の調整' },
  { id: 'oneTime', name: '一過性の損益' },
  { id: 'relatedParty', name: '関連当事者取引' },
  { id: 'accountingPolicy', name: '会計方針の差異' },
  { id: 'businessChange', name: '事業の撤退・新設' },
  { id: 'other', name: 'その他' },
];

const CATEGORY_IDS = new Set(ADJUSTMENT_CATEGORIES.map((c) => c.id));

// names = 設定で変更した区分名 { [id]: 名称 }（省略可）
export function categoryName(id, names) {
  const c = ADJUSTMENT_CATEGORIES.find((x) => x.id === id) ?? ADJUSTMENT_CATEGORIES.find((x) => x.id === 'other');
  return (typeof names?.[c.id] === 'string' && names[c.id].trim()) || c.name;
}

// 正常化EBITDA = 報告EBITDA + 調整額合計（プラス=加算、マイナス=減算）
// 金額が未入力の調整項目は合計に含めない（警告の対象）。
// 戻り値：{ reported, adjustmentTotal, normalized, margin, byCategory: [{ id, name, total, count }] }
export function calcNormalizedEbitda(period, names) {
  const ctx = toCtx(period);
  const reported = ebitda(ctx);
  const items = Array.isArray(period?.adjustments) ? period.adjustments : [];
  const byCategory = ADJUSTMENT_CATEGORIES.map((c) => ({ id: c.id, name: categoryName(c.id, names), total: 0, count: 0 }));
  let adjustmentTotal = 0;
  for (const item of items) {
    const cat = byCategory.find((c) => c.id === (CATEGORY_IDS.has(item?.category) ? item.category : 'other'));
    cat.count += 1;
    if (isNum(item?.amount)) {
      cat.total += item.amount;
      adjustmentTotal += item.amount;
    }
  }
  const normalized = isNum(reported) ? reported + adjustmentTotal : null;
  return {
    reported,
    adjustmentTotal,
    normalized,
    margin: safeDiv(normalized, ctx.pl.sales),
    byCategory,
  };
}

// 調整項目の警告。根拠メモが空 →「根拠未記載」、金額が未入力 →「金額未入力」
export function getAdjustmentWarnings(period) {
  const items = Array.isArray(period?.adjustments) ? period.adjustments : [];
  const warnings = [];
  items.forEach((item, index) => {
    const label = item?.description ? `「${item.description}」` : `${index + 1}件目`;
    if (!String(item?.memo ?? '').trim()) {
      warnings.push({ type: 'memoMissing', index, message: `調整項目${label}：根拠未記載` });
    }
    if (!isNum(item?.amount)) {
      warnings.push({ type: 'amountMissing', index, message: `調整項目${label}：金額未入力（合計に含めていません）` });
    }
  });
  return warnings;
}

// EBITDAブリッジ表（行 = 報告EBITDA → 区分ごとの調整 → 調整額合計 → 正常化EBITDA → マージン、列 = 各期）
// 区分の行は、いずれかの期に調整項目がある区分だけを表示する。
export function buildEbitdaBridge(data) {
  const periods = data?.periods ?? [];
  const names = data?.settings?.adjustmentCategoryNames;
  const calcs = periods.map((p) => calcNormalizedEbitda(p, names));
  const used = ADJUSTMENT_CATEGORIES.filter((c) => calcs.some((r) => r.byCategory.find((x) => x.id === c.id).count > 0));
  const rows = [
    { id: 'reported', name: '報告EBITDA', unit: '千円', kind: 'base', values: calcs.map((r) => r.reported) },
    ...used.map((c) => ({
      id: `cat:${c.id}`, name: categoryName(c.id, names), unit: '千円', kind: 'adjustment',
      values: calcs.map((r) => r.byCategory.find((x) => x.id === c.id).total),
    })),
    { id: 'adjustmentTotal', name: '調整額合計', unit: '千円', kind: 'subtotal', values: calcs.map((r) => r.adjustmentTotal) },
    { id: 'normalized', name: '正常化EBITDA', unit: '千円', kind: 'total', values: calcs.map((r) => r.normalized) },
    { id: 'margin', name: '正常化EBITDAマージン', unit: '%', kind: 'ratio', values: calcs.map((r) => r.margin) },
  ];
  return { labels: periods.map((p) => p.label), rows };
}

// ---- 運転資本・ネットデット（Phase 4） ----

export const DEBT_LIKE_EXAMPLES = ['退職給付引当金', '未払法人税等', 'リース債務', '未払配当', '役員退職慰労引当金'];
export const CASH_LIKE_EXAMPLES = ['定期預金', '換金性の高い有価証券', '保険積立金'];

// 運転資本（トレード）= 売上債権 + 棚卸資産 − 仕入債務
export function calcWorkingCapital(period) {
  const { pl, bs } = toCtx(period);
  const amount = diff(sumOf(bs.receivables, bs.inventory), bs.payables);
  return { amount, ratio: safeDiv(amount, pl.sales) };
}

// 全期の運転資本の推移と平均
// average = 運転資本が計算できた期の単純平均。averageRatio = 平均運転資本 ÷ 同じ期の平均売上高
export function calcWorkingCapitalSeries(data) {
  const periods = data?.periods ?? [];
  const items = periods.map(calcWorkingCapital);
  const usable = periods.map((p, i) => ({ wc: items[i].amount, sales: toCtx(p).pl.sales })).filter((x) => isNum(x.wc));
  const average = usable.length ? usable.reduce((s, x) => s + x.wc, 0) / usable.length : null;
  const salesOk = usable.length > 0 && usable.every((x) => isNum(x.sales));
  const avgSales = salesOk ? usable.reduce((s, x) => s + x.sales, 0) / usable.length : null;
  return {
    labels: periods.map((p) => p.label),
    items,
    average,
    averageRatio: safeDiv(average, avgSales),
    periodsUsed: usable.length,
  };
}

function itemTotal(list) {
  const items = Array.isArray(list) ? list : [];
  return items.reduce((s, x) => s + (isNum(x?.amount) ? x.amount : 0), 0);
}

// 調整後ネットデット = 有利子負債 + デットライク項目 − 現預金 − キャッシュライク項目
// 金額が未入力の項目は合計に含めない（警告の対象）。
export function calcAdjustedNetDebt(period, names) {
  const ctx = toCtx(period);
  const debtLikeTotal = itemTotal(period?.debtLikeItems);
  const cashLikeTotal = itemTotal(period?.cashLikeItems);
  const base = netDebt(ctx);
  const adjusted = isNum(base) ? base + debtLikeTotal - cashLikeTotal : null;
  const normalized = calcNormalizedEbitda(period, names).normalized;
  let multiple;
  if (isNum(normalized) && normalized < 0) multiple = { value: null, status: 'notApplicable' };
  else {
    const v = safeDiv(adjusted, normalized);
    multiple = isNum(v) ? { value: v, status: 'ok' } : { value: null, status: 'na' };
  }
  return {
    interestBearingDebt: isNum(ctx.bs.interestBearingDebt) ? ctx.bs.interestBearingDebt : null,
    cash: isNum(ctx.bs.cash) ? ctx.bs.cash : null,
    debtLikeTotal,
    cashLikeTotal,
    netDebt: base,
    adjusted,
    normalizedEbitda: normalized,
    multiple,
  };
}

// デットライク・キャッシュライク項目の警告
export function getNetDebtItemWarnings(period) {
  const warnings = [];
  for (const [key, kind] of [['debtLikeItems', 'デットライク'], ['cashLikeItems', 'キャッシュライク']]) {
    const items = Array.isArray(period?.[key]) ? period[key] : [];
    items.forEach((item, index) => {
      const label = item?.name ? `「${item.name}」` : `${index + 1}件目`;
      if (!String(item?.memo ?? '').trim()) {
        warnings.push({ type: 'memoMissing', list: key, index, message: `${kind}項目${label}：根拠未記載` });
      }
      if (!isNum(item?.amount)) {
        warnings.push({ type: 'amountMissing', list: key, index, message: `${kind}項目${label}：金額未入力（合計に含めていません）` });
      }
    });
  }
  return warnings;
}

// ネットデット内訳（行 = 有利子負債・各デットライク項目・現預金・各キャッシュライク項目・調整後ネットデット等、列 = 各期）
// 項目は名称ごとに全期をそろえる。現預金・キャッシュライク項目は減算として負の値で持つ。
export function buildNetDebtBreakdown(data) {
  const periods = data?.periods ?? [];
  const names = (key) => {
    const seen = [];
    for (const p of periods) {
      for (const it of (Array.isArray(p[key]) ? p[key] : [])) {
        const n = String(it?.name ?? '').trim() || '（名称未入力）';
        if (!seen.includes(n)) seen.push(n);
      }
    }
    return seen;
  };
  const sumByName = (p, key, name, sign) => {
    const items = (Array.isArray(p[key]) ? p[key] : [])
      .filter((it) => (String(it?.name ?? '').trim() || '（名称未入力）') === name);
    if (!items.length) return null;
    return sign * items.reduce((s, it) => s + (isNum(it.amount) ? it.amount : 0), 0);
  };
  const calcs = periods.map(calcAdjustedNetDebt);
  const rows = [
    { id: 'interestBearingDebt', name: '有利子負債', kind: 'base', values: calcs.map((c) => c.interestBearingDebt) },
    ...names('debtLikeItems').map((n) => ({
      id: `debt:${n}`, name: `${n}（加算）`, kind: 'debtLike', values: periods.map((p) => sumByName(p, 'debtLikeItems', n, 1)),
    })),
    { id: 'cash', name: '現預金（減算）', kind: 'cash', values: calcs.map((c) => (isNum(c.cash) ? -c.cash : null)) },
    ...names('cashLikeItems').map((n) => ({
      id: `cashLike:${n}`, name: `${n}（減算）`, kind: 'cashLike', values: periods.map((p) => sumByName(p, 'cashLikeItems', n, -1)),
    })),
    { id: 'netDebt', name: '（参考）ネットデット', kind: 'reference', values: calcs.map((c) => c.netDebt) },
    { id: 'adjustedNetDebt', name: '調整後ネットデット', kind: 'total', values: calcs.map((c) => c.adjusted) },
    { id: 'normalizedEbitda', name: '正常化EBITDA', kind: 'reference', values: calcs.map((c) => c.normalizedEbitda) },
  ];
  return { labels: periods.map((p) => p.label), rows, multiples: calcs.map((c) => c.multiple) };
}

// 比較表に追加する運転資本・ネットデットの行（Phase 4）
export const NET_DEBT_ROWS = [
  { id: 'workingCapital', name: '運転資本（トレード）', unit: '千円', get: (p) => amountResult(calcWorkingCapital(p).amount) },
  { id: 'workingCapitalRatio', name: '運転資本 ÷ 売上高', unit: '%', get: (p) => amountResult(calcWorkingCapital(p).ratio) },
  { id: 'adjustedNetDebt', name: '調整後ネットデット', unit: '千円', get: (p) => amountResult(calcAdjustedNetDebt(p).adjusted) },
  { id: 'adjustedNetDebtToNormalizedEbitda', name: '調整後ネットデット ÷ 正常化EBITDA', unit: '倍', get: (p) => calcAdjustedNetDebt(p).multiple },
];
