import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENT_CATEGORIES, calcNormalizedEbitda, getAdjustmentWarnings, buildEbitdaBridge,
  buildComparison, categoryName,
} from '../js/calc.js';
import {
  CURRENT_VERSION, STORAGE_KEY, getSampleData, getSampleMultiData, createEmptyPeriod,
  migrate, migrateV1toV2, normalizeData, loadData, parseBackup, backupToJson, validateData,
  createAdjustment, addAdjustment, updateAdjustment, removeAdjustment,
} from '../js/store.js';

const EPS = 1e-9;
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, `${msg ?? ''} expected ${expected}, got ${actual}`);
}

// 報告EBITDA 15,000（営業利益10,000 + 減価償却費5,000）、売上高100,000 の期に調整項目を付ける
function periodWith(adjustments) {
  const p = getSampleData().periods[0];
  p.adjustments = adjustments;
  return p;
}
const adj = (category, amount, memo = '根拠あり', description = '') => ({ id: `t-${category}-${amount}`, category, description, amount, memo });

describe('正常化EBITDA：符号と集計', () => {
  test('プラスは加算、マイナスは減算', () => {
    const r = calcNormalizedEbitda(periodWith([adj('executiveComp', 3000), adj('oneTime', -1000)]));
    assert.equal(r.reported, 15000);
    assert.equal(r.adjustmentTotal, 2000);
    assert.equal(r.normalized, 17000);
    near(r.margin, 0.17);
  });
  test('調整項目なし：正常化EBITDA = 報告EBITDA', () => {
    const r = calcNormalizedEbitda(periodWith([]));
    assert.equal(r.adjustmentTotal, 0);
    assert.equal(r.normalized, 15000);
    near(r.margin, 0.15);
  });
  test('区分ごとの集計（同じ区分は合算、件数も数える）', () => {
    const r = calcNormalizedEbitda(periodWith([
      adj('executiveComp', 3000),
      adj('executiveComp', -500),
      adj('relatedParty', -800),
      adj('oneTime', 1200),
      adj('accountingPolicy', 400),
      adj('businessChange', -2000),
      adj('other', 100),
    ]));
    const by = Object.fromEntries(r.byCategory.map((c) => [c.id, [c.total, c.count]]));
    assert.deepEqual(by, {
      executiveComp: [2500, 2],
      oneTime: [1200, 1],
      relatedParty: [-800, 1],
      accountingPolicy: [400, 1],
      businessChange: [-2000, 1],
      other: [100, 1],
    });
    assert.equal(r.adjustmentTotal, 2500 + 1200 - 800 + 400 - 2000 + 100);
    assert.equal(r.normalized, 15000 + 1400);
  });
  test('区分の合計 = 調整額合計', () => {
    const r = calcNormalizedEbitda(getSampleMultiData().periods[2]);
    assert.equal(r.byCategory.reduce((s, c) => s + c.total, 0), r.adjustmentTotal);
  });
  test('サンプル（2025/3期）：15,000 + 3,000 + 1,200 − 800 = 18,400', () => {
    const r = calcNormalizedEbitda(getSampleData().periods[0]);
    assert.equal(r.normalized, 18400);
    near(r.margin, 0.184);
  });
  test('金額未入力の調整項目は合計に含めない', () => {
    const r = calcNormalizedEbitda(periodWith([adj('oneTime', null), adj('oneTime', 500)]));
    assert.equal(r.adjustmentTotal, 500);
    assert.equal(r.byCategory.find((c) => c.id === 'oneTime').count, 2);
  });
  test('不明な区分は「その他」に集計', () => {
    const r = calcNormalizedEbitda(periodWith([adj('unknown', 700)]));
    assert.equal(r.byCategory.find((c) => c.id === 'other').total, 700);
    assert.equal(categoryName('unknown'), 'その他');
  });
  test('報告EBITDAが計算できない（減価償却費未入力）なら正常化EBITDAも「—」', () => {
    const p = periodWith([adj('oneTime', 500)]);
    p.pl.depreciation = null;
    const r = calcNormalizedEbitda(p);
    assert.equal(r.reported, null);
    assert.equal(r.normalized, null);
    assert.equal(r.margin, null);
  });
  test('売上高0：マージンは「—」', () => {
    const p = periodWith([]);
    p.pl.sales = 0;
    assert.equal(calcNormalizedEbitda(p).margin, null);
  });
  test('調整後にマイナスになっても計算する', () => {
    const r = calcNormalizedEbitda(periodWith([adj('oneTime', -20000)]));
    assert.equal(r.normalized, -5000);
    near(r.margin, -0.05);
  });
  test('6区分が定義されている', () => {
    assert.deepEqual(ADJUSTMENT_CATEGORIES.map((c) => c.name),
      ['役員報酬の調整', '一過性の損益', '関連当事者取引', '会計方針の差異', '事業の撤退・新設', 'その他']);
  });
});

