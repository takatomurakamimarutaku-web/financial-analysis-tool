// 入力の補助（未入力の主な科目・前の期からのコピー・入力中の桁区切り）。DOMに依存しない純粋関数。
import { isNum } from './calc.js';

// 主な指標の計算に必要な科目と、使う指標の例
export const REQUIRED_FIELDS = [
  { section: 'pl', key: 'sales', uses: '利益率・回転日数など' },
  { section: 'pl', key: 'costOfSales', uses: '売上総利益率・在庫日数' },
  { section: 'pl', key: 'operatingIncome', uses: '営業利益率・EBITDA' },
  { section: 'pl', key: 'netIncome', uses: 'ROE・ROA' },
  { section: 'pl', key: 'depreciation', uses: 'EBITDA' },
  { section: 'bs', key: 'cash', uses: 'ネットデット' },
  { section: 'bs', key: 'currentAssets', uses: '流動比率' },
  { section: 'bs', key: 'totalAssets', uses: '自己資本比率・ROA' },
  { section: 'bs', key: 'currentLiabilities', uses: '流動比率' },
  { section: 'bs', key: 'interestBearingDebt', uses: 'D/Eレシオ・ネットデット' },
  { section: 'bs', key: 'netAssets', uses: '自己資本比率・ROE' },
];

// 期の未入力の主な科目。hiddenKeys = 設定で非表示にしている科目（数えない）
export function missingRequired(period, hiddenKeys = []) {
  const hidden = new Set(hiddenKeys);
  return REQUIRED_FIELDS.filter((f) => !hidden.has(f.key) && !isNum(period?.[f.section]?.[f.key]));
}

// 前の期の金額を、選択中の期の「未入力の欄」にだけコピーする（入力済みの欄は変えない）。
// custom = 設定の内訳科目（[{ key, parent }]）。親科目に直接入力済みで内訳がない期には、その親の内訳はコピーしない
// （内訳を入れると親科目が内訳の合計で上書きされるため）。
// 戻り値：{ period, count }（count = コピーした欄の数）。内訳の合計は呼び出し側で再計算する。
export function copyFromPrevious(period, prev, custom = []) {
  if (!period || !prev) return { period, count: 0 };
  let count = 0;
  const copySection = (cur = {}, src = {}) => {
    const out = { ...cur };
    for (const [k, v] of Object.entries(src)) {
      if (!isNum(out[k]) && isNum(v)) {
        out[k] = v;
        count++;
      }
    }
    return out;
  };
  const curDetails = period.details ?? {};
  const parentOf = Object.fromEntries(custom.map((c) => [c.key, c.parent]));
  const parentHasDetails = (parent) => custom.some((c) => c.parent === parent && isNum(curDetails[c.key]));
  const parentValue = (parent) => period.pl?.[parent] ?? period.bs?.[parent];
  const details = { ...curDetails };
  for (const [k, v] of Object.entries(prev.details ?? {})) {
    const parent = parentOf[k];
    if (!parent || isNum(details[k]) || !isNum(v)) continue;
    if (isNum(parentValue(parent)) && !parentHasDetails(parent)) continue;
    details[k] = v;
    count++;
  }
  const pl = copySection(period.pl, prev.pl);
  const bs = copySection(period.bs, prev.bs);
  return { period: { ...period, pl, bs, details }, count };
}

// 入力中の金額にカンマを入れる。caret = カーソル位置。半角数字の金額でなければそのまま返す。
// 戻り値：{ text, caret }
export function liveGroup(text, caret = text.length) {
  if (typeof text !== 'string') return { text: '', caret: 0 };
  const plain = text.replace(/,/g, '');
  const m = plain.match(/^([-−‐ー－△▲]?)(\d*)(\.\d*)?$/);
  if (!m || !m[2]) return { text, caret };
  const intPart = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const next = `${m[1]}${intPart}${m[3] ?? ''}`;
  if (next === text) return { text, caret };
  // カーソルの前にあったカンマ以外の文字数を保つ
  const before = text.slice(0, caret).replace(/,/g, '').length;
  let pos = 0;
  let seen = 0;
  while (pos < next.length && seen < before) {
    if (next[pos] !== ',') seen++;
    pos++;
  }
  return { text: next, caret: pos };
}

