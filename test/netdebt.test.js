import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcIndicators, calcWorkingCapital, calcWorkingCapitalSeries, calcAdjustedNetDebt,
  getNetDebtItemWarnings, buildNetDebtBreakdown, buildComparison, formatValue,
} from '../js/calc.js';
import {
  CURRENT_VERSION, getSampleData, getSampleMultiData, createEmptyPeriod, createEmptyData,
  migrate, migrateV2toV3, normalizeData, parseBackup, backupToJson, validateData,
  createLineItem, addLineItem, updateLineItem, removeLineItem,
} from '../js/store.js';

const EPS = 1e-9;
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, `${msg ?? ''} expected ${expected}, got ${actual}`);
}
const item = (name, amount, memo = '根拠あり') => ({ id: `t-${name}-${amount}`, name, amount, memo });

function basePeriod() {
  const p = getSampleData().periods[0];
  p.debtLikeItems = [];
  p.cashLikeItems = [];
  return p;
}

describe('運転資本', () => {
  test('運転資本 = 売上債権 + 棚卸資産 − 仕入債務（手計算）', () => {
    // 15,000 + 10,000 − 8,000 = 17,000、売上高100,000 に対し 17.0%
    const r = calcWorkingCapital(getSampleData().periods[0]);
    assert.equal(r.amount, 17000);
    near(r.ratio, 0.17);
  });
  test('未入力・売上高0', () => {
    const p = basePeriod();
    p.bs.inventory = null;
    assert.deepEqual(calcWorkingCapital(p), { amount: null, ratio: null });
    const q = basePeriod();
    q.pl.sales = 0;
    assert.equal(calcWorkingCapital(q).amount, 17000);
    assert.equal(calcWorkingCapital(q).ratio, null);
  });
  test('マイナスの運転資本（仕入債務が大きい）', () => {
    const p = basePeriod();
    p.bs.payables = 40000;
    assert.equal(calcWorkingCapital(p).amount, -15000);
  });
  test('期別推移と全期の平均（手計算）', () => {
    // 2023: 13,500 + 9,800 − 7,200 = 16,100 / 2024: 14,200 + 10,300 − 7,600 = 16,900 / 2025: 17,000
    const s = calcWorkingCapitalSeries(getSampleMultiData());
    assert.deepEqual(s.items.map((x) => x.amount), [16100, 16900, 17000]);
    near(s.items[0].ratio, 16100 / 82000);
    near(s.average, (16100 + 16900 + 17000) / 3);
    near(s.averageRatio, ((16100 + 16900 + 17000) / 3) / ((82000 + 91000 + 100000) / 3));
    assert.equal(s.periodsUsed, 3);
  });
  test('計算できない期は平均から除く', () => {
    const d = getSampleMultiData();
    d.periods[1].bs.payables = null;
    const s = calcWorkingCapitalSeries(d);
    assert.equal(s.periodsUsed, 2);
    near(s.average, (16100 + 17000) / 2);
    near(s.averageRatio, ((16100 + 17000) / 2) / ((82000 + 100000) / 2));
  });
  test('全期とも計算できなければ平均は「—」', () => {
    const s = calcWorkingCapitalSeries(createEmptyData());
    assert.equal(s.average, null);
    assert.equal(s.averageRatio, null);
    assert.equal(calcWorkingCapitalSeries({ periods: [] }).average, null);
  });
});

