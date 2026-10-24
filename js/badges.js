// 評価バッジ（良好・注意）。DOMに依存しない純粋関数。
// 基準セット：標準 / 古田土会計 / 日本政策金融公庫（業種別）/ TKC（利用者が入力した値）。
// しきい値は指標の表示単位（%・倍・回）で持つ。判定は丸める前の値で行い、境界値は良好側に含める。
import {
  isNum, isInsolvent, calcAdjustedNetDebt, calcNormalizedEbitda,
} from './calc.js';

// バッジの対象。dir = 'high'（高いほど良い）| 'low'（低いほど良い）
export const BADGE_TARGETS = [
  { id: 'grossMargin', name: '売上総利益率', unit: '%', dir: 'high' },
  { id: 'operatingMargin', name: '営業利益率', unit: '%', dir: 'high' },
  { id: 'ordinaryMargin', name: '経常利益率', unit: '%', dir: 'high' },
  { id: 'roa', name: 'ROA', unit: '%', dir: 'high' },
  { id: 'roe', name: 'ROE', unit: '%', dir: 'high' },
  { id: 'currentRatio', name: '流動比率', unit: '%', dir: 'high' },
  { id: 'quickRatio', name: '当座比率', unit: '%', dir: 'high' },
  { id: 'equityRatio', name: '自己資本比率', unit: '%', dir: 'high' },
  { id: 'fixedRatio', name: '固定比率', unit: '%', dir: 'low' },
  { id: 'fixedLongTermRatio', name: '固定長期適合率', unit: '%', dir: 'low' },
  { id: 'deRatio', name: 'D/Eレシオ', unit: '倍', dir: 'low' },
  { id: 'icr', name: 'インタレスト・カバレッジ・レシオ', unit: '倍', dir: 'high' },
  { id: 'assetTurnover', name: '総資産回転率', unit: '回', dir: 'high' },
  { id: 'netDebtToEbitda', name: 'ネットデット ÷ EBITDA', unit: '倍', dir: 'low' },
  { id: 'adjustedNetDebtToNormalizedEbitda', name: '調整後ネットデット ÷ 正常化EBITDA', unit: '倍', dir: 'low' },
  { id: 'normalizedEbitdaMargin', name: '正常化EBITDAマージン', unit: '%', dir: 'high' },
];
const TARGET = Object.fromEntries(BADGE_TARGETS.map((t) => [t.id, t]));

// TKC で利用者が値を入力できる指標（M&A 指標を除く）
export const TKC_TARGETS = BADGE_TARGETS.filter((t) => !['netDebtToEbitda', 'adjustedNetDebtToNormalizedEbitda', 'normalizedEbitdaMargin'].includes(t.id)).map((t) => t.id);

// 標準：一般的な中小企業分析の目安。good / caution が null の側は判定しない
const STANDARD = {
  grossMargin: { good: null, caution: 0 },
  operatingMargin: { good: 5, caution: 0 },
  ordinaryMargin: { good: 5, caution: 0 },
  roa: { good: 5, caution: 0 },
  roe: { good: 8, caution: 0 },
  currentRatio: { good: 150, caution: 100 },
  quickRatio: { good: 100, caution: 70 },
  equityRatio: { good: 30, caution: 10 },
  fixedRatio: { good: 100, caution: 200 },
  fixedLongTermRatio: { good: 80, caution: 100 },
  deRatio: { good: 1, caution: 2 },
  icr: { good: 3, caution: 1 },
  assetTurnover: { good: null, caution: null },
  netDebtToEbitda: { good: 3, caution: 5 },
  adjustedNetDebtToNormalizedEbitda: { good: 3, caution: 5 },
  normalizedEbitdaMargin: { good: null, caution: 0 },
};

// 古田土会計の目安（ここにない指標・境界は標準を使う）
const FURUTADO = {
  equityRatio: { good: 60, caution: 30 },
  roa: { good: 10, caution: 5 },
  currentRatio: { good: 200, caution: 100 },
  quickRatio: { good: 100 },
  assetTurnover: { good: 2.5, caution: 1.5 },
};

