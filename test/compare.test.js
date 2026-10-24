import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDICATORS, KEY_AMOUNTS, CHART_ROWS, MAX_PERIODS,
  calcIndicators, averageBs, changeOf, formatChangeAmount, formatChangeRate, buildComparison,
} from '../js/calc.js';
import {
  getSampleData, getSampleMultiData, createEmptyData, normalizeData,
  addPeriod, removePeriod, movePeriod, renamePeriod, suggestNextLabel,
} from '../js/store.js';

const EPS = 1e-9;
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, `${msg ?? ''} expected ${expected}, got ${actual}`);
}

describe('changeOf（前期比）', () => {
  test('通常：増減額と増減率', () => {
    const c = changeOf(110, 100);
    assert.equal(c.amount, 10);
    near(c.rate, 0.1);
    assert.equal(c.rateStatus, 'ok');
  });
  test('減少', () => {
    const c = changeOf(80, 100);
    assert.equal(c.amount, -20);
    near(c.rate, -0.2);
  });
  test('前期が0：増減額は計算、増減率は「—」', () => {
    const c = changeOf(50, 0);
    assert.equal(c.amount, 50);
    assert.equal(c.rate, null);
    assert.equal(c.rateStatus, 'na');
    assert.equal(formatChangeRate(c), '—');
  });
  test('前期がマイナス：増減額は計算、増減率は「参考外」', () => {
    const c = changeOf(100, -50);
    assert.equal(c.amount, 150);
    assert.equal(c.rate, null);
    assert.equal(c.rateStatus, 'notApplicable');
    assert.equal(formatChangeRate(c), '参考外');
  });
  test('前期がマイナス・当期もマイナス：増減率は「参考外」', () => {
    assert.equal(changeOf(-30, -50).rateStatus, 'notApplicable');
  });
  test('当期がマイナス・前期がプラス：増減率は計算する', () => {
    const c = changeOf(-50, 100);
    near(c.rate, -1.5);
    assert.equal(formatChangeRate(c), '-150.0%');
  });
  test('未入力：増減額・増減率とも「—」', () => {
    for (const c of [changeOf(null, 100), changeOf(100, null), changeOf(null, null)]) {
      assert.equal(c.amount, null);
      assert.equal(c.rateStatus, 'na');
      assert.equal(formatChangeAmount(c, '千円'), '—');
      assert.equal(formatChangeRate(c), '—');
    }
  });
  test('表示：符号、% 指標はポイント表示', () => {
    assert.equal(formatChangeAmount(changeOf(110000, 100000), '千円'), '+10,000千円');
    assert.equal(formatChangeAmount(changeOf(90000, 100000), '千円'), '-10,000千円');
    assert.equal(formatChangeAmount(changeOf(0.12, 0.1), '%'), '+2.0pt');
    assert.equal(formatChangeAmount(changeOf(0.1, 0.12), '%'), '-2.0pt');
    assert.equal(formatChangeAmount(changeOf(1.5, 1.25), '倍'), '+0.25倍');
    assert.equal(formatChangeAmount(changeOf(60, 60), '日'), '0.0日');
    assert.equal(formatChangeRate(changeOf(110, 100)), '+10.0%');
    assert.equal(formatChangeRate(changeOf(100, 100)), '0.0%');
    assert.equal(formatChangeAmount(null, '%'), '—');
    assert.equal(formatChangeRate(null), '—');
  });
  test('ごく小さな増加は「+0.0」にしない', () => {
    assert.equal(formatChangeAmount({ amount: 0.00001 }, '%'), '0.0pt');
  });
});