describe('警告', () => {
  test('根拠メモが空なら「根拠未記載」', () => {
    const w = getAdjustmentWarnings(periodWith([adj('oneTime', 500, ''), adj('oneTime', 100, '  '), adj('oneTime', 1, 'あり')]));
    assert.equal(w.filter((x) => x.type === 'memoMissing').length, 2);
    assert.match(w[0].message, /根拠未記載/);
  });
  test('金額未入力の警告', () => {
    const w = getAdjustmentWarnings(periodWith([adj('oneTime', null, 'あり', '移転費用')]));
    assert.equal(w.length, 1);
    assert.equal(w[0].type, 'amountMissing');
    assert.match(w[0].message, /「移転費用」/);
  });
  test('問題なければ警告なし', () => {
    for (const p of getSampleMultiData().periods) assert.deepEqual(getAdjustmentWarnings(p), [], p.label);
    assert.deepEqual(getAdjustmentWarnings(createEmptyPeriod('')), []);
  });
});

describe('EBITDAブリッジ表', () => {
  test('報告EBITDA → 区分ごとの調整 → 調整額合計 → 正常化EBITDA → マージン', () => {
    const b = buildEbitdaBridge(getSampleMultiData());
    assert.deepEqual(b.labels, ['2023/3期', '2024/3期', '2025/3期']);
    assert.deepEqual(b.rows.map((r) => r.name), [
      '報告EBITDA', '役員報酬の調整', '一過性の損益', '関連当事者取引', '調整額合計', '正常化EBITDA', '正常化EBITDAマージン',
    ]);
    const get = (id) => b.rows.find((r) => r.id === id).values;
    assert.deepEqual(get('reported'), [9360, 12090, 15000]);
    assert.deepEqual(get('cat:executiveComp'), [2500, 2500, 3000]);
    assert.deepEqual(get('cat:oneTime'), [0, -1500, 1200]);
    assert.deepEqual(get('cat:relatedParty'), [0, 0, -800]);
    assert.deepEqual(get('adjustmentTotal'), [2500, 1000, 3400]);
    assert.deepEqual(get('normalized'), [11860, 13090, 18400]);
    near(get('margin')[0], 11860 / 82000);
  });
  test('使われていない区分の行は出さない', () => {
    const data = { periods: [periodWith([])] };
    assert.deepEqual(buildEbitdaBridge(data).rows.map((r) => r.id), ['reported', 'adjustmentTotal', 'normalized', 'margin']);
  });
  test('比較表に正常化EBITDA・マージンの行があり、前期比も出る', () => {
    const cmp = buildComparison(getSampleMultiData());
    const n = cmp.rows.find((r) => r.id === 'normalizedEbitda');
    assert.deepEqual(n.cells.map((c) => c.result.value), [11860, 13090, 18400]);
    assert.equal(n.cells[2].change.amount, 5310);
    const m = cmp.rows.find((r) => r.id === 'normalizedEbitdaMargin');
    near(m.cells[2].result.value, 0.184);
    assert.equal(m.unit, '%');
  });
});

