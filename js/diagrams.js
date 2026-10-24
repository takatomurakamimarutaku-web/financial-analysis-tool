// 図解ページの図（滝グラフ・BSの面積図・CCCの帯グラフ）。外部ライブラリ不使用・DOMに依存しない純粋関数。
// 金額は内部値（千円）のまま受け取り、表示文字列は format 関数で作る。
import { isNum, diff } from './calc.js';
import { escapeXml, niceTicks } from './chart.js';

const r1 = (v) => Math.round(v * 10) / 10;

// ---- 滝グラフ（ウォーターフォール） ----
// step = { label, value, kind: 'total' | 'delta' }
// total は 0 から value までの棒（その時点の残高）、delta は直前の残高からの増減。

// PL：売上高 → 売上原価 → 売上総利益 → 販管費 → 営業利益 → 営業外損益 → 経常利益 → 特別損益・税金等 → 当期純利益
// 売上高・売上原価・販管費・営業利益が揃わなければ null。経常利益・当期純利益は入力があれば続ける。
export function plSteps(pl = {}, label = (k, d) => d) {
  if (![pl.sales, pl.costOfSales, pl.sga, pl.operatingIncome].every(isNum)) return null;
  const steps = [
    { label: label('sales', '売上高'), value: pl.sales, kind: 'total' },
    { label: `− ${label('costOfSales', '売上原価')}`, value: -pl.costOfSales, kind: 'delta' },
    { label: '売上総利益', value: pl.sales - pl.costOfSales, kind: 'total' },
    { label: `− ${label('sga', '販管費')}`, value: -pl.sga, kind: 'delta' },
    { label: label('operatingIncome', '営業利益'), value: pl.operatingIncome, kind: 'total' },
  ];
  if (isNum(pl.ordinaryIncome)) {
    steps.push({ label: '± 営業外損益', value: pl.ordinaryIncome - pl.operatingIncome, kind: 'delta' });
    steps.push({ label: label('ordinaryIncome', '経常利益'), value: pl.ordinaryIncome, kind: 'total' });
    if (isNum(pl.netIncome)) {
      steps.push({ label: '± 特別損益・税金等', value: pl.netIncome - pl.ordinaryIncome, kind: 'delta' });
      steps.push({ label: label('netIncome', '当期純利益'), value: pl.netIncome, kind: 'total' });
    }
  }
  return steps;
}

// EBITDAブリッジ：報告EBITDA → 区分ごとの調整 → 正常化EBITDA（calcNormalizedEbitda の結果を受け取る）
export function ebitdaSteps(n) {
  if (!n || !isNum(n.reported)) return null;
  return [
    { label: '報告EBITDA', value: n.reported, kind: 'total' },
    ...n.byCategory.filter((c) => c.count > 0).map((c) => ({ label: `${c.total >= 0 ? '＋' : '−'} ${c.name}`, value: c.total, kind: 'delta' })),
    { label: '正常化EBITDA', value: n.normalized, kind: 'total' },
  ];
}

// 調整後ネットデット：有利子負債 → ＋デットライク → −現預金 → −キャッシュライク → 調整後ネットデット（calcAdjustedNetDebt の結果）
export function netDebtSteps(nd, label = (k, d) => d) {
  if (!nd || !isNum(nd.adjusted)) return null;
  return [
    { label: label('interestBearingDebt', '有利子負債'), value: nd.interestBearingDebt, kind: 'total' },
    { label: '＋ デットライク項目', value: nd.debtLikeTotal, kind: 'delta' },
    { label: `− ${label('cash', '現預金')}`, value: -nd.cash, kind: 'delta' },
    { label: '− キャッシュライク項目', value: -nd.cashLikeTotal, kind: 'delta' },
    { label: '調整後ネットデット', value: nd.adjusted, kind: 'total' },
  ];
}