describe('平均残高ベース', () => {
  const multi = getSampleMultiData();
  const [p2023, p2024, p2025] = multi.periods;

  test('averageBs：(前期末 + 当期末) ÷ 2', () => {
    const avg = averageBs(p2025.bs, p2024.bs);
    assert.equal(avg.netAssets, (40000 + 32200) / 2);
    assert.equal(avg.totalAssets, (100000 + 95000) / 2);
  });
  test('averageBs：前期なし・片方未入力は null', () => {
    assert.ok(Object.values(averageBs(p2025.bs, undefined)).every((v) => v === null));
    const bs = { ...p2025.bs, cash: null };
    assert.equal(averageBs(bs, p2024.bs).cash, null);
  });
  test('ROE・ROA・回転日数・CCC が平均残高で計算される（手計算）', () => {
    const r = calcIndicators(p2025, { basis: 'average', prevPeriod: p2024 });
    near(r.roe.value, 6000 / 36100);
    near(r.roa.value, 9000 / 97500);
    near(r.receivableDays.value, 14600 / 100000 * 365);
    near(r.inventoryDays.value, 10150 / 60000 * 365);
    near(r.payableDays.value, 7800 / 60000 * 365);
    near(r.ccc.value, (14600 / 100000 + 10150 / 60000 - 7800 / 60000) * 365);
  });
  test('平均対象外の指標は期末残高のまま', () => {
    const end = calcIndicators(p2025);
    const avg = calcIndicators(p2025, { basis: 'average', prevPeriod: p2024 });
    for (const ind of INDICATORS.filter((i) => !i.averageable)) {
      assert.deepEqual(avg[ind.id], end[ind.id], ind.id);
    }
  });
  test('平均対象は ROA・ROE・回転日数3つ・CCC', () => {
    assert.deepEqual(INDICATORS.filter((i) => i.averageable).map((i) => i.id).sort(),
      ['ccc', 'inventoryDays', 'payableDays', 'receivableDays', 'roa', 'roe']);
  });
  test('前期データがない期は平均対象が「—」', () => {
    const r = calcIndicators(p2023, { basis: 'average' });
    for (const id of ['roe', 'roa', 'receivableDays', 'inventoryDays', 'payableDays', 'ccc']) {
      assert.equal(r[id].status, 'na', id);
    }
    assert.equal(r.operatingMargin.status, 'ok');
  });
  test('期末ベース（既定）と平均ベースの切り替え', () => {
    const end = calcIndicators(p2025, { basis: 'end', prevPeriod: p2024 });
    near(end.roe.value, 0.15);
    const noOpt = calcIndicators(p2025);
    assert.deepEqual(noOpt, end);
    const avg = calcIndicators(p2025, { basis: 'average', prevPeriod: p2024 });
    assert.notEqual(avg.roe.value, end.roe.value);
  });
  test('平均自己資本がマイナスなら ROE は参考外', () => {
    const prev = { ...p2024, bs: { ...p2024.bs, netAssets: -50000 } };
    const r = calcIndicators(p2025, { basis: 'average', prevPeriod: prev });
    assert.equal(r.roe.status, 'notApplicable');
  });
});

describe('buildComparison（比較表）', () => {
  test('行 = 主要数値 + 全指標、列 = 各期', () => {
    const cmp = buildComparison(getSampleMultiData());
    assert.deepEqual(cmp.labels, ['2023/3期', '2024/3期', '2025/3期']);
    assert.equal(cmp.rows.length, KEY_AMOUNTS.length + INDICATORS.length);
    for (const row of cmp.rows) assert.equal(row.cells.length, 3, row.id);
    for (const id of CHART_ROWS) assert.ok(cmp.rows.find((r) => r.id === id), id);
  });
  test('前期比：先頭の期は null、以降は前の列との差', () => {
    const cmp = buildComparison(getSampleMultiData());
    const sales = cmp.rows.find((r) => r.id === 'sales');
    assert.equal(sales.cells[0].change, null);
    assert.equal(sales.cells[1].change.amount, 9000);
    near(sales.cells[1].change.rate, 9000 / 82000);
    assert.equal(sales.cells[2].change.amount, 9000);
    const gp = cmp.rows.find((r) => r.id === 'grossProfit');
    assert.equal(gp.cells[2].result.value, 40000);
  });
  test('平均ベース：先頭の期の平均対象は「—」で前期比も「—」', () => {
    const cmp = buildComparison(getSampleMultiData(), 'average');
    const roe = cmp.rows.find((r) => r.id === 'roe');
    assert.equal(roe.averageable, true);
    assert.equal(roe.cells[0].result.status, 'na');
    assert.equal(roe.cells[1].result.status, 'ok');
    near(roe.cells[1].result.value, 4200 / ((32200 + 28000) / 2));
    assert.equal(roe.cells[1].change.amount, null);
    assert.equal(roe.cells[2].change.rateStatus, 'ok');
  });
  test('Phase 1 互換：単一期でも表示でき、値は Phase 1 と一致', () => {
    const data = getSampleData();
    const cmp = buildComparison(data);
    assert.deepEqual(cmp.labels, ['2025/3期']);
    const p1 = calcIndicators(data.periods[0]);
    for (const ind of INDICATORS) {
      const row = cmp.rows.find((r) => r.id === ind.id);
      assert.deepEqual(row.cells[0].result, p1[ind.id], ind.id);
      assert.equal(row.cells[0].change, null);
    }
  });
  test('Phase 1 の保存データ（1期）をそのまま読める', () => {
    const v1 = JSON.parse(JSON.stringify(getSampleData()));
    assert.deepEqual(normalizeData(v1), getSampleData());
  });
  test('空データでも例外にならない', () => {
    const cmp = buildComparison(createEmptyData(), 'average');
    assert.equal(cmp.rows[0].cells[0].result.status, 'na');
    assert.deepEqual(buildComparison({ periods: [] }).labels, []);
  });
  test('前期がマイナスの金額行は増減率が参考外', () => {
    const data = getSampleMultiData();
    data.periods[1].pl.netIncome = -1000;
    const cmp = buildComparison(data);
    const ni = cmp.rows.find((r) => r.id === 'netIncome');
    assert.equal(ni.cells[2].change.amount, 7000);
    assert.equal(ni.cells[2].change.rateStatus, 'notApplicable');
  });
});

