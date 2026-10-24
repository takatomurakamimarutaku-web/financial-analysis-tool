import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDICATORS, CATEGORIES, safeDiv, sumOf, diff, parseAmount, isInsolvent,
  calcIndicators, checkBalance, getWarnings, formatValue, formatAmount, buildResultText,
} from '../js/calc.js';
import { getSampleData, createEmptyPeriod } from '../js/store.js';

const EPS = 1e-9;
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, `${msg ?? ''} expected ${expected}, got ${actual}`);
}

function sample() {
  return getSampleData().periods[0];
}

function withBs(overrides) {
  const p = sample();
  Object.assign(p.bs, overrides);
  return p;
}

function withPl(overrides) {
  const p = sample();
  Object.assign(p.pl, overrides);
  return p;
}

describe('基本関数', () => {
  test('safeDiv: 分母0・未入力は null', () => {
    assert.equal(safeDiv(1, 0), null);
    assert.equal(safeDiv(null, 5), null);
    assert.equal(safeDiv(5, null), null);
    assert.equal(safeDiv(5, undefined), null);
    assert.equal(safeDiv(NaN, 1), null);
    assert.equal(safeDiv(6, 3), 2);
    assert.equal(safeDiv(-6, 3), -2);
  });
  test('sumOf / diff: 1つでも未入力なら null', () => {
    assert.equal(sumOf(1, 2, 3), 6);
    assert.equal(sumOf(1, null), null);
    assert.equal(diff(5, 3), 2);
    assert.equal(diff(5, null), null);
  });
});

describe('parseAmount', () => {
  const cases = [
    ['1,234', 1234],
    ['１２３', 123],
    ['１，２３４．５', 1234.5],
    ['-500', -500],
    ['−500', -500],
    ['△500', -500],
    ['▲1,000', -1000],
    [' 42 ', 42],
    ['0', 0],
    ['12.5', 12.5],
    ['', null],
    ['   ', null],
    ['-', null],
    ['abc', null],
    ['1-2', null],
    ['1.2.3', null],
    [null, null],
    [undefined, null],
    [7, 7],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(parseAmount(input), expected);
    });
  }
});

describe('サンプルデータの全指標（手計算の期待値）', () => {
  // 売上高100,000 原価60,000 営業利益10,000 経常9,000 純利益6,000 減価償却5,000 支払利息1,000
  // 現預金20,000 債権15,000 棚卸10,000 流動資産50,000 固定資産50,000 総資産100,000
  // 仕入債務8,000 流動負債30,000 固定負債30,000 有利子負債40,000 純資産40,000
  const expected = {
    grossMargin: 0.4,
    operatingMargin: 0.1,
    ordinaryMargin: 0.09,
    roa: 0.09,
    roe: 0.15,
    currentRatio: 50000 / 30000,
    quickRatio: 35000 / 30000,
    equityRatio: 0.4,
    fixedRatio: 1.25,
    fixedLongTermRatio: 50000 / 70000,
    deRatio: 1,
    icr: 10,
    assetTurnover: 1,
    receivableDays: 54.75,
    inventoryDays: 10000 / 60000 * 365,
    payableDays: 8000 / 60000 * 365,
    ccc: 54.75 + 730 / 60,
    ebitda: 15000,
    netDebt: 20000,
    netDebtToEbitda: 20000 / 15000,
  };
  const results = calcIndicators(sample());

  test('期待値が全指標を網羅している', () => {
    assert.deepEqual(Object.keys(expected).sort(), INDICATORS.map((i) => i.id).sort());
  });
  for (const [id, v] of Object.entries(expected)) {
    test(id, () => {
      assert.equal(results[id].status, 'ok');
      near(results[id].value, v, id);
    });
  }

  test('表示用の丸め（表示時のみ）', () => {
    const shown = Object.fromEntries(INDICATORS.map((i) => [i.id, formatValue(results[i.id], i.unit)]));
    assert.deepEqual(shown, {
      grossMargin: '40.0%',
      operatingMargin: '10.0%',
      ordinaryMargin: '9.0%',
      roa: '9.0%',
      roe: '15.0%',
      currentRatio: '166.7%',
      quickRatio: '116.7%',
      equityRatio: '40.0%',
      fixedRatio: '125.0%',
      fixedLongTermRatio: '71.4%',
      deRatio: '1.00倍',
      icr: '10.00倍',
      assetTurnover: '1.00回',
      receivableDays: '54.8日',
      inventoryDays: '60.8日',
      payableDays: '48.7日',
      ccc: '66.9日',
      ebitda: '15,000千円',
      netDebt: '20,000千円',
      netDebtToEbitda: '1.33倍',
    });
  });

  test('内部値は丸められていない', () => {
    near(results.currentRatio.value, 1.6666666666666667);
    near(results.ccc.value, 66.91666666666667);
  });
});

