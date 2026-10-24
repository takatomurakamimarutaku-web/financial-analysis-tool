import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RADAR_AXES, RADAR_MAX, buildRadarSvg, radarRule, radarScores, scoreOf } from '../js/radar.js';
import { createDefaultEvaluation } from '../js/badges.js';
import { getSampleData } from '../js/store.js';

const ev = createDefaultEvaluation();

describe('レーダーチャートの点数', () => {
  test('注意の境界 = 2点、良好の境界 = 4点、0〜5点に収める（高いほど良い指標）', () => {
    const rule = { dir: 'high', good: 30, caution: 10 };
    assert.equal(scoreOf(rule, 10), 2);
    assert.equal(scoreOf(rule, 30), 4);
    assert.equal(scoreOf(rule, 20), 3);
    assert.equal(scoreOf(rule, 40), 5);
    assert.equal(scoreOf(rule, 100), 5);
    assert.equal(scoreOf(rule, -50), 0);
    assert.equal(scoreOf(rule, null), null);
  });
  test('低いほど良い指標（D/Eレシオ）', () => {
    const rule = { dir: 'low', good: 1, caution: 2 };
    assert.equal(scoreOf(rule, 2), 2);
    assert.equal(scoreOf(rule, 1), 4);
    assert.equal(scoreOf(rule, 0.5), 5);
    assert.equal(scoreOf(rule, 4), 0);
  });
  test('境界がない・逆転している基準は計算しない', () => {
    assert.equal(scoreOf({ dir: 'high', good: null, caution: 1 }, 3), null);
    assert.equal(scoreOf({ dir: 'high', good: 1, caution: 2 }, 3), null);
  });
  test('評価バッジと同じ基準を使う（TKC未入力は標準、公庫は業種の値）', () => {
    const tkc = radarRule('operatingMargin', { ...ev, criterion: 'tkc' });
    assert.equal(tkc.rule.source, 'standard');
    assert.equal(tkc.rule.good, 5);
    const jfc = radarRule('operatingMargin', { ...ev, criterion: 'jfc' });
    assert.equal(jfc.rule.source, 'jfc');
    assert.equal(radarRule('operatingMargin', ev).fallback, false);
  });
  test('サンプルの期：6軸すべて点数が出る。% の指標は100倍して境界と比べる', () => {
    const s = radarScores(getSampleData().periods[0], ev);
    assert.equal(s.length, RADAR_AXES.length);
    for (const a of s) assert.ok(a.score >= 0 && a.score <= RADAR_MAX, a.id);
    const equity = s.find((a) => a.indicator === 'equityRatio');
    assert.equal(equity.score, scoreOf(equity.rule, equity.value.value * 100));
  });
  test('支払利息0：営業黒字は満点、債務超過の D/E は0点', () => {
    const p = getSampleData().periods[0];
    const noInterest = { ...p, pl: { ...p.pl, interestExpense: 0 } };
    assert.equal(radarScores(noInterest, ev).find((a) => a.indicator === 'icr').score, RADAR_MAX);
    const insolvent = { ...p, bs: { ...p.bs, netAssets: -100 } };
    const de = radarScores(insolvent, ev).find((a) => a.indicator === 'deRatio');
    assert.equal(de.score, 0);
    assert.equal(de.note, '債務超過');
  });
  test('未入力の期は点数なし', () => {
    const s = radarScores({ label: '', pl: {}, bs: {}, adjustments: [], debtLikeItems: [], cashLikeItems: [], details: {} }, ev);
    assert.ok(s.every((a) => a.score === null));
  });
});

describe('レーダーチャートの SVG', () => {
  test('軸の数だけ軸名、前期は点線、文字はエスケープ', () => {
    const svg = buildRadarSvg({
      labels: ['A<', 'B', 'C', 'D', 'E', 'F'],
      series: [{ name: '前期', scores: [1, 2, 3, 4, 5, 0], kind: 'prev' }, { name: '当期', scores: [2, null, 3, 4, 5, 1], kind: 'current' }],
    });
    assert.equal((svg.match(/class="radar-label"/g) || []).length, 6);
    assert.match(svg, /radar-prev/);
    assert.match(svg, /A&lt;/);
    assert.equal((svg.match(/class="radar-dot"/g) || []).length, 5);
  });
});
