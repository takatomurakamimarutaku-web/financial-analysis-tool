// SVG折れ線グラフの生成（外部ライブラリ不使用・DOMに依存しない純粋関数）
// 値が null の期は点を打たず、線を途切れさせる。

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 目盛りを 1, 2, 2.5, 5 × 10^n の切りの良い値にする
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

// labels: 期名の配列、values: number|null の配列、format: 値→表示文字列
export function buildLineChartSvg({ labels, values, format = String, tickFormat = format, title = '', width = 320, height = 180 }) {
  const pad = { top: 24, right: 12, bottom: 28, left: 56 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}の推移" class="chart">`);
  if (!nums.length) {
    parts.push(`<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">データなし</text>`);
    parts.push('</svg>');
    return parts.join('');
  }
  const ticks = niceTicks(Math.min(...nums), Math.max(...nums));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const n = labels.length;
  const x = (i) => pad.left + (n === 1 ? w / 2 : (w * i) / (n - 1));
  const y = (v) => pad.top + h - ((v - lo) / (hi - lo)) * h;

  for (const t of ticks) {
    const ty = y(t).toFixed(1);
    parts.push(`<line x1="${pad.left}" x2="${pad.left + w}" y1="${ty}" y2="${ty}" class="chart-grid${t === 0 ? ' chart-zero' : ''}"/>`);
    parts.push(`<text x="${pad.left - 6}" y="${ty}" dy="0.32em" text-anchor="end" class="chart-tick">${escapeXml(tickFormat(t))}</text>`);
  }
  // 両端の期名は内側に寄せて、グラフ外にはみ出さないようにする
  labels.forEach((l, i) => {
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    const lx = n === 1 ? x(i) : i === 0 ? x(i) - 8 : i === n - 1 ? x(i) + 8 : x(i);
    parts.push(`<text x="${lx.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" class="chart-label">${escapeXml(l)}</text>`);
  });

  // 連続する値ごとに線を引く（null で途切れる）
  let seg = [];
  const flush = () => {
    if (seg.length > 1) parts.push(`<polyline points="${seg.join(' ')}" class="chart-line"/>`);
    seg = [];
  };
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    else flush();
  });
  flush();

  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const cx = x(i).toFixed(1);
    const cy = y(v).toFixed(1);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" class="chart-dot"><title>${escapeXml(`${labels[i]}：${format(v)}`)}</title></circle>`);
  });
  // 最新の値をラベル表示
  const lastIdx = values.map((v, i) => (typeof v === 'number' && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0).pop();
  parts.push(`<text x="${x(lastIdx).toFixed(1)}" y="${(y(values[lastIdx]) - 8).toFixed(1)}" text-anchor="${n > 1 && lastIdx === n - 1 ? 'end' : 'middle'}" class="chart-value">${escapeXml(format(values[lastIdx]))}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

// 期ごとの棒グラフ（複数系列を横に並べる）。series = [{ name, values: number|null[], cls }]。
// 0 の線を基準に、プラスは上・マイナスは下に伸ばす。値が null の棒は描かない。
export function buildBarChartSvg({ labels, series, tickFormat = String, title = '', width = 340, height = 200 }) {
  const pad = { top: 16, right: 8, bottom: 28, left: 52 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const nums = series.flatMap((s) => s.values).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}" class="chart bar-chart">`];
  if (!nums.length) {
    parts.push(`<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">データなし</text></svg>`);
    return parts.join('');
  }
  const ticks = niceTicks(Math.min(0, ...nums), Math.max(0, ...nums));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v) => pad.top + h - ((v - lo) / (hi - lo)) * h;
  for (const t of ticks) {
    const ty = y(t).toFixed(1);
    parts.push(`<line x1="${pad.left}" x2="${pad.left + w}" y1="${ty}" y2="${ty}" class="chart-grid${t === 0 ? ' chart-zero' : ''}"/>`);
    parts.push(`<text x="${pad.left - 6}" y="${ty}" dy="0.32em" text-anchor="end" class="chart-tick">${escapeXml(tickFormat(t))}</text>`);
  }
  const n = labels.length;
  const slot = w / n;
  const barW = Math.max(3, Math.min(18, (slot * 0.8) / series.length));
  labels.forEach((l, i) => {
    const cx = pad.left + slot * i + slot / 2;
    parts.push(`<text x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${escapeXml(l)}</text>`);
    series.forEach((s, j) => {
      const v = s.values[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const x = cx - (barW * series.length) / 2 + barW * j;
      const y0 = y(0);
      const y1 = y(v);
      parts.push(`<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${Math.max(0.5, Math.abs(y1 - y0)).toFixed(1)}" class="bar ${escapeXml(s.cls ?? '')}"><title>${escapeXml(`${s.name} ${l}`)}</title></rect>`);
    });
  });
  parts.push('</svg>');
  return parts.join('');
}
