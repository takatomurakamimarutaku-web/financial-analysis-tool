import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMOUNT_UNITS, createDefaultSettings, normalizeSettings, unitOf, toDisplayAmount, fromDisplayAmount,
  formatOptions, accountLabel, accountTree, renameAccount, setAccountHidden, moveAccount,
  addCustomAccount, removeCustomAccount, setDetailValue, isComputedAccount, applyAccountTotals,
  indicatorList, setIndicatorHidden, moveIndicator, arrangeComparisonRows, rowLabel,
  categoryLabel, renameCategory, updateSettings, setUnit, commonUnit, UNIT_SCOPES, OTHER_DETAIL_LABEL, MAX_CUSTOM_ACCOUNTS,
} from '../js/settings.js';
import {
  INDICATORS, PL_FIELDS, BS_FIELDS, formatAmount, formatValue, formatChangeAmount, formatChangeRate,
  calcIndicators, buildComparison, buildEbitdaBridge, getWarnings, buildResultText, formulaText, changeOf,
} from '../js/calc.js';
import {
  getSampleData, getSampleMultiData, createEmptyData, normalizeData, migrate, migrateV3toV4, migrateV4toV5,
  parseBackup, backupToJson, needsBackupReminder, hasAnyData, CURRENT_VERSION,
} from '../js/store.js';
import { buildComparisonCsv, buildBridgeCsv, buildNetDebtCsv } from '../js/csv.js';

const S = createDefaultSettings;

describe('既定の設定と正規化', () => {
  test('既定値：千円・全科目表示・365日・期末残高・桁数 1/1/2・リマインド30日', () => {
    const s = S();
    assert.deepEqual(s.units, { pl: 'thousand', bs: 'thousand', ebitda: 'thousand', netDebt: 'thousand', compare: 'thousand', report: 'thousand' });
    assert.equal(s.accounts.pl.length, PL_FIELDS.length);
    assert.equal(s.accounts.bs.length, BS_FIELDS.length);
    assert.deepEqual(s.accounts.custom, []);
    assert.equal(s.indicators.length, INDICATORS.length);
    assert.deepEqual(s.analysis, { daysInYear: 365, defaultBasis: 'end' });
    assert.deepEqual(s.digits, { pct: 1, days: 1, times: 2 });
    assert.equal(s.backupReminderDays, 30);
  });
  test('正規化しても既定値は変わらない', () => {
    assert.deepEqual(normalizeSettings(S()), S());
    assert.deepEqual(normalizeSettings(null), S());
    assert.deepEqual(normalizeSettings('x'), S());
  });
  test('不正な値は既定値に、未知の科目・指標は除外、欠けた科目は末尾に補う', () => {
    const s = normalizeSettings({
      unit: 'dollar',
      accounts: {
        pl: [{ key: 'sga', label: '一般管理費', hidden: true }, { key: 'unknown' }, { key: 'sga' }],
        custom: [{ key: 'c-1', label: '役員報酬', parent: 'sga' }, { key: 'bad', parent: 'sga' }, { key: 'c-2', parent: 'nope' }],
      },
      indicators: [{ id: 'ccc', hidden: true }, { id: 'zzz' }],
      analysis: { daysInYear: 300, defaultBasis: 'average' },
      digits: { pct: 9, days: 0, times: 1.5 },
      backupReminderDays: -1,
      adjustmentCategoryNames: { oneTime: '非経常', zzz: 'x', other: '  ' },
    });
    assert.deepEqual(s.units, { pl: 'thousand', bs: 'thousand', ebitda: 'thousand', netDebt: 'thousand', compare: 'thousand', report: 'thousand' });
    assert.equal(s.accounts.pl[0].key, 'sga');
    assert.equal(s.accounts.pl[0].hidden, true);
    assert.equal(s.accounts.pl.length, PL_FIELDS.length);
    assert.equal(s.accounts.bs.length, BS_FIELDS.length);
    assert.deepEqual(s.accounts.custom, [{ key: 'c-1', label: '役員報酬', parent: 'sga' }]);
    assert.equal(s.indicators[0].id, 'ccc');
    assert.equal(s.indicators[0].hidden, true);
    assert.equal(s.indicators.length, INDICATORS.length);
    assert.deepEqual(s.analysis, { daysInYear: 365, defaultBasis: 'average' });
    assert.deepEqual(s.digits, { pct: 1, days: 0, times: 2 });
    assert.equal(s.backupReminderDays, 30);
    assert.deepEqual(s.adjustmentCategoryNames, { oneTime: '非経常' });
  });
});