describe('データ移行 version 1 → 2', () => {
  const v1 = () => ({
    version: 1,
    companyName: '旧データ株式会社',
    periods: [{
      label: '2024/3期',
      pl: { sales: 1000, operatingIncome: 100, depreciation: 20 },
      bs: { cash: 50 },
      adjustments: [],
      debtLikeItems: [],
    }],
  });
  test('version が 2 になり、他の値は保たれる', () => {
    const d = migrateV1toV2(v1());
    assert.equal(d.version, 2);
    assert.equal(d.companyName, '旧データ株式会社');
    assert.equal(d.periods[0].pl.sales, 1000);
    assert.deepEqual(d.periods[0].adjustments, []);
  });
  test('元のデータは変更しない', () => {
    const src = v1();
    migrateV1toV2(src);
    assert.equal(src.version, 1);
  });
  test('v1 に調整項目らしきものがあれば形をそろえて引き継ぐ', () => {
    const src = v1();
    src.periods[0].adjustments = [{ amount: 300, memo: 'x' }, 'broken'];
    const d = migrateV1toV2(src);
    assert.equal(d.periods[0].adjustments.length, 1);
    const a = d.periods[0].adjustments[0];
    assert.equal(a.amount, 300);
    assert.equal(a.category, 'other');
    assert.equal(a.description, '');
    assert.equal(typeof a.id, 'string');
  });
  test('migrate：v1 → v2、v2 はそのまま、未知は null', () => {
    assert.equal(migrate(v1()).version, CURRENT_VERSION);
    const v2 = getSampleData();
    assert.equal(migrate(v2), v2);
    assert.equal(migrate({ ...v2, version: 3 }), null);
  });
  test('localStorage の v1 データを読み込むと v2 になる', () => {
    const map = new Map([[STORAGE_KEY, JSON.stringify(v1())]]);
    const st = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
    const { data, error } = loadData(st);
    assert.equal(error, null);
    assert.equal(data.version, 2);
    assert.equal(data.periods[0].pl.sales, 1000);
    assert.equal(calcNormalizedEbitda(data.periods[0]).normalized, 120);
  });
  test('v1 のバックアップファイルも復元できる（v2 に移行）', () => {
    const text = JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: '2026-10-01T00:00:00Z', data: v1() });
    const r = parseBackup(text);
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 2);
  });
  test('v2 のバックアップは調整項目を含めて往復できる', () => {
    const d = getSampleMultiData();
    const r = parseBackup(backupToJson(d));
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, d);
  });
  test('調整項目の型が不正なバックアップは読み込まない', () => {
    const d = getSampleData();
    d.periods[0].adjustments[0].amount = '3000';
    assert.match(validateData(d).join(), /amount が数値ではありません/);
    d.periods[0].adjustments[0].amount = 3000;
    d.periods[0].adjustments[0].category = 'xxx';
    assert.match(validateData(d).join(), /不明な区分/);
    assert.equal(parseBackup(backupToJson(d)).ok, false);
  });
  test('正規化：サンプルは変わらない', () => {
    assert.deepEqual(normalizeData(getSampleMultiData()), getSampleMultiData());
  });
});

describe('調整項目の操作', () => {
  test('追加・更新・削除（元データは変更しない）', () => {
    const d0 = getSampleData();
    const item = createAdjustment('oneTime');
    assert.equal(item.amount, null);
    const d1 = addAdjustment(d0, 0, item);
    assert.equal(d1.periods[0].adjustments.length, 4);
    assert.equal(d0.periods[0].adjustments.length, 3);
    const d2 = updateAdjustment(d1, 0, item.id, { amount: -700, memo: 'テスト' });
    assert.equal(d2.periods[0].adjustments[3].amount, -700);
    assert.equal(d1.periods[0].adjustments[3].amount, null);
    const d3 = removeAdjustment(d2, 0, item.id);
    assert.equal(d3.periods[0].adjustments.length, 3);
    assert.equal(addAdjustment(d0, 5, item), d0);
  });
  test('createAdjustment の id は重複しない', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createAdjustment().id));
    assert.equal(ids.size, 50);
  });
});

describe('結果テキスト', () => {
  test('調整項目があれば正常化EBITDAを含める', async () => {
    const { buildResultText, calcIndicators } = await import('../js/calc.js');
    const d = getSampleData();
    d.periods[0].adjustments[2].memo = '';
    const text = buildResultText(d, calcIndicators(d.periods[0]), [], 0);
    assert.match(text, /■ 正常化EBITDA/);
    assert.match(text, /報告EBITDA：15,000/);
    assert.match(text, /役員報酬の調整：\+3,000/);
    assert.match(text, /関連当事者取引：-800/);
    assert.match(text, /正常化EBITDA：18,400/);
    assert.match(text, /正常化EBITDAマージン：18\.4%/);
    assert.match(text, /根拠未記載/);
  });
  test('調整項目がなければ正常化EBITDAの欄は出さない', async () => {
    const { buildResultText, calcIndicators } = await import('../js/calc.js');
    const d = getSampleData();
    d.periods[0].adjustments = [];
    assert.doesNotMatch(buildResultText(d, calcIndicators(d.periods[0])), /正常化EBITDA/);
  });
});