// 日本政策金融公庫「小企業の経営指標調査」業種別経営指標（業種全体の表）。
// avg = 黒字かつ自己資本プラス企業平均値、median = 中央値。良好 = avg 以上、注意 = median 未満。
// 建設業の売上総利益率は「完成工事高総利益率」。
const JFC_SOURCE = '日本政策金融公庫「小企業の経営指標調査」業種別経営指標';
const jfc = (gm, om, ordm, roa, at, cr, qr, flt, er) => ({
  grossMargin: gm, operatingMargin: om, ordinaryMargin: ordm, roa, assetTurnover: at,
  currentRatio: cr, quickRatio: qr, fixedLongTermRatio: flt, equityRatio: er,
});
export const JFC_INDUSTRIES = [
  {
    id: 'construction', name: '建設業', year: '2024年度', published: '2025-08', count: 6838, goodCount: 2873,
    file: 'sme_findings2_03b.pdf',
    note: '売上総利益率は「完成工事高総利益率」の値です。',
    values: jfc([39.3, 34.2], [4.4, 0.2], [4.8, 0.5], [10.3, 1.0], [2.3, 2.1], [340.8, 187.9], [247.8, 138.3], [50.5, 45.4], [27.0, 2.9]),
  },
  {
    id: 'manufacturing', name: '製造業', year: '2024年度', published: '2025-08', count: 2042, goodCount: 624,
    file: 'sme_findings2_04b.pdf',
    values: jfc([44.1, 38.5], [4.9, -1.0], [5.7, 0.2], [8.5, 0.3], [1.5, 1.3], [442.5, 193.2], [278.7, 124.7], [53.2, 60.7], [24.5, -3.8]),
  },
  {
    id: 'infoComm', name: '情報通信業', year: '2025年度', published: '2026-08', count: 1327, goodCount: 665,
    file: 'sme_findings2_05b.pdf',
    values: jfc([73.8, 83.6], [7.1, 0.7], [7.7, 1.0], [15.9, 2.2], [2.4, 2.2], [339.1, 210.7], [279.6, 176.8], [36.5, 25.5], [33.9, 15.0]),
  },
  {
    id: 'transport', name: '運輸業', year: '2025年度', published: '2026-08', count: 1124, goodCount: 375,
    file: 'sme_findings2_06b.pdf',
    values: jfc([54.9, 41.1], [3.9, 0.0], [4.0, 0.4], [9.4, 0.9], [2.4, 2.1], [291.9, 159.1], [242.4, 136.1], [58.3, 63.9], [22.1, -6.0]),
  },
  {
    id: 'wholesaleRetail', name: '卸売・小売業', year: '2025年度', published: '2026-08', count: 3584, goodCount: 1503,
    file: 'sme_findings2_07b.pdf',
    values: jfc([31.9, 31.0], [3.4, 0.3], [3.5, 0.4], [8.6, 0.9], [3.0, 2.3], [565.4, 188.8], [294.7, 105.0], [45.8, 43.9], [24.0, 2.8]),
  },
  {
    id: 'foodLodging', name: '飲食店・宿泊業', year: '2025年度', published: '2026-08', count: 850, goodCount: 322,
    file: 'sme_findings2_08b.pdf',
    values: jfc([71.6, 68.0], [4.7, -0.1], [5.3, 0.6], [11.6, 1.3], [2.5, 2.3], [279.8, 136.3], [192.6, 88.0], [94.1, 82.7], [29.6, -0.2]),
  },
  {
    id: 'medical', name: '医療・福祉', year: '2025年度', published: '2026-08', count: 1858, goodCount: 744,
    file: 'sme_findings2_09b.pdf',
    values: jfc([94.6, 99.1], [6.4, 0.3], [7.3, 1.3], [13.5, 2.2], [1.9, 1.9], [488.3, 257.2], [391.0, 193.6], [51.2, 55.5], [27.6, 2.2]),
  },
  {
    id: 'education', name: '教育・学習支援業', year: '2025年度', published: '2026-08', count: 380, goodCount: 128,
    file: 'sme_findings2_10b.pdf',
    values: jfc([92.1, 97.7], [6.4, 0.3], [6.5, 0.6], [13.5, 1.5], [2.2, 2.3], [301.3, 146.9], [233.3, 108.0], [69.4, 72.9], [29.8, -9.1]),
  },
  {
    id: 'services', name: 'サービス業', year: '2025年度', published: '2026-08', count: 4587, goodCount: 2134,
    file: 'sme_findings2_11b.pdf',
    values: jfc([75.7, 84.3], [7.1, 0.6], [7.7, 1.1], [14.0, 2.0], [2.1, 1.9], [342.4, 190.6], [266.5, 143.9], [52.7, 51.5], [31.7, 8.4]),
  },
];

