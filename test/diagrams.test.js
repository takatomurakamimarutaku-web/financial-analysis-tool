import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  plSteps, ebitdaSteps, netDebtSteps, waterfallBars, buildWaterfallSvg, bsBoxes, buildBsBoxSvg, cccParts, buildCccSvg,
} from '../js/diagrams.js';
import { calcIndicators, calcNormalizedEbitda, calcAdjustedNetDebt } from '../js/calc.js';
import { getSampleData } from '../js/store.js';

const sample = () => getSampleData().periods[0];

describe('PL の滝グラフ', () => {
  test('売上高から当期純利益までの段（増減は差し引き）', () => {
    const steps = plSteps(sample().pl);
    assert.deepEqual(steps.map((s) => [s.label, s.value, s.kind]), [
      ['売上高', 100000, 'total'], ['− 売上原価', -60000, 'delta'], ['売上総利益', 40000, 'total'],
      ['− 販管費', -30000, 'delta'], ['営業利益', 10000, 'total'], ['± 営業外損益', -1000, 'delta'],
      ['経常利益', 9000, 'total'], ['± 特別損益・税金等', -3000, 'delta'], ['当期純利益', 6000, 'total'],
    ]);
  });
  test('必須項目が未入力なら null、経常・純利益がなければそこまで', () => {
    const pl = { ...sample().pl, sga: null };
    assert.equal(plSteps(pl), null);
    const steps = plSteps({ ...sample().pl, ordinaryIncome: null });
    assert.equal(steps.length, 5);
    assert.equal(plSteps({ ...sample().pl, netIncome: null }).length, 7);
  });
  test('科目名の変更を反映できる', () => {
    const steps = plSteps(sample().pl, (k, d) => (k === 'sales' ? '売上収益' : d));
    assert.equal(steps[0].label, '売上収益');
  });
  test('棒の始点・終点：total は0から、delta は直前の残高から', () => {
    const bars = waterfallBars(plSteps(sample().pl));
    assert.deepEqual([bars[0].from, bars[0].to], [0, 100000]);
    assert.deepEqual([bars[1].from, bars[1].to], [100000, 40000]);
    assert.deepEqual([bars[3].from, bars[3].to], [40000, 10000]);
    assert.deepEqual([bars[5].from, bars[5].to], [10000, 9000]);
  });
  test('SVG：段の数だけ棒、値の表示、ラベルはエスケープ', () => {
    const steps = plSteps(sample().pl, (k, d) => (k === 'sales' ? '<売上>' : d));
    const svg = buildWaterfallSvg({ steps, format: (v) => `${v}` });
    assert.equal((svg.match(/<rect /g) || []).length, 9);
    assert.match(svg, /&lt;売上&gt;/);
    assert.match(svg, />-60000</);
    assert.match(svg, /class="wf-down"/);
    assert.match(svg, /class="wf-total"/);
  });
  test('赤字（営業利益がマイナス）でも描ける', () => {
    const pl = { ...sample().pl, sga: 45000, operatingIncome: -5000, ordinaryIncome: null };
    const svg = buildWaterfallSvg({ steps: plSteps(pl) });
    assert.match(svg, /wf-total wf-negative/);
    assert.match(svg, /chart-zero/);
  });
  test('段がなければ「必要な項目が未入力です」', () => {
    assert.match(buildWaterfallSvg({ steps: null }), /必要な項目が未入力です/);
  });
});

describe('EBITDA・ネットデットの滝グラフ', () => {
  test('EBITDA：報告 → 区分ごとの調整 → 正常化', () => {
    const steps = ebitdaSteps(calcNormalizedEbitda(sample()));
    assert.equal(steps[0].value, 15000);
    assert.equal(steps.at(-1).value, 18400);
    assert.equal(steps.length, 5);
    assert.equal(waterfallBars(steps).at(-2).to, 18400); // 調整の積み上げが正常化EBITDAと一致
    assert.equal(ebitdaSteps(calcNormalizedEbitda({ pl: {}, bs: {} })), null);
  });
  test('ネットデット：有利子負債 ＋ デットライク − 現預金 − キャッシュライク', () => {
    const steps = netDebtSteps(calcAdjustedNetDebt(sample()));
    assert.deepEqual(steps.map((s) => s.value), [40000, 4500, -20000, -2000, 22500]);
    assert.equal(waterfallBars(steps).at(-2).to, 22500);
    assert.equal(netDebtSteps(calcAdjustedNetDebt({ pl: {}, bs: {} })), null);
  });
});

describe('BS の面積図', () => {
  test('左右の箱と合計、貸借一致', () => {
    const b = bsBoxes(sample().bs);
    assert.deepEqual(b.left.map((x) => x.value), [50000, 50000]);
    assert.deepEqual(b.right.map((x) => x.value), [30000, 30000, 40000]);
    assert.equal(b.balanced, true);
    assert.equal(b.insolvent, false);
  });
  test('債務超過は資産側に「債務超過」の箱を置く', () => {
    const bs = { ...sample().bs, fixedLiabilities: 80000, netAssets: -10000 };
    const b = bsBoxes(bs);
    assert.equal(b.insolvent, true);
    assert.deepEqual(b.left.at(-1), { key: 'deficit', label: '債務超過', value: 10000 });
    assert.equal(b.right.some((x) => x.key === 'netAssets'), false);
    assert.equal(b.leftTotal, 110000);
    assert.equal(b.rightTotal, 110000);
    assert.match(buildBsBoxSvg({ boxes: b }), /bs-deficit/);
  });
  test('未入力・マイナスの資産は null、SVG は未入力表示', () => {
    assert.equal(bsBoxes({ ...sample().bs, fixedAssets: null }), null);
    assert.equal(bsBoxes({ ...sample().bs, currentAssets: -1 }), null);
    assert.match(buildBsBoxSvg({ boxes: null }), /必要な項目が未入力です/);
  });
  test('SVG：5つの箱と構成比', () => {
    const svg = buildBsBoxSvg({ boxes: bsBoxes(sample().bs), format: (v) => `${v}` });
    assert.equal((svg.match(/class="bs-box/g) || []).length, 5);
    assert.match(svg, /純資産/);
    assert.match(svg, /40000（40%）/);
  });
});

describe('CCC の帯グラフ', () => {
  test('在庫日数＋回収日数 − 支払日数 = CCC', () => {
    const r = calcIndicators(sample());
    const p = cccParts(r);
    assert.equal(p.collect, r.inventoryDays.value + r.receivableDays.value);
    assert.equal(p.ccc, r.ccc.value);
    const svg = buildCccSvg({ parts: p });
    assert.match(svg, /ccc-gap/);
    assert.match(svg, /資金の立替（CCC）/);
  });
  test('CCC がマイナスなら「支払より先に回収」', () => {
    const p = { inventory: 10, receivable: 20, payable: 50, collect: 30, ccc: -20 };
    const svg = buildCccSvg({ parts: p });
    assert.doesNotMatch(svg, /ccc-gap/);
    assert.match(svg, /支払より先に回収/);
  });
  test('回転日数が計算できなければ null', () => {
    assert.equal(cccParts(calcIndicators({ pl: {}, bs: {} })), null);
    assert.match(buildCccSvg({ parts: null }), /必要な項目が未入力です/);
  });
});
