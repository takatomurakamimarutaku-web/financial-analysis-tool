import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASH_FLOW_ROWS, buildCashFlowSeries, buildComparisonWithCashFlow, calcCashFlowIndicators, cashFlowBadge, estimateCashFlow,
  isBalanced, otherCurrentAssets, otherLiabilities,
} from '../js/cashflow.js';
import { buildComparison, formatValue } from '../js/calc.js';
import { buildComparisonCsv } from '../js/csv.js';
import { createDefaultEvaluation } from '../js/badges.js';
import { hasHelp, indicatorHelp } from '../js/help.js';
import { formatOptions } from '../js/settings.js';
import { getSampleMultiData } from '../js/store.js';

const sample = () => getSampleMultiData();

describe('推計CF：サンプルの検算値（設計案の手計算と一致）', () => {
  test('2024/3期：営業 10,600・投資 △5,600・財務 △2,000、2025/3期：9,200・△6,000・△200', () => {
    const s = buildCashFlowSeries(sample());
    assert.equal(s[0].cf.status, 'noPrev');
    assert.deepEqual([s[1].cf.operating, s[1].cf.investing, s[1].cf.financing], [10600, -5600, -2000]);
    assert.deepEqual([s[2].cf.operating, s[2].cf.investing, s[2].cf.financing], [9200, -6000, -200]);
    for (const i of [1, 2]) {
      assert.equal(s[i].cf.total, 3000);
      assert.equal(s[i].cf.cashChange, 3000);
      assert.equal(s[i].cf.check, 0);
    }
  });
  test('指標：FCF・簡易CF・営業CFマージン・債務償還年数', () => {
    const s = buildCashFlowSeries(sample());
    assert.deepEqual([s[1].fcf.value, s[2].fcf.value], [5000, 3200]);
    assert.deepEqual([s[1].simpleCf.value, s[2].simpleCf.value], [8800, 11000]);
    assert.equal(Math.round(s[1].operatingCfMargin.value * 1000) / 10, 11.6);
    assert.equal(Math.round(s[2].operatingCfMargin.value * 1000) / 10, 9.2);
    assert.equal(formatValue(s[1].debtRedemptionYears, '年', formatOptions(sample().settings)), '4.8年');
    assert.equal(formatValue(s[2].debtRedemptionYears, '年', formatOptions(sample().settings)), '3.6年');
    assert.equal(s[2].capex.value, 6000);
  });
  test('簡易CF・債務償還年数は前期がなくても出す。前期が必要な指標は「—」', () => {
    const s = buildCashFlowSeries(sample())[0];
    assert.equal(s.simpleCf.status, 'ok');
    assert.equal(s.debtRedemptionYears.status, 'ok');
    assert.equal(s.fcf.status, 'na');
    assert.equal(s.operatingCf.status, 'na');
    assert.equal(s.normalizedEbitdaLessCapex.status, 'na');
  });
  test('正常化EBITDA − 設備投資額（参考）', () => {
    const s = buildCashFlowSeries(sample());
    // 2025/3期：正常化EBITDA 18,400 − 設備投資 6,000
    assert.equal(s[2].normalizedEbitdaLessCapex.value, 12400);
  });
});

// 貸借が一致する BS を乱数で作る
function rnd(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}
function randomBs(r) {
  const n = (max) => Math.round(r() * max);
  const cash = n(50000);
  const receivables = n(40000);
  const inventory = n(30000);
  const currentAssets = cash + receivables + inventory + n(10000);
  const fixedAssets = n(80000);
  const payables = n(30000);
  const interestBearingDebt = n(60000);
  const currentLiabilities = payables + n(20000) + Math.round(interestBearingDebt / 3);
  const fixedLiabilities = interestBearingDebt - Math.round(interestBearingDebt / 3) + n(10000);
  const netAssets = currentAssets + fixedAssets - currentLiabilities - fixedLiabilities;
  return {
    cash, receivables, inventory, currentAssets, fixedAssets, totalAssets: currentAssets + fixedAssets,
    payables, currentLiabilities, fixedLiabilities, interestBearingDebt, netAssets,
  };
}

describe('推計CF：検算（営業＋投資＋財務 ＝ 現預金の増減）', () => {
  test('貸借が一致していれば、どんな BS・PL でも合計が現預金の増減に一致する（200通り）', () => {
    const r = rnd(42);
    for (let k = 0; k < 200; k++) {
      const prev = { pl: {}, bs: randomBs(r) };
      const cur = { pl: { netIncome: Math.round(r() * 20000 - 5000), depreciation: Math.round(r() * 5000), sales: 100000 }, bs: randomBs(r) };
      const cf = estimateCashFlow(cur, prev);
      assert.equal(cf.status, 'ok');
      assert.ok(Math.abs(cf.check) < 1e-6, `case ${k}: ${cf.check}`);
      assert.ok(isBalanced(cur.bs));
    }
  });
  test('増資・配当（利益以外の純資産の増減）は財務CFに入る', () => {
    const d = sample();
    const prev = d.periods[1];
    const cur = JSON.parse(JSON.stringify(d.periods[2]));
    // 配当 500：純資産 −500、現預金 −500（流動資産・総資産も −500）
    cur.bs.netAssets -= 500;
    cur.bs.cash -= 500;
    cur.bs.currentAssets -= 500;
    cur.bs.totalAssets -= 500;
    const before = estimateCashFlow(d.periods[2], prev);
    const after = estimateCashFlow(cur, prev);
    assert.equal(after.financing, before.financing - 500);
    assert.equal(after.operating, before.operating);
    assert.equal(after.lines.financing.find((l) => l.id === 'equityOther').value, 1800 - 500);
    assert.equal(after.check, 0);
  });
  test('差額の科目：その他流動資産・その他負債', () => {
    const bs = sample().periods[2].bs;
    assert.equal(otherCurrentAssets(bs), bs.currentAssets - bs.cash - bs.receivables - bs.inventory);
    assert.equal(otherLiabilities(bs), bs.currentLiabilities + bs.fixedLiabilities - bs.payables - bs.interestBearingDebt);
  });
});

