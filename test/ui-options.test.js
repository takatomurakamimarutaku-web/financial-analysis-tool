import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAmount, formatValue, formatChangeAmount, formatChangeRate, changeOf, getWarnings, checkPl, negativeMark,
} from '../js/calc.js';
import {
  createDefaultSettings, normalizeSettings, formatOptions, setUnit, THEMES, NEGATIVE_STYLES,
} from '../js/settings.js';
import { getSampleData, migrate, migrateV5toV6, normalizeData, parseBackup, CURRENT_VERSION } from '../js/store.js';
import { buildComparisonCsv } from '../js/csv.js';

const tri = () => formatOptions({ ...createDefaultSettings(), negativeStyle: 'triangle' });

describe('マイナスの△表示', () => {
  test('既定はマイナス記号、triangle で △', () => {
    assert.equal(formatAmount(-1234), '-1,234');
    assert.equal(formatAmount(-1234, formatOptions(createDefaultSettings())), '-1,234');
    assert.equal(formatAmount(-1234, tri()), '△1,234');
    assert.equal(formatAmount(1234, tri()), '1,234');
    assert.equal(negativeMark('-5', { negativeStyle: 'minus' }), '-5');
  });
  test('指標・前期比にも反映される', () => {
    assert.equal(formatValue({ value: -0.123, status: 'ok' }, '%', tri()), '△12.3%');
    assert.equal(formatValue({ value: -5000, status: 'ok' }, '千円', tri()), '△5,000千円');
    assert.equal(formatValue({ value: -1.5, status: 'ok' }, '倍', tri()), '△1.50倍');
    assert.equal(formatChangeAmount(changeOf(900, 1000), '千円', tri()), '△100千円');
    assert.equal(formatChangeAmount(changeOf(0.1, 0.2), '%', tri()), '△10.0pt');
    assert.equal(formatChangeRate(changeOf(90, 100), tri()), '△10.0%');
    assert.equal(formatChangeRate(changeOf(110, 100), tri()), '+10.0%');
  });
  test('単位の換算と組み合わせられる', () => {
    const o = formatOptions({ ...setUnit(createDefaultSettings(), 'all', 'yen'), negativeStyle: 'triangle' });
    assert.equal(formatAmount(-1.5, o), '△1,500');
  });
  test('CSV は数値のまま（△にしない）', () => {
    const d = getSampleData();
    d.periods[0].pl.netIncome = -6000;
    d.settings = { ...d.settings, negativeStyle: 'triangle' };
    assert.match(buildComparisonCsv(d, 'end'), /当期純利益,千円,-6000\r\n/);
  });
});

describe('PL の整合チェック', () => {
  test('一致していれば警告なし（サンプル）', () => {
    assert.equal(checkPl(getSampleData().periods[0].pl).operatingDiff, 0);
    assert.equal(getWarnings(getSampleData().periods[0]).some((w) => w.type === 'plMismatch'), false);
  });
  test('不一致なら差額つきで警告（PL の単位で表示）', () => {
    const p = getSampleData().periods[0];
    p.pl.sga = 31000;
    assert.equal(checkPl(p.pl).operatingDiff, 1000);
    const w = getWarnings(p).find((x) => x.type === 'plMismatch');
    assert.match(w.message, /差額 1,000千円/);
    const yen = formatOptions(setUnit(createDefaultSettings(), 'pl', 'yen'), 'pl');
    assert.match(getWarnings(p, undefined, yen).find((x) => x.type === 'plMismatch').message, /差額 1,000,000円/);
  });
  test('いずれかが未入力なら判定しない', () => {
    const p = getSampleData().periods[0];
    p.pl.sga = null;
    assert.equal(checkPl(p.pl).operatingDiff, null);
    assert.equal(getWarnings(p).some((w) => w.type === 'plMismatch'), false);
  });
  test('浮動小数点の誤差は無視する', () => {
    assert.equal(getWarnings({ pl: { sales: 0.3, costOfSales: 0.1, sga: 0.1, operatingIncome: 0.1 }, bs: {} }).length, 0);
  });
});

describe('表示テーマの設定', () => {
  test('既定は端末の設定に合わせる、不正値は既定に戻す', () => {
    assert.equal(createDefaultSettings().theme, 'auto');
    assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
    assert.equal(normalizeSettings({ theme: 'blue' }).theme, 'auto');
    assert.equal(normalizeSettings({ negativeStyle: 'triangle' }).negativeStyle, 'triangle');
    assert.equal(normalizeSettings({ negativeStyle: 'x' }).negativeStyle, 'minus');
    assert.deepEqual(THEMES.map((t) => t.id), ['auto', 'light', 'dark']);
    assert.deepEqual(NEGATIVE_STYLES.map((t) => t.id), ['minus', 'triangle']);
  });
});

describe('データ移行 version 5 → 6', () => {
  const v5 = () => {
    const d = JSON.parse(JSON.stringify(getSampleData()));
    d.version = 5;
    delete d.settings.theme;
    delete d.settings.negativeStyle;
    d.settings.units.pl = 'yen';
    return d;
  };
  test('theme と negativeStyle を既定値で追加し、他の設定は保持（元データは不変）', () => {
    const src = v5();
    const d = migrateV5toV6(src);
    assert.equal(d.version, 6);
    assert.equal(d.settings.theme, 'auto');
    assert.equal(d.settings.negativeStyle, 'minus');
    assert.equal(d.settings.units.pl, 'yen');
    assert.equal(src.version, 5);
    assert.equal(src.settings.theme, undefined);
  });
  test('migrate・バックアップ復元で v7 になり、金額は変わらない', () => {
    assert.equal(normalizeData(migrate(v5())).version, CURRENT_VERSION);
    assert.equal(CURRENT_VERSION, 7);
    const r = parseBackup(JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: null, data: v5() }));
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 7);
    assert.deepEqual(r.data.periods, getSampleData().periods);
  });
});