// 公庫データの確認日（公庫ウェブサイトで最新の調査かを確かめた日）。年次更新の手順は README「公庫データの年次更新」
export const JFC_DATA_CHECKED_AT = '2026-10-24';

export function jfcSurveyLabel(ind) {
  return `${ind.year}調査`;
}

function publishedLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${y}年${m}月公表`;
}

// 「建設業・製造業は2024年度調査（2025年8月公表）、ほかの業種は2025年度調査（2026年8月公表）」のような説明
export function jfcYearsSummary(list = JFC_INDUSTRIES) {
  const groups = new Map();
  for (const x of list) {
    const k = `${x.year}|${x.published}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x.name);
  }
  const parts = [...groups.entries()].map(([k, names]) => {
    const [year, published] = k.split('|');
    return { names, text: `${year}調査（${publishedLabel(published)}）` };
  });
  if (parts.length === 1) return `すべての業種が${parts[0].text}です`;
  // いちばん多い組を「ほかの業種」にまとめる
  const most = parts.reduce((a, b) => (b.names.length > a.names.length ? b : a));
  const others = parts.filter((p) => p !== most).map((p) => `${p.names.join('・')}は${p.text}`);
  return `${others.join('、')}、ほかの業種は${most.text}です`;
}

// 最新の公表から1年以上たち、次の調査が公表されている可能性があるか（毎年8月ごろの公表を想定し、翌年10月以降で true）
export function jfcUpdateDue(now = new Date(), list = JFC_INDUSTRIES) {
  const latest = list.map((x) => x.published).sort().at(-1);
  const [y] = latest.split('-').map(Number);
  return now.getTime() >= new Date(y + 1, 9, 1).getTime();
}

export const CRITERIA = [
  {
    id: 'standard', name: '標準',
    summary: '中小企業の分析で一般的に使われる目安。業種を問わず同じ基準で見ます。',
    source: '一般的な財務分析の目安（本アプリの設定値）',
  },
  {
    id: 'furutado', name: '古田土会計',
    summary: '自己資本比率60%以上など、無借金経営を目指す厳しめの目安。',
    source: '古田土会計の経営指標の目安（書籍・公開資料で示されている水準）。一部の指標のみで、それ以外は標準を使います。',
  },
  {
    id: 'jfc', name: '日本政策金融公庫',
    summary: '小企業の業種別平均と比べます。黒字かつ自己資本プラス企業の平均以上で良好、中央値未満で注意。',
    source: `${JFC_SOURCE}（業種全体の表）`,
  },
  {
    id: 'tkc', name: 'TKC（自分で入力）',
    summary: 'TKC経営指標（BAST）の数値を自分で入力して比べます。優良企業平均以上で良好、黒字企業平均未満で注意。',
    source: 'TKC経営指標（BAST）。数値は利用者が入力したもので、アプリには含まれていません。',
    notice: 'BASTを閲覧できる方が自分で入力する前提です。転記は所属先とTKCの利用条件の範囲で行ってください。',
  },
];
const CRITERION_IDS = CRITERIA.map((c) => c.id);
const SOURCE_NAMES = { standard: '標準', furutado: '古田土会計', jfc: '公庫', tkc: 'TKC', custom: '変更した値' };

