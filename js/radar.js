// 財務バランスのレーダーチャート。DOMに依存しない純粋関数。
// 6つの軸ごとに代表的な指標を1つ選び、評価バッジと同じ基準（良好・注意の境界）で 0〜5 点にする。
// 点数：注意の境界 = 2点、良好の境界 = 4点として直線で換算し、0〜5 点に収める。
import { ruleFor } from './badges.js';
import { calcIndicators, isNum } from './calc.js';
import { escapeXml } from './chart.js';

export const RADAR_AXES = [
  { id: 'profit', label: '収益性', indicator: 'operatingMargin' },
  { id: 'capital', label: '資本効率', indicator: 'roa' },
  { id: 'equity', label: '安全性', indicator: 'equityRatio' },
  { id: 'liquidity', label: '支払能力', indicator: 'currentRatio' },
  { id: 'interest', label: '利払い余力', indicator: 'icr' },
  { id: 'leverage', label: '借入の重さ', indicator: 'deRatio' },
];

export const RADAR_MAX = 5;

function hasBounds(rule) {
  return Boolean(rule) && isNum(rule.good) && isNum(rule.caution) && rule.good !== rule.caution
    && (rule.dir === 'high' ? rule.good > rule.caution : rule.good < rule.caution);
}

// 軸の境界。選んだ評価基準に境界がなければ「標準」の境界を使う（fallback = true）
export function radarRule(indicator, evaluation) {
  const rule = ruleFor(indicator, evaluation);
  if (hasBounds(rule)) return { rule, fallback: false };
  const std = ruleFor(indicator, { criterion: 'standard' });
  return hasBounds(std) ? { rule: std, fallback: true } : { rule: null, fallback: false };
}

// 表示単位の値（% は 100 倍）を 0〜5 点にする。計算できなければ null
export function scoreOf(rule, displayValue) {
  if (!hasBounds(rule) || !isNum(displayValue)) return null;
  const { good, caution } = rule;
  const raw = rule.dir === 'high'
    ? 2 + (2 * (displayValue - caution)) / (good - caution)
    : 2 + (2 * (caution - displayValue)) / (caution - good);
  return Math.round(Math.min(RADAR_MAX, Math.max(0, raw)) * 100) / 100;
}

// 期の各軸の点数。戻り値：[{ id, label, indicator, value, score, rule, fallback, note }]
export function radarScores(period, evaluation, options = {}) {
  const results = calcIndicators(period, options);
  const pl = period?.pl ?? {};
  return RADAR_AXES.map((axis) => {
    const { rule, fallback } = radarRule(axis.indicator, evaluation);
    const r = results[axis.indicator];
    let score = null;
    let note = '';
    if (r?.status === 'ok') score = scoreOf(rule, rule?.unit === '%' ? r.value * 100 : r.value);
    else if (axis.indicator === 'icr' && pl.interestExpense === 0 && isNum(pl.operatingIncome) && pl.operatingIncome !== 0) {
      // 支払利息がない：営業黒字なら満点、営業赤字なら0点（評価バッジと同じ扱い）
      score = pl.operatingIncome > 0 ? RADAR_MAX : 0;
      note = pl.operatingIncome > 0 ? '利息負担なし' : '営業赤字';
    } else if (axis.indicator === 'deRatio' && r?.status === 'notApplicable') {
      score = 0;
      note = '債務超過';
    }
    return { id: axis.id, label: axis.label, indicator: axis.indicator, value: r ?? null, score, rule, fallback, note };
  });
}

function r1(v) {
  return Math.round(v * 10) / 10;
}

// レーダーチャートの SVG。series = [{ name, scores: [0〜5 | null, …], kind: 'current' | 'prev' }]
// 点数が null の軸は中心（0）として描き、軸名に「—」を付ける。
export function buildRadarSvg({ labels, series, title = '財務バランス', width = 340, height = 300 }) {
  const n = labels.length;
  const cx = width / 2;
  const cy = height / 2 + 6;
  const radius = Math.min(width, height) / 2 - 46;
  const point = (i, score) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const d = (radius * score) / RADAR_MAX;
    return [r1(cx + d * Math.cos(a)), r1(cy + d * Math.sin(a))];
  };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}" class="diagram radar">`];
  for (let level = 1; level <= RADAR_MAX; level++) {
    const pts = labels.map((_, i) => point(i, level).join(',')).join(' ');
    parts.push(`<polygon points="${pts}" class="${level === 2 || level === 4 ? 'radar-ring radar-ring-mark' : 'radar-ring'}"/>`);
  }
  labels.forEach((l, i) => {
    const [x, y] = point(i, RADAR_MAX);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-spoke"/>`);
    const [lx, ly] = point(i, RADAR_MAX + 0.9);
    const anchor = Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end';
    parts.push(`<text x="${lx}" y="${ly}" dy="0.35em" text-anchor="${anchor}" class="radar-label">${escapeXml(l)}</text>`);
  });
  for (const s of series) {
    const pts = s.scores.map((v, i) => point(i, isNum(v) ? v : 0).join(',')).join(' ');
    const cls = s.kind === 'prev' ? 'radar-area radar-prev' : 'radar-area radar-current';
    parts.push(`<polygon points="${pts}" class="${cls}"><title>${escapeXml(s.name)}</title></polygon>`);
    if (s.kind !== 'prev') {
      s.scores.forEach((v, i) => {
        if (!isNum(v)) return;
        const [x, y] = point(i, v);
        parts.push(`<circle cx="${x}" cy="${y}" r="3" class="radar-dot"/>`);
      });
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
