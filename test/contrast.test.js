import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// css/style.css の色トークン（:root と :root[data-theme="dark"]）から、文字と背景のコントラスト比を確かめる（WCAG 2.1 AA：4.5:1 以上）
const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

function vars(re) {
  const out = {};
  for (const m of css.matchAll(re)) for (const v of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) out[v[1]] = v[2].trim();
  return out;
}
const light = vars(/^:root \{([^}]*)\}/gm);
const dark = { ...light, ...vars(/^:root\[data-theme="dark"\] \{([^}]*)\}/gm) };
const darkAuto = { ...light, ...vars(/^ {2}:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/gm) };

function rgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'row-alt'],
  ['muted', 'surface'], ['muted', 'bg'], ['muted', 'head-bg'], ['muted', 'row-alt'],
  ['primary', 'surface'], ['primary', 'bg'], ['primary', 'primary-soft'], ['primary-text', 'primary'],
  ['danger', 'surface'], ['accent', 'surface'], ['na', 'surface'], ['na', 'bg'],
  ['good-text', 'good-bg'], ['caution-text', 'caution-bg'], ['warn-text', 'warn-bg'],
  ['header-text', 'header-bg'], ['header-muted', 'header-bg'], ['header-muted', 'header-bg2'],
];

describe('文字と背景のコントラスト比（4.5:1 以上）', () => {
  test('計算式の確認：白と黒は 21:1', () => {
    assert.equal(Math.round(contrast('#ffffff', '#000000')), 21);
  });
  for (const [name, t] of [['ライト', light], ['ダーク（設定）', dark], ['ダーク（端末に合わせる）', darkAuto]]) {
    test(name, () => {
      for (const [f, b] of PAIRS) {
        assert.ok(t[f]?.startsWith('#') && t[b]?.startsWith('#'), `${f} / ${b} の色が見つからない`);
        const r = contrast(t[f], t[b]);
        assert.ok(r >= 4.5, `${f}（${t[f]}）/ ${b}（${t[b]}）= ${r.toFixed(2)}`);
      }
    });
  }
  test('図の白い文字を載せる色（BSの面積図・CCC）', () => {
    for (const cls of ['bs-currentAssets', 'bs-fixedAssets', 'bs-currentLiabilities', 'bs-fixedLiabilities', 'bs-netAssets', 'bs-deficit', 'ccc-inv']) {
      const m = css.match(new RegExp(`\\.${cls} \\{ fill: (#[0-9a-f]{6}); \\}`));
      assert.ok(m, cls);
      assert.ok(contrast('#ffffff', m[1]) >= 4.5, `${cls} ${m[1]} ${contrast('#ffffff', m[1]).toFixed(2)}`);
    }
  });
});