export function createDefaultEvaluation() {
  return {
    enabled: true,
    criterion: 'standard',
    jfcIndustry: 'manufacturing',
    disabled: [],
    overrides: {},
    tkc: { industry: '', values: {} },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v) {
  return isNum(v) ? v : null;
}

// { [id]: { good, caution } } の形に整える（対象外の id・数値以外は捨てる。未設定の側は null）
function normalizeBounds(raw, ids) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!ids.includes(id) || !isPlainObject(v)) continue;
    const b = { good: num(v.good), caution: num(v.caution) };
    out[id] = b;
  }
  return out;
}

const ALL_IDS = BADGE_TARGETS.map((t) => t.id);

export function normalizeEvaluation(raw) {
  const d = createDefaultEvaluation();
  if (!isPlainObject(raw)) return d;
  const overrides = {};
  if (isPlainObject(raw.overrides)) {
    for (const c of ['standard', 'furutado', 'jfc']) {
      const o = normalizeBounds(raw.overrides[c], ALL_IDS);
      if (Object.keys(o).length) overrides[c] = o;
    }
  }
  const tkc = isPlainObject(raw.tkc) ? raw.tkc : {};
  const tkcValues = normalizeBounds(tkc.values, TKC_TARGETS);
  for (const [id, b] of Object.entries(tkcValues)) if (b.good === null && b.caution === null) delete tkcValues[id];
  return {
    enabled: raw.enabled !== false,
    criterion: CRITERION_IDS.includes(raw.criterion) ? raw.criterion : d.criterion,
    jfcIndustry: JFC_INDUSTRIES.some((x) => x.id === raw.jfcIndustry) ? raw.jfcIndustry : d.jfcIndustry,
    disabled: Array.isArray(raw.disabled) ? [...new Set(raw.disabled.filter((id) => ALL_IDS.includes(id)))] : [],
    overrides,
    tkc: { industry: typeof tkc.industry === 'string' ? tkc.industry.slice(0, 40) : '', values: tkcValues },
  };
}

export function jfcIndustryOf(evaluation) {
  return JFC_INDUSTRIES.find((x) => x.id === evaluation?.jfcIndustry) ?? JFC_INDUSTRIES[1];
}

// 良好の境界が注意の境界より甘い（平均が中央値より悪い）ときは、中央値を良好の境界にも使う
function fromAverages(dir, good, caution) {
  if (!isNum(good) || !isNum(caution)) return { good, caution };
  if (dir === 'high' && good < caution) return { good: caution, caution };
  if (dir === 'low' && good > caution) return { good: caution, caution };
  return { good, caution };
}

// 基準セットの元の値（利用者の変更を反映する前）
function baseRule(id, evaluation) {
  const t = TARGET[id];
  const std = { ...STANDARD[id], source: 'standard' };
  const c = evaluation?.criterion;
  if (c === 'furutado' && FURUTADO[id]) {
    const f = FURUTADO[id];
    return {
      good: 'good' in f ? f.good : std.good,
      caution: 'caution' in f ? f.caution : std.caution,
      source: 'furutado',
      inherited: { good: !('good' in f), caution: !('caution' in f) },
    };
  }
  if (c === 'jfc') {
    const ind = jfcIndustryOf(evaluation);
    const v = ind.values[id];
    if (v) {
      const [avg, median] = v;
      return { ...fromAverages(t.dir, avg, median), source: 'jfc', ref: { avg, median } };
    }
  }
  if (c === 'tkc') {
    const v = evaluation?.tkc?.values?.[id];
    if (v && (isNum(v.good) || isNum(v.caution))) {
      return { ...fromAverages(t.dir, num(v.good), num(v.caution)), source: 'tkc', ref: { good: num(v.good), caution: num(v.caution) } };
    }
    if (TKC_TARGETS.includes(id)) return { ...std, missing: true };
  }
  return std;
}

