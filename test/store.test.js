import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, CURRENT_VERSION, createEmptyData, createEmptyPeriod, getSampleData,
  normalizeData, migrate, loadData, saveData, clearData,
} from '../js/store.js';
import { PL_FIELDS, BS_FIELDS } from '../js/calc.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

function throwingStorage() {
  const err = () => { throw new Error('QuotaExceededError'); };
  return { getItem: err, setItem: err, removeItem: err };
}

describe('初期データ', () => {
  test('createEmptyData は最新 version（単位の区分ごと設定以降は 5）・1期・全項目 null', () => {
    const d = createEmptyData();
    assert.equal(d.version, 5);
    assert.equal(CURRENT_VERSION, 5);
    assert.equal(d.companyName, '');
    assert.equal(d.periods.length, 1);
    const p = d.periods[0];
    assert.deepEqual(Object.keys(p.pl), PL_FIELDS.map((f) => f.key));
    assert.deepEqual(Object.keys(p.bs), BS_FIELDS.map((f) => f.key));
    assert.ok(Object.values(p.pl).every((v) => v === null));
    assert.ok(Object.values(p.bs).every((v) => v === null));
    assert.deepEqual(p.adjustments, []);
    assert.deepEqual(p.debtLikeItems, []);
    assert.deepEqual(p.cashLikeItems, []);
  });
  test('createEmptyPeriod はラベルを保持', () => {
    assert.equal(createEmptyPeriod('2024/3期').label, '2024/3期');
  });
  test('サンプルデータは正規化しても変わらない', () => {
    const s = getSampleData();
    assert.deepEqual(normalizeData(s), s);
  });
});

describe('normalizeData / migrate', () => {
  test('欠けた項目を null で補い、数値以外を null にする', () => {
    const d = normalizeData({
      version: 1,
      periods: [{ label: 'X', pl: { sales: 100, costOfSales: '50' }, bs: { cash: NaN } }],
    });
    assert.equal(d.companyName, '');
    assert.equal(d.periods[0].pl.sales, 100);
    assert.equal(d.periods[0].pl.costOfSales, null);
    assert.equal(d.periods[0].pl.netIncome, null);
    assert.equal(d.periods[0].bs.cash, null);
    assert.deepEqual(d.periods[0].adjustments, []);
  });
  test('periods が空なら空の1期を補う', () => {
    assert.equal(normalizeData({ version: 1, periods: [] }).periods.length, 1);
  });
  test('形が壊れていれば null', () => {
    assert.equal(normalizeData(null), null);
    assert.equal(normalizeData({ periods: 'x' }), null);
    assert.equal(normalizeData({ periods: [1] }), null);
    assert.equal(normalizeData([]), null);
  });
  test('migrate: v1 はそのまま、未知の version は null', () => {
    const d = getSampleData();
    assert.equal(migrate(d), d);
    assert.equal(migrate({ ...d, version: 99 }), null);
    assert.equal(migrate({ periods: [] }), null);
    assert.equal(migrate('text'), null);
  });
});

describe('loadData / saveData / clearData', () => {
  test('保存 → 読込で同じデータに戻る', () => {
    const st = memoryStorage();
    const d = getSampleData();
    assert.deepEqual(saveData(d, st), { ok: true, error: null });
    assert.ok(st.map.has(STORAGE_KEY));
    const { data, error } = loadData(st);
    assert.equal(error, null);
    assert.deepEqual(data, d);
  });
  test('保存データがなければ空データ・エラーなし', () => {
    const { data, error } = loadData(memoryStorage());
    assert.deepEqual(data, createEmptyData());
    assert.equal(error, null);
  });
  test('壊れたJSONは空データとエラーメッセージ（元データは消さない）', () => {
    const st = memoryStorage({ [STORAGE_KEY]: '{broken' });
    const { data, error } = loadData(st);
    assert.deepEqual(data, createEmptyData());
    assert.match(error, /読み込めません/);
    assert.equal(st.map.get(STORAGE_KEY), '{broken');
  });
  test('未知の version は読み込まない', () => {
    const st = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 99, periods: [] }) });
    const { data, error } = loadData(st);
    assert.deepEqual(data, createEmptyData());
    assert.ok(error);
  });
  test('storage が例外を投げても例外にならない', () => {
    const st = throwingStorage();
    assert.equal(loadData(st).error !== null, true);
    assert.equal(saveData(getSampleData(), st).ok, false);
    assert.equal(clearData(st).ok, false);
  });
  test('storage が利用できない環境（null）', () => {
    assert.equal(loadData(null).error !== null, true);
    assert.equal(saveData(getSampleData(), null).ok, false);
  });
  test('clearData で削除される', () => {
    const st = memoryStorage();
    saveData(getSampleData(), st);
    assert.equal(clearData(st).ok, true);
    assert.equal(st.map.has(STORAGE_KEY), false);
  });
});