describe('表示単位', () => {
  test('円・千円・百万円の換算（内部は千円）', () => {
    const yen = setUnit(S(), 'all', 'yen');
    const mil = setUnit(S(), 'all', 'million');
    assert.equal(toDisplayAmount(1234.567, yen), 1234567);
    assert.equal(fromDisplayAmount(1234567, yen), 1234.567);
    assert.equal(toDisplayAmount(1234, S()), 1234);
    assert.equal(toDisplayAmount(123456, mil), 123.456);
    assert.equal(fromDisplayAmount(1.5, mil), 1500);
    assert.equal(toDisplayAmount(null, yen), null);
    assert.equal(fromDisplayAmount(undefined, yen), null);
  });
  test('円で入力した値を戻しても誤差が出ない', () => {
    const yen = setUnit(S(), 'all', 'yen');
    for (const v of [1, 999, 1234567, 100000001, -98765]) {
      assert.equal(toDisplayAmount(fromDisplayAmount(v, yen), yen), v);
    }
  });
  test('unitOf は不明な単位なら千円', () => {
    assert.equal(unitOf({ units: { compare: 'x' } }).name, '千円');
    assert.equal(unitOf(undefined).name, '千円');
    assert.deepEqual(AMOUNT_UNITS.map((u) => u.name), ['円', '千円', '百万円']);
  });
  test('formatAmount / formatValue に単位と桁数が反映される', () => {
    const yen = formatOptions(setUnit(S(), 'all', 'yen'));
    const mil = formatOptions(setUnit(S(), 'all', 'million'));
    assert.equal(formatAmount(1234.5, yen), '1,234,500');
    assert.equal(formatAmount(123456, mil), '123.5');
    assert.equal(formatValue({ value: 15000, status: 'ok' }, '千円', yen), '15,000,000円');
    assert.equal(formatValue({ value: 15000, status: 'ok' }, '千円', mil), '15.0百万円');
    assert.equal(formatValue({ value: 15000, status: 'ok' }, '千円'), '15,000千円'); // 既定は従来どおり
    const d = formatOptions({ ...S(), digits: { pct: 2, days: 0, times: 3 } });
    assert.equal(formatValue({ value: 0.12345, status: 'ok' }, '%', d), '12.35%');
    assert.equal(formatValue({ value: 45.6, status: 'ok' }, '日', d), '46日');
    assert.equal(formatValue({ value: 1.23456, status: 'ok' }, '倍', d), '1.235倍');
    assert.equal(formatValue({ value: 1.23456, status: 'ok' }, '回', d), '1.235回');
    assert.equal(formatChangeAmount(changeOf(0.2, 0.1), '%', d), '+10.00pt');
    assert.equal(formatChangeAmount(changeOf(2000, 1000), '千円', yen), '+1,000,000円');
    assert.equal(formatChangeRate(changeOf(110, 100), d), '+10.00%');
  });
  test('貸借不一致の警告は表示単位で出る', () => {
    const p = getSampleData().periods[0];
    p.bs.totalAssets = 100001;
    const [w] = getWarnings(p, formatOptions(setUnit(S(), 'all', 'yen')));
    assert.match(w.message, /差額 1,000円/);
  });
});