// 指標 id の判定ルール。{ id, dir, unit, good, caution, source, modified, ... }。対象外の id は null
export function ruleFor(id, evaluation) {
  const t = TARGET[id];
  if (!t) return null;
  const base = baseRule(id, evaluation);
  const o = evaluation?.criterion !== 'tkc' ? evaluation?.overrides?.[evaluation?.criterion]?.[id] : null;
  const rule = { id, dir: t.dir, unit: t.unit, name: t.name, ...base, modified: false };
  if (o) {
    rule.good = o.good;
    rule.caution = o.caution;
    rule.modified = true;
  }
  return rule;
}

export function isModified(evaluation) {
  const c = evaluation?.criterion;
  return c !== 'tkc' && Object.keys(evaluation?.overrides?.[c] ?? {}).length > 0;
}

// 「評価基準：公庫・製造業（2024年度調査）」のような現在の基準名
export function criterionLabel(evaluation) {
  const c = CRITERIA.find((x) => x.id === evaluation?.criterion) ?? CRITERIA[0];
  let label = c.name;
  if (c.id === 'jfc') {
    const ind = jfcIndustryOf(evaluation);
    label = `公庫・${ind.name}（${jfcSurveyLabel(ind)}）`;
  } else if (c.id === 'tkc') {
    const name = evaluation?.tkc?.industry?.trim();
    label = `TKC・${name || '業種未入力'}（自分で入力）`;
  }
  return isModified(evaluation) ? `${label}（一部変更）` : label;
}

const EPS = 1e-9;

// 表示単位の値 v をルールで判定する。'good' | 'caution' | null（標準＝バッジなし）
export function judge(rule, v) {
  if (!rule || !isNum(v)) return null;
  if (rule.dir === 'high') {
    if (isNum(rule.good) && v >= rule.good - EPS) return 'good';
    if (isNum(rule.caution) && v < rule.caution - EPS) return 'caution';
  } else {
    if (isNum(rule.good) && v <= rule.good + EPS) return 'good';
    if (isNum(rule.caution) && v > rule.caution + EPS) return 'caution';
  }
  return null;
}

function toDisplay(unit, value) {
  return unit === '%' ? value * 100 : value;
}

function labelOf(level, rule) {
  if (!rule.modified && rule.source === 'jfc') return level === 'good' ? '同業上位' : '同業中央値未満';
  if (!rule.modified && rule.source === 'tkc') return level === 'good' ? '優良水準' : '黒字平均未満';
  return level === 'good' ? '良好' : '注意';
}

function make(level, rule, note = '') {
  const label = labelOf(level, rule);
  return { level, label, note, text: note ? `${label}（${note}）` : label, source: rule.source };
}