describe('調整後ネットデット', () => {
  test('デットライク項目0件なら Phase 1 のネットデットと一致', () => {
    const p = basePeriod();
    const phase1 = calcIndicators(p).netDebt.value;
    const r = calcAdjustedNetDebt(p);
    assert.equal(phase1, 20000);
    assert.equal(r.adjusted, phase1);
    assert.equal(r.netDebt, phase1);
  });
  test('デット・キャッシュライク項目がない（undefined）古い形でも一致', () => {
    const p = basePeriod();
    delete p.debtLikeItems;
    delete p.cashLikeItems;
    assert.equal(calcAdjustedNetDebt(p).adjusted, calcIndicators(p).netDebt.value);
  });
  test('有利子負債 + デットライク − 現預金 − キャッシュライク（手計算）', () => {
    // 40,000 + 3,000 + 1,500 − 20,000 − 2,000 = 22,500
    const r = calcAdjustedNetDebt(getSampleData().periods[0]);
    assert.equal(r.debtLikeTotal, 4500);
    assert.equal(r.cashLikeTotal, 2000);
    assert.equal(r.adjusted, 22500);
  });
  test('調整後ネットデット ÷ 正常化EBITDA（手計算）', () => {
    // 22,500 ÷ 18,400
    const r = calcAdjustedNetDebt(getSampleData().periods[0]);
    assert.equal(r.normalizedEbitda, 18400);
    near(r.multiple.value, 22500 / 18400);
    assert.equal(formatValue(r.multiple, '倍'), '1.22倍');
  });
  test('キャッシュライクのみ：ネットキャッシュ（マイナス）になる', () => {
    const p = basePeriod();
    p.cashLikeItems = [item('有価証券', 30000)];
    const r = calcAdjustedNetDebt(p);
    assert.equal(r.adjusted, -10000);
    assert.equal(r.multiple.status, 'ok');
  });
  test('金額未入力の項目は合計に含めない', () => {
    const p = basePeriod();
    p.debtLikeItems = [item('リース債務', null), item('未払配当', 500)];
    assert.equal(calcAdjustedNetDebt(p).adjusted, 20500);
  });
  test('有利子負債または現預金が未入力なら「—」', () => {
    const p = basePeriod();
    p.bs.cash = null;
    p.debtLikeItems = [item('リース債務', 1000)];
    const r = calcAdjustedNetDebt(p);
    assert.equal(r.adjusted, null);
    assert.equal(r.multiple.status, 'na');
  });
  test('正常化EBITDAがマイナス → 倍率は「参考外」、0 → 「—」', () => {
    const p = basePeriod();
    p.adjustments = [{ id: 'x', category: 'oneTime', description: '', amount: -50000, memo: 'x' }];
    assert.equal(calcAdjustedNetDebt(p).multiple.status, 'notApplicable');
    p.adjustments[0].amount = -15000;
    assert.equal(calcAdjustedNetDebt(p).normalizedEbitda, 0);
    assert.equal(calcAdjustedNetDebt(p).multiple.status, 'na');
  });
  test('警告：根拠未記載・金額未入力', () => {
    const p = basePeriod();
    p.debtLikeItems = [item('リース債務', 1000, '')];
    p.cashLikeItems = [item('定期預金', null)];
    const w = getNetDebtItemWarnings(p);
    assert.deepEqual(w.map((x) => [x.list, x.type]), [['debtLikeItems', 'memoMissing'], ['cashLikeItems', 'amountMissing']]);
    assert.match(w[0].message, /デットライク項目「リース債務」：根拠未記載/);
    for (const q of getSampleMultiData().periods) assert.deepEqual(getNetDebtItemWarnings(q), []);
    assert.deepEqual(getNetDebtItemWarnings(createEmptyPeriod('')), []);
  });
});

describe('ネットデット内訳表', () => {
  test('名称ごとに全期をそろえ、現預金・キャッシュライクは減算（負の値）', () => {
    const b = buildNetDebtBreakdown(getSampleMultiData());
    const get = (id) => b.rows.find((r) => r.id === id).values;
    assert.deepEqual(get('interestBearingDebt'), [44000, 42000, 40000]);
    assert.deepEqual(get('debt:退職給付引当金'), [2600, 2800, 3000]);
    assert.deepEqual(get('debt:未払法人税等'), [null, null, 1500]);
    assert.deepEqual(get('cash'), [-14000, -17000, -20000]);
    assert.deepEqual(get('cashLike:定期預金'), [null, -2000, -2000]);
    assert.deepEqual(get('adjustedNetDebt'), [32600, 25800, 22500]);
    assert.deepEqual(get('netDebt'), [30000, 25000, 20000]);
  });
  test('内訳の合計 = 調整後ネットデット', () => {
    const b = buildNetDebtBreakdown(getSampleMultiData());
    const parts = b.rows.filter((r) => ['base', 'debtLike', 'cash', 'cashLike'].includes(r.kind));
    b.labels.forEach((_, i) => {
      const sum = parts.reduce((s, r) => s + (r.values[i] ?? 0), 0);
      assert.equal(sum, b.rows.find((r) => r.id === 'adjustedNetDebt').values[i]);
    });
  });
  test('同じ名称の項目は合算、名称未入力もまとめる', () => {
    const p = basePeriod();
    p.debtLikeItems = [item('リース債務', 100), item('リース債務', 200), item('', 50)];
    const b = buildNetDebtBreakdown({ periods: [p] });
    assert.deepEqual(b.rows.find((r) => r.id === 'debt:リース債務').values, [300]);
    assert.deepEqual(b.rows.find((r) => r.id === 'debt:（名称未入力）').values, [50]);
  });
  test('比較表に運転資本・調整後ネットデットの行がある', () => {
    const cmp = buildComparison(getSampleMultiData());
    const get = (id) => cmp.rows.find((r) => r.id === id);
    assert.deepEqual(get('workingCapital').cells.map((c) => c.result.value), [16100, 16900, 17000]);
    assert.deepEqual(get('adjustedNetDebt').cells.map((c) => c.result.value), [32600, 25800, 22500]);
    near(get('adjustedNetDebtToNormalizedEbitda').cells[2].result.value, 22500 / 18400);
    assert.equal(get('adjustedNetDebt').cells[2].change.amount, -3300);
  });
});