describe('科目の名称変更・非表示・並び替え', () => {
  test('名称変更と、空欄で標準名に戻る', () => {
    let s = renameAccount(S(), 'sga', '販売費及び一般管理費');
    assert.equal(accountLabel(s, 'sga'), '販売費及び一般管理費');
    s = renameAccount(s, 'sga', '  ');
    assert.equal(accountLabel(s, 'sga'), '販管費');
  });
  test('非表示（標準科目のみ）', () => {
    const s = setAccountHidden(S(), 'interestExpense', true);
    assert.equal(accountTree(s, 'pl').find((a) => a.key === 'interestExpense').hidden, true);
    const s0 = S();
    assert.equal(setAccountHidden(s0, 'c-x', true), s0);
  });
  test('並び替え：同じ表の中だけで移動、端では変更しない', () => {
    const s0 = S();
    const s1 = moveAccount(s0, 'costOfSales', -1);
    assert.deepEqual(s1.accounts.pl.slice(0, 2).map((a) => a.key), ['costOfSales', 'sales']);
    assert.equal(moveAccount(s0, 'sales', -1), s0);
    assert.equal(moveAccount(s0, 'netAssets', 1), s0);
    assert.equal(s0.accounts.pl[0].key, 'sales'); // 元の設定は不変
  });
});