// 1つの指標のバッジ。result = { value, status }（calcIndicators・比較表のセル）、period = その期の入力。
// 戻り値：{ level: 'good'|'caution', label, note, text, source } または null（バッジなし）
export function badgeFor(id, result, period, evaluation) {
  if (!evaluation || evaluation.enabled === false) return null;
  if (evaluation.disabled?.includes(id)) return null;
  const rule = ruleFor(id, evaluation);
  if (!rule || !result) return null;
  const pl = period?.pl ?? {};
  const bs = period?.bs ?? {};

  if (id === 'equityRatio' && result.status === 'ok' && result.value < 0) return make('caution', rule, '債務超過');
  if (id === 'icr' && result.status !== 'ok' && pl.interestExpense === 0 && isNum(pl.operatingIncome)) {
    if (pl.operatingIncome > 0) return make('good', rule, '利息負担なし');
    if (pl.operatingIncome < 0) return make('caution', rule, '営業赤字');
    return null;
  }
  if (id === 'netDebtToEbitda' || id === 'adjustedNetDebtToNormalizedEbitda') {
    let debt;
    let earnings;
    if (id === 'netDebtToEbitda') {
      debt = isNum(bs.interestBearingDebt) && isNum(bs.cash) ? bs.interestBearingDebt - bs.cash : null;
      earnings = isNum(pl.operatingIncome) && isNum(pl.depreciation) ? pl.operatingIncome + pl.depreciation : null;
    } else {
      const nd = calcAdjustedNetDebt(period);
      debt = nd.adjusted;
      earnings = calcNormalizedEbitda(period).normalized;
    }
    if (isNum(debt) && debt <= 0) return make('good', rule, '実質無借金');
    if (isNum(debt) && debt > 0 && isNum(earnings) && earnings < 0) return make('caution', rule, 'EBITDA赤字');
  }
  if (result.status !== 'ok' || !isNum(result.value)) return null;

  const level = judge(rule, toDisplay(rule.unit, result.value));
  if (!level) return null;
  // ROE：自己資本が薄いと高く出るため、自己資本比率が注意のときは良好にしない
  if (id === 'roe' && level === 'good') {
    const er = isNum(bs.netAssets) && isNum(bs.totalAssets) && bs.totalAssets !== 0 && !isInsolvent(bs)
      ? { value: bs.netAssets / bs.totalAssets, status: 'ok' } : null;
    const erRule = ruleFor('equityRatio', evaluation);
    if (er && judge(erRule, er.value * 100) === 'caution') return null;
  }
  return make(level, rule);
}

// 1期分のバッジ { [id]: badge }。results は calcIndicators の戻り値（追加の行の結果も入れてよい）
export function badgesFor(results, period, evaluation) {
  const out = {};
  for (const t of BADGE_TARGETS) {
    const b = badgeFor(t.id, results?.[t.id], period, evaluation);
    if (b) out[t.id] = b;
  }
  return out;
}

function fmtBound(v, unit) {
  const digits = unit === '%' ? 1 : unit === '回' ? 1 : 1;
  const s = Number(v.toFixed(digits)).toLocaleString('ja-JP', { maximumFractionDigits: digits });
  return `${s}${unit}`;
}

// 境界の説明。例：「良好 60%以上 ／ 注意 30%未満」。どちらも null なら「この基準では評価しません」
export function boundsText(rule) {
  if (!rule) return '';
  const parts = [];
  const hi = rule.dir === 'high';
  if (isNum(rule.good)) parts.push(`良好 ${fmtBound(rule.good, rule.unit)}${hi ? '以上' : '以下'}`);
  if (isNum(rule.caution)) parts.push(`注意 ${fmtBound(rule.caution, rule.unit)}${hi ? '未満' : '超'}`);
  return parts.length ? parts.join(' ／ ') : 'この基準では評価しません';
}

const SPECIAL_NOTES = {
  equityRatio: 'マイナス（債務超過）は注意。',
  roe: '自己資本比率が注意のときは良好にしません。債務超過のときは参考外。',
  icr: '支払利息が0で営業黒字なら良好（利息負担なし）、営業赤字なら注意。',
  deRatio: '有利子負債が0なら良好。',
  netDebtToEbitda: 'ネットキャッシュ（現預金が借入以上）は良好（実質無借金）。借入があってEBITDAが赤字なら注意。',
  adjustedNetDebtToNormalizedEbitda: '調整後ネットデットが0以下は良好（実質無借金）。借入があって正常化EBITDAが赤字なら注意。',
};