describe('分母0', () => {
  test('売上高0：売上高を分母とする指標は「—」、他は計算される', () => {
    const r = calcIndicators(withPl({ sales: 0 }));
    for (const id of ['grossMargin', 'operatingMargin', 'ordinaryMargin', 'receivableDays', 'ccc']) {
      assert.equal(r[id].status, 'na', id);
      assert.equal(formatValue(r[id], '%'), '—');
    }
    assert.equal(r.assetTurnover.status, 'ok');
    assert.equal(r.assetTurnover.value, 0);
    assert.equal(r.roe.status, 'ok');
  });
  test('支払利息0：ICRは「—」', () => {
    const r = calcIndicators(withPl({ interestExpense: 0 }));
    assert.equal(r.icr.status, 'na');
  });
  test('売上原価0：棚卸・仕入債務回転日数とCCCは「—」', () => {
    const r = calcIndicators(withPl({ costOfSales: 0 }));
    assert.equal(r.inventoryDays.status, 'na');
    assert.equal(r.payableDays.status, 'na');
    assert.equal(r.ccc.status, 'na');
    assert.equal(r.receivableDays.status, 'ok');
  });
  test('流動負債0：流動比率・当座比率は「—」', () => {
    const r = calcIndicators(withBs({ currentLiabilities: 0 }));
    assert.equal(r.currentRatio.status, 'na');
    assert.equal(r.quickRatio.status, 'na');
  });
  test('総資産0：ROA・自己資本比率・総資産回転率は「—」', () => {
    const r = calcIndicators(withBs({ totalAssets: 0 }));
    assert.equal(r.roa.status, 'na');
    assert.equal(r.equityRatio.status, 'na');
    assert.equal(r.assetTurnover.status, 'na');
  });
  test('自己資本0（債務超過ではない）：ROE・D/E・固定比率は「—」', () => {
    const r = calcIndicators(withBs({ netAssets: 0 }));
    assert.equal(r.roe.status, 'na');
    assert.equal(r.deRatio.status, 'na');
    assert.equal(r.fixedRatio.status, 'na');
    assert.equal(r.equityRatio.status, 'ok');
    assert.equal(r.equityRatio.value, 0);
  });
  test('EBITDA0：ネットデット÷EBITDAは「—」', () => {
    const r = calcIndicators(withPl({ operatingIncome: -5000 }));
    assert.equal(r.ebitda.value, 0);
    assert.equal(r.netDebtToEbitda.status, 'na');
  });
});

describe('未入力', () => {
  test('全項目未入力でも例外にならず、全指標が「—」', () => {
    const r = calcIndicators(createEmptyPeriod('2025/3期'));
    for (const ind of INDICATORS) {
      assert.equal(r[ind.id].status, 'na', ind.id);
      assert.equal(formatValue(r[ind.id], ind.unit), '—');
    }
    assert.deepEqual(getWarnings(createEmptyPeriod('')), []);
  });
  test('period 自体が undefined でも例外にならない', () => {
    const r = calcIndicators(undefined);
    assert.equal(r.roe.status, 'na');
  });
  test('一部未入力：その項目を使う指標だけ「—」', () => {
    const r = calcIndicators(withBs({ cash: null }));
    assert.equal(r.quickRatio.status, 'na');
    assert.equal(r.netDebt.status, 'na');
    assert.equal(r.netDebtToEbitda.status, 'na');
    assert.equal(r.currentRatio.status, 'ok');
  });
  test('減価償却費未入力：EBITDAは「—」（0とみなさない）', () => {
    const r = calcIndicators(withPl({ depreciation: null }));
    assert.equal(r.ebitda.status, 'na');
  });
});