// 各段の棒の始点・終点を計算する。戻り値：[{ ...step, from, to }]
export function waterfallBars(steps) {
  let cum = 0;
  return steps.map((s) => {
    if (s.kind === 'total') {
      cum = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = cum;
    cum += s.value;
    return { ...s, from, to: cum };
  });
}

// 横向きの滝グラフ（スマホで項目名が読みやすいよう、1段 = 1行）
export function buildWaterfallSvg({ steps, format = String, title = '', width = 340 }) {
  if (!steps || !steps.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" role="img" aria-label="${escapeXml(title)}" class="diagram"><text x="${width / 2}" y="34" text-anchor="middle" class="chart-empty">必要な項目が未入力です</text></svg>`;
  }
  const bars = waterfallBars(steps);
  const rowH = 30;
  const pad = { top: 8, bottom: 22 };
  const labelW = 132;
  const valueW = 78;
  const x0 = labelW;
  const x1 = width - valueW;
  const height = pad.top + rowH * bars.length + pad.bottom;
  const all = bars.flatMap((b) => [b.from, b.to]);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 3);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (v) => r1(x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}" class="diagram">`];
  for (const t of ticks) {
    parts.push(`<line x1="${x(t)}" y1="${pad.top}" x2="${x(t)}" y2="${height - pad.bottom}" class="${t === 0 ? 'chart-zero' : 'chart-grid'}"/>`);
  }
  bars.forEach((b, i) => {
    const y = pad.top + i * rowH;
    const left = Math.min(x(b.from), x(b.to));
    const w = Math.max(1, Math.abs(x(b.to) - x(b.from)));
    const cls = b.kind === 'total' ? (b.value < 0 ? 'wf-total wf-negative' : 'wf-total') : (b.value < 0 ? 'wf-down' : 'wf-up');
    parts.push(`<text x="4" y="${y + rowH / 2 + 4}" class="${b.kind === 'total' ? 'wf-label wf-label-total' : 'wf-label'}">${escapeXml(b.label)}</text>`);
    parts.push(`<rect x="${r1(left)}" y="${y + 6}" width="${r1(w)}" height="${rowH - 12}" rx="2" class="${cls}"/>`);
    parts.push(`<text x="${width - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" class="${b.kind === 'total' ? 'wf-value wf-value-total' : 'wf-value'}">${escapeXml(format(b.value, b))}</text>`);
    // 次の段へのつなぎ線（残高の位置）
    if (i < bars.length - 1) {
      parts.push(`<line x1="${x(b.to)}" y1="${y + rowH - 6}" x2="${x(b.to)}" y2="${y + rowH + 6}" class="wf-link"/>`);
    }
  });
  return parts.join('') + '</svg>';
}

// ---- BS の面積図 ----

// 必要な項目：流動資産・固定資産・流動負債・固定負債・純資産。揃わない、または資産がマイナスなら null。
// 純資産がマイナス（債務超過）の場合は、資産側に「債務超過」の箱を置いて左右の高さをそろえる。
export function bsBoxes(bs = {}) {
  const keys = ['currentAssets', 'fixedAssets', 'currentLiabilities', 'fixedLiabilities', 'netAssets'];
  if (!keys.every((k) => isNum(bs[k]))) return null;
  if (bs.currentAssets < 0 || bs.fixedAssets < 0 || bs.currentLiabilities < 0 || bs.fixedLiabilities < 0) return null;
  const insolvent = bs.netAssets < 0;
  const left = [
    { key: 'currentAssets', label: '流動資産', value: bs.currentAssets },
    { key: 'fixedAssets', label: '固定資産', value: bs.fixedAssets },
  ];
  if (insolvent) left.push({ key: 'deficit', label: '債務超過', value: -bs.netAssets });
  const right = [
    { key: 'currentLiabilities', label: '流動負債', value: bs.currentLiabilities },
    { key: 'fixedLiabilities', label: '固定負債', value: bs.fixedLiabilities },
  ];
  if (!insolvent) right.push({ key: 'netAssets', label: '純資産', value: bs.netAssets });
  const sum = (arr) => arr.reduce((s, x) => s + x.value, 0);
  const leftTotal = sum(left);
  const rightTotal = sum(right);
  return { left, right, leftTotal, rightTotal, insolvent, balanced: Math.abs(leftTotal - rightTotal) < 0.0005 };
}