describe('推計CF：推計しない場合', () => {
  test('前期なし・未入力・貸借不一致は推計せず理由を返す', () => {
    const d = sample();
    assert.equal(estimateCashFlow(d.periods[2], null).status, 'noPrev');
    const cur = JSON.parse(JSON.stringify(d.periods[2]));
    cur.bs.inventory = null;
    const m = estimateCashFlow(cur, d.periods[1]);
    assert.equal(m.status, 'missing');
    assert.deepEqual(m.missing, [{ section: 'bs', key: 'inventory', when: 'current' }]);
    const prev = JSON.parse(JSON.stringify(d.periods[1]));
    prev.pl.depreciation = null;
    assert.equal(estimateCashFlow(d.periods[2], prev).status, 'ok', '前期のPLは使わない');
    prev.bs.payables = null;
    assert.deepEqual(estimateCashFlow(d.periods[2], prev).missing, [{ section: 'bs', key: 'payables', when: 'prev' }]);
    const unb = JSON.parse(JSON.stringify(d.periods[2]));
    unb.bs.netAssets += 1;
    assert.equal(estimateCashFlow(unb, d.periods[1]).status, 'unbalanced');
  });
  test('簡易CFが0以下なら債務償還年数は参考外', () => {
    const p = JSON.parse(JSON.stringify(sample().periods[2]));
    p.pl.netIncome = -p.pl.depreciation;
    assert.equal(calcCashFlowIndicators(p, null).debtRedemptionYears.status, 'notApplicable');
    p.pl.netIncome = -99999;
    assert.equal(calcCashFlowIndicators(p, null).debtRedemptionYears.status, 'notApplicable');
  });
});

describe('比較表・CSV・バッジ・ヘルプ', () => {
  test('比較表に CF の行を既存の行のあとに足す（既存の行は変えない）', () => {
    const base = buildComparison(sample());
    const cmp = buildComparisonWithCashFlow(sample());
    assert.deepEqual(cmp.rows.slice(0, base.rows.length), base.rows);
    assert.deepEqual(cmp.rows.slice(base.rows.length).map((r) => r.id), CASH_FLOW_ROWS.map((r) => r.id));
    const op = cmp.rows.find((r) => r.id === 'operatingCf');
    assert.equal(op.group, 'cashflow');
    assert.equal(op.cells[2].change.amount, 9200 - 10600);
    assert.equal(op.cells[1].change.amount, null, '前期が推計なしなら増減なし');
  });
  test('比較表CSVに CF の行が入る（表示単位で換算、最初の期は空欄）', () => {
    const d = sample();
    d.settings.units.report = 'yen';
    const csv = buildComparisonCsv(d);
    const line = csv.split('\r\n').find((l) => l.startsWith('キャッシュフロー（推計）,営業CF（推計）'));
    assert.ok(line, csv.slice(-500));
    assert.match(line, /^キャッシュフロー（推計）,営業CF（推計）,円,,10600000,9200000/);
  });
  test('バッジは「標準」の基準だけ：債務償還年数 10年以下で良好・20年超で注意、営業CFマイナスで注意', () => {
    const ev = createDefaultEvaluation();
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: 10, status: 'ok' }, ev).level, 'good');
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: 15, status: 'ok' }, ev), null);
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: 20.5, status: 'ok' }, ev).level, 'caution');
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: null, status: 'notApplicable' }, ev).level, 'caution');
    assert.equal(cashFlowBadge('operatingCf', { value: -1, status: 'ok' }, ev).level, 'caution');
    assert.equal(cashFlowBadge('operatingCf', { value: 1, status: 'ok' }, ev), null);
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: 3, status: 'ok' }, { ...ev, criterion: 'jfc' }), null);
    assert.equal(cashFlowBadge('debtRedemptionYears', { value: 3, status: 'ok' }, { ...ev, enabled: false }), null);
  });
  test('CF の指標にヘルプがある', () => {
    for (const r of CASH_FLOW_ROWS) assert.ok(hasHelp(r.id), r.id);
    assert.match(indicatorHelp('debtRedemptionYears').formula, /有利子負債 ÷ 簡易CF/);
  });
});