// 指標詳細の「評価の目安」。{ text, source, ref, notes: [] }。対象外の指標は null
export function guideFor(id, evaluation) {
  const rule = ruleFor(id, evaluation);
  if (!rule) return null;
  const notes = [];
  let source = SOURCE_NAMES[rule.source];
  if (rule.modified) source = `${SOURCE_NAMES[evaluation.criterion]}の値を変更`;
  else if (rule.source === 'jfc') {
    const ind = jfcIndustryOf(evaluation);
    source = `公庫・${ind.name}（${jfcSurveyLabel(ind)}）`;
    notes.push(`黒字かつ自己資本プラス企業平均 ${fmtBound(rule.ref.avg, rule.unit)} ／ 中央値 ${fmtBound(rule.ref.median, rule.unit)}`);
    if (rule.ref.avg !== rule.good) notes.push('この業種は平均より中央値の方が良いため、中央値を良好の境界にしています。');
    if (id === 'grossMargin' && ind.note) notes.push(ind.note);
  } else if (rule.source === 'tkc') {
    source = criterionLabel({ ...evaluation, overrides: {} });
    notes.push(`入力値：優良企業平均 ${isNum(rule.ref.good) ? fmtBound(rule.ref.good, rule.unit) : '未入力'} ／ 黒字企業平均 ${isNum(rule.ref.caution) ? fmtBound(rule.ref.caution, rule.unit) : '未入力'}`);
  } else if (rule.source === 'furutado' && (rule.inherited?.good || rule.inherited?.caution)) {
    notes.push(`${rule.inherited.good ? '良好' : '注意'}の境界は標準の値です。`);
  } else if (evaluation?.criterion === 'jfc' && rule.source === 'standard') {
    notes.push('公庫の調査にない指標のため、標準の基準で評価しています。');
  } else if (evaluation?.criterion === 'tkc' && rule.missing) {
    notes.push('TKCの値が未入力のため、標準の基準で評価しています。');
  }
  if (SPECIAL_NOTES[id]) notes.push(SPECIAL_NOTES[id]);
  if (evaluation?.disabled?.includes(id)) notes.push('この指標のバッジは設定でオフになっています。');
  return { text: boundsText(rule), source, notes, rule };
}

// 設定の更新（いずれも新しい evaluation を返す）
export function setCriterion(evaluation, criterion) {
  return CRITERION_IDS.includes(criterion) ? { ...evaluation, criterion } : evaluation;
}

export function setOverride(evaluation, id, bounds) {
  const c = evaluation.criterion;
  if (c === 'tkc' || !TARGET[id]) return evaluation;
  const forC = { ...(evaluation.overrides?.[c] ?? {}) };
  if (bounds === null) delete forC[id];
  else forC[id] = { good: num(bounds.good), caution: num(bounds.caution) };
  const overrides = { ...evaluation.overrides, [c]: forC };
  if (!Object.keys(forC).length) delete overrides[c];
  return { ...evaluation, overrides };
}

export function resetOverrides(evaluation) {
  const overrides = { ...evaluation.overrides };
  delete overrides[evaluation.criterion];
  return { ...evaluation, overrides };
}

export function setTkcValue(evaluation, id, bounds) {
  if (!TKC_TARGETS.includes(id)) return evaluation;
  const values = { ...evaluation.tkc.values };
  const b = { good: num(bounds?.good), caution: num(bounds?.caution) };
  if (b.good === null && b.caution === null) delete values[id];
  else values[id] = b;
  return { ...evaluation, tkc: { ...evaluation.tkc, values } };
}

export function setBadgeDisabled(evaluation, id, disabled) {
  const set = new Set(evaluation.disabled);
  if (disabled) set.add(id);
  else set.delete(id);
  return { ...evaluation, disabled: ALL_IDS.filter((x) => set.has(x)) };
}

// レポート用の注記
export function reportNote(evaluation) {
  if (!evaluation || evaluation.enabled === false) return '';
  const c = CRITERIA.find((x) => x.id === evaluation.criterion) ?? CRITERIA[0];
  let src = c.source;
  if (c.id === 'jfc') {
    const ind = jfcIndustryOf(evaluation);
    src = `${JFC_SOURCE}・${ind.name}（${ind.year}調査、調査対象${ind.count.toLocaleString('ja-JP')}社）`;
  }
  return `評価バッジの基準：${criterionLabel(evaluation)}。出典：${src}。バッジは一般的な目安との比較であり、業種・規模・事業モデルによって適切な水準は異なります。`;
}