export function buildBsBoxSvg({ boxes, format = String, label = (k, d) => d, title = '貸借対照表の面積図', width = 340, height = 250 }) {
  if (!boxes || Math.max(boxes.leftTotal, boxes.rightTotal) <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" role="img" aria-label="${escapeXml(title)}" class="diagram"><text x="${width / 2}" y="34" text-anchor="middle" class="chart-empty">必要な項目が未入力です</text></svg>`;
  }
  const top = 22;
  const h = height - top - 4;
  const gap = 8;
  const colW = (width - gap) / 2;
  const scale = h / Math.max(boxes.leftTotal, boxes.rightTotal);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}" class="diagram">`];
  parts.push(`<text x="${r1(colW / 2)}" y="14" text-anchor="middle" class="bs-head">資産（使い道）</text>`);
  parts.push(`<text x="${r1(colW + gap + colW / 2)}" y="14" text-anchor="middle" class="bs-head">負債・純資産（集め方）</text>`);
  const column = (items, x0, total) => {
    let y = top;
    for (const it of items) {
      const bh = it.value * scale;
      parts.push(`<rect x="${r1(x0)}" y="${r1(y)}" width="${r1(colW)}" height="${r1(Math.max(bh, 0.5))}" class="bs-box bs-${it.key}"/>`);
      const name = it.key === 'deficit' ? it.label : label(it.key, it.label);
      const pct = total > 0 ? `${Math.round((it.value / total) * 1000) / 10}%` : '';
      const cx = r1(x0 + colW / 2);
      if (bh >= 44) {
        parts.push(`<text x="${cx}" y="${r1(y + bh / 2 - 6)}" text-anchor="middle" class="bs-label">${escapeXml(name)}</text>`);
        parts.push(`<text x="${cx}" y="${r1(y + bh / 2 + 10)}" text-anchor="middle" class="bs-value">${escapeXml(format(it.value))}（${pct}）</text>`);
      } else if (bh >= 15) {
        parts.push(`<text x="${cx}" y="${r1(y + bh / 2 + 4)}" text-anchor="middle" class="bs-label bs-label-small">${escapeXml(name)} ${pct}</text>`);
      }
      y += bh;
    }
  };
  column(boxes.left, 0, boxes.leftTotal);
  column(boxes.right, colW + gap, boxes.rightTotal);
  return parts.join('') + '</svg>';
}

// ---- CCC（お金が戻るまでの日数）の帯グラフ ----

// results は calcIndicators の結果。3つの回転日数が揃わなければ null。
export function cccParts(results) {
  const inv = results?.inventoryDays;
  const rec = results?.receivableDays;
  const pay = results?.payableDays;
  if (![inv, rec, pay].every((x) => x?.status === 'ok' && isNum(x.value))) return null;
  const collect = inv.value + rec.value;
  return { inventory: inv.value, receivable: rec.value, payable: pay.value, collect, ccc: diff(collect, pay.value) };
}

export function buildCccSvg({ parts: p, format = (v) => `${Math.round(v * 10) / 10}日`, title = 'お金が戻るまでの日数', width = 340 }) {
  if (!p) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" role="img" aria-label="${escapeXml(title)}" class="diagram"><text x="${width / 2}" y="34" text-anchor="middle" class="chart-empty">必要な項目が未入力です</text></svg>`;
  }
  const rowH = 34;
  const labelW = 104;
  const x0 = labelW;
  const x1 = width - 20; // 右端の目盛りの文字が切れないよう余白を取る
  const top = 6;
  const height = top + rowH * 3 + 24;
  const max = Math.max(p.collect, p.payable, 1);
  const ticks = niceTicks(0, max, 3);
  const hi = ticks[ticks.length - 1];
  const x = (v) => r1(x0 + (Math.max(0, v) / hi) * (x1 - x0));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}" class="diagram">`];
  for (const t of ticks) {
    out.push(`<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${top + rowH * 3}" class="chart-grid"/>`);
    out.push(`<text x="${x(t)}" y="${top + rowH * 3 + 14}" text-anchor="middle" class="chart-tick">${escapeXml(`${t}日`)}</text>`);
  }
  const bar = (row, from, to, cls, text) => {
    const y = top + row * rowH + 8;
    const w = Math.max(0, x(to) - x(from));
    out.push(`<rect x="${x(from)}" y="${y}" width="${r1(w)}" height="${rowH - 16}" rx="3" class="${cls}"/>`);
    if (text && w >= 34) out.push(`<text x="${r1(x(from) + w / 2)}" y="${y + (rowH - 16) / 2 + 4}" text-anchor="middle" class="ccc-text">${escapeXml(text)}</text>`);
  };
  const label = (row, text) => out.push(`<text x="4" y="${top + row * rowH + rowH / 2 + 4}" class="wf-label">${escapeXml(text)}</text>`);
  label(0, '在庫 → 売掛金');
  bar(0, 0, p.inventory, 'ccc-inv', format(p.inventory));
  bar(0, p.inventory, p.collect, 'ccc-rec', format(p.receivable));
  label(1, '仕入代金の支払');
  bar(1, 0, p.payable, 'ccc-pay', format(p.payable));
  label(2, '資金の立替（CCC）');
  if (p.ccc > 0) bar(2, p.payable, p.collect, 'ccc-gap', format(p.ccc));
  else out.push(`<text x="${x0}" y="${top + 2 * rowH + rowH / 2 + 4}" class="ccc-note">${escapeXml(`支払より先に回収（${format(p.ccc)}）`)}</text>`);
  return out.join('') + '</svg>';
}