describe('期の操作', () => {
  test('suggestNextLabel', () => {
    assert.equal(suggestNextLabel('2025/3期'), '2026/3期');
    assert.equal(suggestNextLabel('2024年12月期'), '2025年12月期');
    assert.equal(suggestNextLabel('前期'), '');
    assert.equal(suggestNextLabel(undefined), '');
  });
  test('addPeriod：末尾に空の期を追加し、元データは変更しない', () => {
    const d = getSampleData();
    const next = addPeriod(d);
    assert.equal(next.periods.length, 2);
    assert.equal(next.periods[1].label, '2026/3期');
    assert.equal(next.periods[1].pl.sales, null);
    assert.equal(d.periods.length, 1);
  });
  test(`addPeriod：最大${MAX_PERIODS}期`, () => {
    let d = getSampleData();
    for (let i = 0; i < 10; i++) d = addPeriod(d);
    assert.equal(d.periods.length, MAX_PERIODS);
    assert.equal(addPeriod(d), d);
  });
  test('removePeriod', () => {
    const d = getSampleMultiData();
    const next = removePeriod(d, 1);
    assert.deepEqual(next.periods.map((p) => p.label), ['2023/3期', '2025/3期']);
    assert.equal(d.periods.length, 3);
    assert.equal(removePeriod(d, 9), d);
  });
  test('removePeriod：最後の1期は空にする', () => {
    const next = removePeriod(getSampleData(), 0);
    assert.equal(next.periods.length, 1);
    assert.equal(next.periods[0].pl.sales, null);
  });
  test('movePeriod：前後に移動、範囲外は変更なし', () => {
    const d = getSampleMultiData();
    assert.deepEqual(movePeriod(d, 2, -1).periods.map((p) => p.label), ['2023/3期', '2025/3期', '2024/3期']);
    assert.deepEqual(movePeriod(d, 0, 1).periods.map((p) => p.label), ['2024/3期', '2023/3期', '2025/3期']);
    assert.equal(movePeriod(d, 0, -1), d);
    assert.equal(movePeriod(d, 2, 1), d);
    assert.deepEqual(d.periods.map((p) => p.label), ['2023/3期', '2024/3期', '2025/3期']);
  });
  test('renamePeriod', () => {
    const d = getSampleData();
    assert.equal(renamePeriod(d, 0, 'FY2025').periods[0].label, 'FY2025');
    assert.equal(d.periods[0].label, '2025/3期');
  });
  test('複数期サンプル：最終期は単一期サンプルと同じ・全期で貸借一致', async () => {
    const { getWarnings } = await import('../js/calc.js');
    const m = getSampleMultiData();
    assert.deepEqual(m.periods[2], getSampleData().periods[0]);
    for (const p of m.periods) assert.deepEqual(getWarnings(p), [], p.label);
    assert.deepEqual(normalizeData(m), m);
  });
});