describe('データ移行 version 2 → 3', () => {
  const v2 = () => ({
    version: 2,
    companyName: 'v2社',
    periods: [{
      label: '2025/3期',
      pl: { sales: 100 }, bs: { cash: 10, interestBearingDebt: 30 },
      adjustments: [{ id: 'a1', category: 'oneTime', description: 'x', amount: 5, memo: 'm' }],
      debtLikeItems: [],
    }],
  });
  test('cashLikeItems を追加し、version 3 にする（他の値は保持、元データは不変）', () => {
    const src = v2();
    const d = migrateV2toV3(src);
    assert.equal(d.version, 3);
    assert.deepEqual(d.periods[0].cashLikeItems, []);
    assert.deepEqual(d.periods[0].debtLikeItems, []);
    assert.equal(d.periods[0].adjustments[0].amount, 5);
    assert.equal(src.version, 2);
    assert.equal(src.periods[0].cashLikeItems, undefined);
  });
  test('v2 のデットライク項目らしきものは形をそろえて引き継ぐ', () => {
    const src = v2();
    src.periods[0].debtLikeItems = [{ name: 'リース債務', amount: 7 }, 3];
    const d = migrateV2toV3(src);
    assert.equal(d.periods[0].debtLikeItems.length, 1);
    assert.equal(d.periods[0].debtLikeItems[0].memo, '');
    assert.equal(typeof d.periods[0].debtLikeItems[0].id, 'string');
  });
  test('migrate は v1 → v2 → v3 → v4 → v5 → v6 → v7 と順に移行する', () => {
    const v1 = { version: 1, periods: [{ label: '', pl: {}, bs: {}, adjustments: [], debtLikeItems: [] }] };
    const d = normalizeData(migrate(v1));
    assert.equal(d.version, CURRENT_VERSION);
    assert.equal(CURRENT_VERSION, 7);
    assert.deepEqual(d.periods[0].cashLikeItems, []);
  });
  test('v2 のバックアップを復元でき、調整後ネットデット = ネットデット', () => {
    const r = parseBackup(JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: null, data: v2() }));
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 7);
    assert.equal(calcAdjustedNetDebt(r.data.periods[0]).adjusted, 20);
  });
  test('v3 バックアップの往復・不正な項目の拒否', () => {
    const d = getSampleMultiData();
    assert.deepEqual(parseBackup(backupToJson(d)).data, d);
    d.periods[2].cashLikeItems[0].amount = 'abc';
    assert.match(validateData(d).join(), /cashLikeItems\[0\]\.amount が数値ではありません/);
    assert.equal(parseBackup(backupToJson(d)).ok, false);
  });
});

describe('項目の操作', () => {
  test('追加・更新・削除（元データは不変）、不明なリストは無視', () => {
    const d0 = getSampleData();
    const it = createLineItem('リース債務');
    const d1 = addLineItem(d0, 0, 'debtLikeItems', it);
    assert.equal(d1.periods[0].debtLikeItems.length, 3);
    assert.equal(d0.periods[0].debtLikeItems.length, 2);
    const d2 = updateLineItem(d1, 0, 'debtLikeItems', it.id, { amount: 900 });
    assert.equal(d2.periods[0].debtLikeItems[2].amount, 900);
    assert.equal(removeLineItem(d2, 0, 'debtLikeItems', it.id).periods[0].debtLikeItems.length, 2);
    assert.equal(addLineItem(d0, 0, 'adjustments', it), d0);
    assert.equal(calcAdjustedNetDebt(d2.periods[0]).adjusted, 22500 + 900);
  });
});