describe('内訳科目', () => {
  test('親科目に値がある状態で最初の内訳を追加すると「その他」に元の値が移り、合計は変わらない', () => {
    const d0 = getSampleMultiData();
    const { data: d1, key } = addCustomAccount(d0, 'sga', '役員報酬');
    const kids = d1.settings.accounts.custom;
    assert.equal(kids.length, 2);
    assert.equal(kids[0].key, key);
    assert.equal(kids[1].label, OTHER_DETAIL_LABEL);
    d1.periods.forEach((p, i) => {
      assert.equal(p.details[kids[1].key], d0.periods[i].pl.sga);
      assert.equal(p.pl.sga, d0.periods[i].pl.sga);
    });
    assert.equal(d0.settings.accounts.custom.length, 0); // 元データは不変
  });
  test('内訳の入力で親科目が合計に更新され、指標に反映される', () => {
    let { data, key } = addCustomAccount(getSampleData(), 'sga', '役員報酬');
    const other = data.settings.accounts.custom.find((c) => c.label === OTHER_DETAIL_LABEL).key;
    data = setDetailValue(data, 0, other, 25000);
    data = setDetailValue(data, 0, key, 3000.5);
    assert.equal(data.periods[0].pl.sga, 28000.5);
    assert.equal(isComputedAccount(data.periods[0], data.settings, 'sga'), true);
    assert.equal(isComputedAccount(data.periods[0], data.settings, 'sales'), false);
  });
  test('内訳がすべて未入力の期は親科目の入力値をそのまま使う', () => {
    const d0 = createEmptyData();
    d0.periods[0].pl.sga = 500;
    const { data } = addCustomAccount(d0, 'cash', '普通預金'); // cash は未入力 → 「その他」は作らない
    assert.equal(data.settings.accounts.custom.length, 1);
    const d2 = applyAccountTotals(data);
    assert.equal(d2.periods[0].bs.cash, null);
    assert.equal(d2.periods[0].pl.sga, 500);
    assert.equal(isComputedAccount(d2.periods[0], d2.settings, 'cash'), false);
  });
  test('2つ目以降の内訳は末尾に追加し、「その他」は増やさない', () => {
    let { data } = addCustomAccount(getSampleData(), 'sga', 'A');
    ({ data } = addCustomAccount(data, 'sga', 'B'));
    assert.deepEqual(data.settings.accounts.custom.map((c) => c.label), ['A', OTHER_DETAIL_LABEL, 'B']);
  });
  test('内訳の並び替えは同じ親科目の中だけ', () => {
    let { data } = addCustomAccount(getSampleData(), 'sga', 'A');
    ({ data } = addCustomAccount(data, 'cash', 'X'));
    ({ data } = addCustomAccount(data, 'sga', 'B'));
    const keyB = data.settings.accounts.custom.find((c) => c.label === 'B').key;
    const s = moveAccount(data.settings, keyB, -1);
    assert.deepEqual(accountTree(s, 'pl').find((a) => a.key === 'sga').children.map((c) => c.label), ['A', 'B', OTHER_DETAIL_LABEL]);
    const keyA = data.settings.accounts.custom.find((c) => c.label === 'A').key;
    assert.equal(moveAccount(data.settings, keyA, -1), data.settings);
  });
  test('内訳を削除すると全期の値も消え、残りで再計算。最後の1つを消すと親は直前の値のまま', () => {
    let { data, key } = addCustomAccount(getSampleData(), 'sga', '役員報酬');
    const other = data.settings.accounts.custom.find((c) => c.label === OTHER_DETAIL_LABEL).key;
    data = setDetailValue(data, 0, key, 1000);
    assert.equal(data.periods[0].pl.sga, 31000);
    data = removeCustomAccount(data, key);
    assert.equal(data.periods[0].details[key], undefined);
    assert.equal(data.periods[0].pl.sga, 30000);
    data = removeCustomAccount(data, other);
    assert.deepEqual(data.settings.accounts.custom, []);
    assert.equal(data.periods[0].pl.sga, 30000);
  });
  test('内訳科目は上限数まで', () => {
    let data = createEmptyData();
    for (let i = 0; i < MAX_CUSTOM_ACCOUNTS + 3; i += 1) ({ data } = addCustomAccount(data, 'sga', `x${i}`));
    assert.equal(data.settings.accounts.custom.length, MAX_CUSTOM_ACCOUNTS);
    assert.equal(addCustomAccount(createEmptyData(), 'unknown', 'x').key, null);
  });
  test('normalizeData は未登録の内訳の値を捨て、親科目を再計算する', () => {
    let { data, key } = addCustomAccount(createEmptyData(), 'sales', '製品売上');
    data.periods[0].details = { [key]: 700, 'c-ghost': 5, [`${key}x`]: 'abc' };
    const n = normalizeData(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(n.periods[0].details, { [key]: 700 });
    assert.equal(n.periods[0].pl.sales, 700);
  });
  test('accountTree は子を親の下に並べる', () => {
    const { data } = addCustomAccount(createEmptyData(), 'receivables', '売掛金');
    const t = accountTree(data.settings, 'bs');
    assert.deepEqual(t.find((a) => a.key === 'receivables').children.map((c) => c.label), ['売掛金']);
    assert.equal(t.find((a) => a.key === 'receivables').standardLabel, '売上債権');
  });
});

describe('指標の表示・並び替え', () => {
  test('非表示にした指標は一覧から除かれる', () => {
    const s = setIndicatorHidden(S(), 'ccc', true);
    assert.equal(indicatorList(s).some((i) => i.id === 'ccc'), false);
    assert.equal(indicatorList(s, true).find((i) => i.id === 'ccc').hidden, true);
    assert.equal(indicatorList(S()).length, INDICATORS.length);
  });
  test('並び替えは同じ区分の中だけ', () => {
    const s = moveIndicator(S(), 'operatingMargin', -1);
    const prof = indicatorList(s).filter((i) => i.category === 'profitability').map((i) => i.id);
    assert.deepEqual(prof.slice(0, 2), ['operatingMargin', 'grossMargin']);
    // 安全性の先頭（currentRatio）を前へ → 収益性の末尾とは入れ替えない
    const s0 = S();
    assert.equal(moveIndicator(s0, 'currentRatio', -1), s0);
  });
  test('比較表の行を設定に合わせる（金額行・正常化EBITDA行はそのまま）', () => {
    let s = setIndicatorHidden(S(), 'roe', true);
    s = moveIndicator(s, 'ccc', -1);
    const rows = buildComparison(getSampleMultiData(), 'end').rows;
    const out = arrangeComparisonRows(s, rows);
    assert.equal(out.length, rows.length - 1);
    assert.equal(out.some((r) => r.id === 'roe'), false);
    const eff = out.filter((r) => r.group === 'efficiency').map((r) => r.id);
    assert.deepEqual(eff, ['assetTurnover', 'receivableDays', 'inventoryDays', 'ccc', 'payableDays']);
    assert.ok(out.some((r) => r.id === 'normalizedEbitda'));
    assert.deepEqual(arrangeComparisonRows(S(), rows).map((r) => r.id), rows.map((r) => r.id));
  });
  test('rowLabel は科目の名称変更を比較表の金額行に反映する', () => {
    const s = renameAccount(S(), 'sales', '売上収益');
    assert.equal(rowLabel(s, { id: 'sales', name: '売上高' }), '売上収益');
    assert.equal(rowLabel(s, { id: 'grossProfit', name: '売上総利益' }), '売上総利益');
  });
});

describe('年日数・調整区分名', () => {
  test('360日にすると回転日数が 360/365 倍になり、比較表にも反映される', () => {
    const p = getSampleData().periods[0];
    const r365 = calcIndicators(p);
    const r360 = calcIndicators(p, { days: 360 });
    assert.equal(r365.receivableDays.value, 15000 / 100000 * 365);
    assert.equal(r360.receivableDays.value, 15000 / 100000 * 360);
    assert.equal(r360.ccc.value, r360.receivableDays.value + r360.inventoryDays.value - r360.payableDays.value);
    const d = updateSettings(getSampleData(), { analysis: { daysInYear: 360, defaultBasis: 'end' } });
    const row = buildComparison(d, 'end').rows.find((x) => x.id === 'receivableDays');
    assert.equal(row.cells[0].result.value, 15000 / 100000 * 360);
    assert.equal(formulaText(INDICATORS.find((i) => i.id === 'ccc'), 360), INDICATORS.find((i) => i.id === 'ccc').formula);
    assert.equal(formulaText(INDICATORS.find((i) => i.id === 'receivableDays'), 360), '売上債権 ÷ 売上高 × 360');
  });
  test('平均残高ベースでも年日数が反映される', () => {
    const d = updateSettings(getSampleMultiData(), { analysis: { daysInYear: 360, defaultBasis: 'average' } });
    const row = buildComparison(d, 'average').rows.find((x) => x.id === 'receivableDays');
    assert.equal(row.cells[1].result.value, ((13500 + 14200) / 2) / 91000 * 360);
  });
  test('調整区分の名称変更がブリッジに反映され、空欄で元に戻る', () => {
    let s = renameCategory(S(), 'executiveComp', '役員報酬の正常化');
    assert.equal(categoryLabel(s, 'executiveComp'), '役員報酬の正常化');
    const d = { ...getSampleData(), settings: s };
    assert.ok(buildEbitdaBridge(d).rows.some((r) => r.name === '役員報酬の正常化'));
    s = renameCategory(s, 'executiveComp', '');
    assert.equal(categoryLabel(s, 'executiveComp'), '役員報酬の調整');
    const s0 = S();
    assert.equal(renameCategory(s0, 'zzz', 'x'), s0);
  });
});

describe('結果テキスト・CSV への反映', () => {
  test('結果テキストは表示単位・非表示の指標を反映する', () => {
    const d = getSampleData();
    const s = setIndicatorHidden(setUnit(S(), 'all', 'yen'), 'roe', true);
    const opts = { ...formatOptions(s), indicators: indicatorList(s) };
    const text = buildResultText(d, calcIndicators(d.periods[0]), [], 0, opts);
    assert.match(text, /金額単位：円/);
    assert.match(text, /EBITDA：15,000,000円/);
    assert.doesNotMatch(text, /ROE/);
  });
  test('比較表CSVは表示単位で出力し、単位列・注記も変わる', () => {
    const d = { ...getSampleData(), settings: setUnit(S(), 'all', 'million') };
    const csv = buildComparisonCsv(d, 'end');
    assert.match(csv, /主要数値,売上高,百万円,100\r\n/);
    assert.match(csv, /金額単位：百万円/);
    assert.match(csv, /M&A,EBITDA,百万円,15\r\n/);
    assert.match(csv, /収益性,売上総利益率,%,40\r\n/);
  });
  test('ブリッジ・ネットデットCSVも表示単位で出力', () => {
    const d = { ...getSampleData(), settings: setUnit(S(), 'all', 'yen') };
    assert.match(buildBridgeCsv(d), /報告EBITDA,円,15000000\r\n/);
    assert.match(buildBridgeCsv(d), /金額（円）/);
    assert.match(buildNetDebtCsv(d), /有利子負債,40000000\r\n/);
    assert.match(buildNetDebtCsv(d), /退職給付引当金,3000000,/);
  });
  test('既定（千円）のCSVは従来と同じ', () => {
    const d = getSampleData();
    const { settings, ...noSettings } = d;
    assert.equal(buildComparisonCsv(d, 'end'), buildComparisonCsv(noSettings, 'end'));
    assert.equal(buildBridgeCsv(d), buildBridgeCsv(noSettings));
    assert.equal(buildNetDebtCsv(d), buildNetDebtCsv(noSettings));
  });
});

describe('データ移行 version 3 → 4', () => {
  const v3 = () => ({
    version: 3,
    companyName: 'A',
    periods: [{ label: 'X', pl: { sales: 100 }, bs: { cash: 5 }, adjustments: [], debtLikeItems: [], cashLikeItems: [] }],
  });
  test('settings を既定値で追加し、各期に details を追加（元データは不変・値は保持）', () => {
    const src = v3();
    const d = migrateV3toV4(src);
    assert.equal(d.version, 4);
    assert.deepEqual(d.settings, S());
    assert.deepEqual(d.periods[0].details, {});
    assert.equal(d.periods[0].pl.sales, 100);
    assert.equal(src.version, 3);
    assert.equal(src.settings, undefined);
  });
  test('migrate 経由で v3 → v4、計算結果は移行前と同じ', () => {
    const before = buildComparison(getSampleMultiData(), 'end');
    const old = JSON.parse(JSON.stringify(getSampleMultiData()));
    old.version = 3;
    delete old.settings;
    old.periods.forEach((p) => delete p.details);
    const d = normalizeData(migrate(old));
    assert.equal(d.version, CURRENT_VERSION);
    assert.deepEqual(buildComparison(d, 'end'), before);
  });
  test('v3 のバックアップを復元できる', () => {
    const r = parseBackup(JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: null, data: v3() }));
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 8);
    assert.deepEqual(r.data.settings, S());
  });
  test('v4 バックアップの往復で設定・内訳も復元される', () => {
    let { data, key } = addCustomAccount(getSampleData(), 'sga', '役員報酬');
    data = setDetailValue(data, 0, key, 1000);
    data = updateSettings(data, { units: setUnit(data.settings, 'all', 'yen').units, backupReminderDays: 7 });
    const r = parseBackup(backupToJson(data));
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, data);
  });
  test('details の値が数値でなければ復元を拒否', () => {
    const d = JSON.parse(JSON.stringify(getSampleData()));
    d.periods[0].details = { 'c-1': 'abc' };
    const r = parseBackup(JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: null, data: d }));
    assert.equal(r.ok, false);
    assert.match(r.error, /details/);
  });
});