describe('マイナス値', () => {
  test('赤字：利益率・ICRはマイナス値のまま表示', () => {
    const r = calcIndicators(withPl({ operatingIncome: -2000, ordinaryIncome: -3000, netIncome: -4000 }));
    near(r.operatingMargin.value, -0.02);
    near(r.ordinaryMargin.value, -0.03);
    near(r.roe.value, -0.1);
    near(r.icr.value, -2);
    assert.equal(formatValue(r.operatingMargin, '%'), '-2.0%');
    assert.equal(formatValue(r.icr, '倍'), '-2.00倍');
  });
  test('債務超過：ROE・D/E・固定比率は「参考外」、自己資本比率はマイナス表示', () => {
    // 純資産 -10,000、固定負債 80,000 → 自己資本+固定負債 = 70,000 (>0)
    const p = withBs({ netAssets: -10000, fixedLiabilities: 80000 });
    assert.equal(isInsolvent(p.bs), true);
    const r = calcIndicators(p);
    for (const id of ['roe', 'deRatio', 'fixedRatio']) {
      assert.equal(r[id].status, 'notApplicable', id);
      assert.equal(formatValue(r[id], '%'), '参考外');
    }
    near(r.equityRatio.value, -0.1);
    assert.equal(formatValue(r.equityRatio, '%'), '-10.0%');
    assert.equal(r.fixedLongTermRatio.status, 'ok');
    near(r.fixedLongTermRatio.value, 50000 / 70000);
  });
  test('自己資本+固定負債がマイナス：固定長期適合率は「参考外」', () => {
    const r = calcIndicators(withBs({ netAssets: -50000, fixedLiabilities: 30000 }));
    assert.equal(r.fixedLongTermRatio.status, 'notApplicable');
  });
  test('債務超過の警告', () => {
    const w = getWarnings(withBs({ netAssets: -10000, fixedLiabilities: 80000 }));
    const insolvent = w.find((x) => x.type === 'insolvent');
    assert.ok(insolvent);
    assert.match(insolvent.message, /債務超過/);
    assert.match(insolvent.message, /ROE/);
  });
  test('EBITDAマイナス：ネットデット÷EBITDAは「参考外」', () => {
    const r = calcIndicators(withPl({ operatingIncome: -8000 }));
    assert.equal(r.ebitda.value, -3000);
    assert.equal(r.netDebtToEbitda.status, 'notApplicable');
  });
  test('ネットキャッシュ：ネットデット・倍率はマイナス値', () => {
    const r = calcIndicators(withBs({ cash: 70000, interestBearingDebt: 40000 }));
    assert.equal(r.netDebt.value, -30000);
    near(r.netDebtToEbitda.value, -2);
    assert.equal(formatValue(r.netDebt, '千円'), '-30,000千円');
  });
});

describe('貸借チェック', () => {
  test('一致していれば警告なし', () => {
    assert.deepEqual(checkBalance(sample().bs), { assetsDiff: 0, liabEquityDiff: 0 });
    assert.deepEqual(getWarnings(sample()), []);
  });
  test('資産側の不一致：差額を表示', () => {
    const p = withBs({ fixedAssets: 49000 });
    assert.equal(checkBalance(p.bs).assetsDiff, 1000);
    const w = getWarnings(p);
    assert.equal(w.length, 1);
    assert.equal(w[0].type, 'assetsMismatch');
    assert.match(w[0].message, /差額 1,000千円/);
  });
  test('負債純資産側の不一致：差額（マイナス）を表示', () => {
    const p = withBs({ netAssets: 42500 });
    assert.equal(checkBalance(p.bs).liabEquityDiff, -2500);
    const w = getWarnings(p);
    assert.equal(w.length, 1);
    assert.equal(w[0].type, 'liabEquityMismatch');
    assert.match(w[0].message, /差額 -2,500千円/);
  });
  test('必要項目が未入力なら判定しない', () => {
    assert.deepEqual(checkBalance(withBs({ totalAssets: null }).bs), { assetsDiff: null, liabEquityDiff: null });
    assert.deepEqual(getWarnings(withBs({ fixedLiabilities: null })), []);
  });
  test('浮動小数点誤差では警告しない', () => {
    const p = withBs({ currentAssets: 0.1, fixedAssets: 0.2, totalAssets: 0.3,
      currentLiabilities: 0.1, fixedLiabilities: 0.1, netAssets: 0.1 });
    assert.deepEqual(getWarnings(p).filter((w) => w.type !== 'insolvent'), []);
  });
});

describe('表示・テキスト出力', () => {
  test('formatAmount', () => {
    assert.equal(formatAmount(1234567), '1,234,567');
    assert.equal(formatAmount(null), '—');
    assert.equal(formatAmount(-0.4), '0');
  });
  test('formatValue: 未計算・参考外', () => {
    assert.equal(formatValue({ value: null, status: 'na' }, '%'), '—');
    assert.equal(formatValue({ value: null, status: 'notApplicable' }, '倍'), '参考外');
    assert.equal(formatValue(undefined, '%'), '—');
  });
  test('buildResultText: 会社名・全カテゴリ・全指標・警告を含む', () => {
    const data = getSampleData();
    const p = data.periods[0];
    p.bs.netAssets = -10000;
    const text = buildResultText(data, calcIndicators(p), getWarnings(p));
    assert.match(text, /サンプル株式会社 2025\/3期/);
    for (const c of CATEGORIES) assert.match(text, new RegExp(`■ ${c.name}`));
    for (const i of INDICATORS) assert.ok(text.includes(`${i.name}：`), i.name);
    assert.match(text, /■ 警告/);
    assert.match(text, /ROE（自己資本利益率）：参考外/);
  });
  test('buildResultText: 未入力でも生成でき「—」を含む', () => {
    const data = { companyName: '', periods: [createEmptyPeriod('')] };
    const text = buildResultText(data, calcIndicators(data.periods[0]));
    assert.match(text, /会社名未入力/);
    assert.match(text, /営業利益率：—/);
  });
});