describe('その他', () => {
  test('バックアップのリマインド日数（0 は案内しない）', () => {
    const NOW = new Date('2026-10-24T00:00:00Z');
    const day = 86400000;
    assert.equal(needsBackupReminder(new Date(NOW - 7 * day), true, NOW, 7), true);
    assert.equal(needsBackupReminder(new Date(NOW - 6 * day), true, NOW, 7), false);
    assert.equal(needsBackupReminder(null, true, NOW, 0), false);
  });
  test('クリアしても設定は引き継げる', () => {
    const s = setUnit(S(), 'all', 'yen');
    assert.equal(createEmptyData(s).settings.units.compare, 'yen');
    assert.equal(createEmptyData().settings.units.compare, 'thousand');
  });
  test('内訳だけ入力されていてもデータありとみなす', () => {
    let { data, key } = addCustomAccount(createEmptyData(), 'sga', 'x');
    assert.equal(hasAnyData(data), false);
    data = setDetailValue(data, 0, key, 1);
    assert.equal(hasAnyData(data), true);
  });
});

describe('単位の区分ごと設定', () => {
  test('区分は6つで、既定はすべて千円', () => {
    assert.deepEqual(UNIT_SCOPES.map((x) => x.id), ['pl', 'bs', 'ebitda', 'netDebt', 'compare', 'report']);
    assert.equal(commonUnit(S()).name, '千円');
  });
  test('区分ごとに単位を変えると、その区分だけ換算される', () => {
    let s = setUnit(S(), 'pl', 'yen');
    s = setUnit(s, 'report', 'million');
    assert.equal(toDisplayAmount(1.5, s, 'pl'), 1500);
    assert.equal(toDisplayAmount(1.5, s, 'bs'), 1.5);
    assert.equal(fromDisplayAmount(2500, s, 'pl'), 2.5);
    assert.equal(formatAmount(123456, formatOptions(s, 'report')), '123.5');
    assert.equal(formatOptions(s, 'compare').amountUnit, '千円');
    assert.equal(commonUnit(s), null);
  });
  test('setUnit：all で全区分、不明な区分・単位は変更しない', () => {
    const s0 = S();
    assert.equal(commonUnit(setUnit(s0, 'all', 'yen')).name, '円');
    assert.equal(setUnit(s0, 'zzz', 'yen'), s0);
    assert.equal(setUnit(s0, 'pl', 'dollar'), s0);
    assert.equal(s0.units.pl, 'thousand');
  });
  test('CSV は「印刷用レポート・CSV」の単位を使う', () => {
    const d = { ...getSampleData(), settings: setUnit(setUnit(S(), 'compare', 'yen'), 'report', 'million') };
    assert.match(buildComparisonCsv(d, 'end'), /主要数値,売上高,百万円,100\r\n/);
  });
  test('不正な区分の値は旧形式の unit または千円で補う', () => {
    const s = normalizeSettings({ units: { pl: 'yen', bs: 'x' } });
    assert.equal(s.units.pl, 'yen');
    assert.equal(s.units.bs, 'thousand');
    const old = normalizeSettings({ unit: 'million' });
    assert.equal(commonUnit(old).name, '百万円');
  });
});

describe('データ移行 version 4 → 5', () => {
  const v4 = (unit) => {
    const d = JSON.parse(JSON.stringify(getSampleData()));
    d.version = 4;
    const { units, ...rest } = d.settings;
    d.settings = { ...rest, unit };
    return d;
  };
  test('全体の単位（unit）を全区分の単位（units）に引き継ぐ（元データは不変）', () => {
    const src = v4('yen');
    const d = migrateV4toV5(src);
    assert.equal(d.version, 5);
    assert.equal(commonUnit(d.settings).name, '円');
    assert.equal(d.settings.unit, undefined);
    assert.equal(src.version, 4);
    assert.equal(src.settings.unit, 'yen');
  });
  test('v4 のバックアップを復元でき、金額と計算結果は変わらない', () => {
    const src = v4('million');
    const r = parseBackup(JSON.stringify({ format: 'finAnalysisTool-backup', formatVersion: 1, exportedAt: null, data: src }));
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 8);
    assert.equal(r.data.settings.units.report, 'million');
    assert.deepEqual(r.data.periods, getSampleData().periods);
  });
});
