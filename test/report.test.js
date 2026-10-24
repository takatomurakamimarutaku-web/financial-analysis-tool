import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_VERSION, REPORT_COMMENT_MAX, migrate, migrateDataV7toV8, normalizeData, getSampleMultiData, backupToJson, parseBackup,
} from '../js/store.js';
import { createDefaultReportSettings, normalizeReportSettings, normalizeSettings, REPORT_TEXT_MAX } from '../js/settings.js';
import {
  WORKSPACE_VERSION, migrateV8toV9, migrateV9toV10, migrateV7toV8, toWorkspace, activeData, withActiveData, duplicateCompany, parseAnyBackup,
} from '../js/workspace.js';
import { calcIndicators } from '../js/calc.js';

// version 7 の1社分のデータ（所見コメント・レポート設定なし）
function v7() {
  const d = getSampleMultiData();
  const { reportComment, ...rest } = d;
  const { report, ...settings } = d.settings;
  return { ...rest, version: 7, settings };
}

describe('データ移行 version 7 → 8（レポートの所見・作成者）', () => {
  test('所見コメントは空、レポート設定は既定値。金額・計算結果は変わらない', () => {
    const d = migrateDataV7toV8(v7());
    assert.equal(d.version, 8);
    assert.equal(d.reportComment, '');
    assert.deepEqual(d.settings.report, createDefaultReportSettings());
    assert.deepEqual(d.periods, v7().periods);
    assert.deepEqual(calcIndicators(d.periods[2]), calcIndicators(v7().periods[2]));
    assert.equal(normalizeData(migrate(v7())).version, CURRENT_VERSION);
  });
  test('v7 のバックアップも復元できる', () => {
    const r = parseBackup(backupToJson(v7()));
    assert.equal(r.ok, true);
    assert.equal(r.data.reportComment, '');
  });
  test('所見コメントは文字列のみ・上限で切る。文字列以外は形式エラー', () => {
    assert.equal(normalizeData({ ...getSampleMultiData(), reportComment: 'x'.repeat(REPORT_COMMENT_MAX + 5) }).reportComment.length, REPORT_COMMENT_MAX);
    assert.equal(normalizeData({ ...getSampleMultiData(), reportComment: 3 }).reportComment, '');
    const r = parseBackup(backupToJson({ ...getSampleMultiData(), reportComment: 3 }));
    assert.equal(r.ok, false);
  });
});

describe('レポートの設定', () => {
  test('既定：作成者・事務所名は空、表紙・グラフ・ページ番号はあり', () => {
    assert.deepEqual(normalizeSettings({}).report, { author: '', office: '', cover: true, charts: true, pageNumbers: true });
  });
  test('不正な値は既定値。長い名前は上限で切る', () => {
    const r = normalizeReportSettings({ author: 'x'.repeat(REPORT_TEXT_MAX + 1), office: 5, cover: false, charts: 'no', pageNumbers: false });
    assert.equal(r.author.length, REPORT_TEXT_MAX);
    assert.equal(r.office, '');
    assert.equal(r.cover, false);
    assert.equal(r.charts, true);
    assert.equal(r.pageNumbers, false);
    assert.deepEqual(normalizeReportSettings(null), createDefaultReportSettings());
  });
});

describe('データ移行 version 9 → 10（会社ごとの所見コメント）', () => {
  test('各社に空の所見コメントが加わる', () => {
    const v9 = migrateV8toV9(migrateV7toV8(getSampleMultiData()));
    v9.companies = v9.companies.map(({ reportComment, ...c }) => c);
    const v10 = migrateV9toV10(v9);
    assert.equal(v10.version, 10);
    assert.equal(v10.companies[0].reportComment, '');
    assert.deepEqual(v10.companies[0].periods, v9.companies[0].periods);
    assert.equal(migrateV9toV10(v10), v10);
    assert.equal(toWorkspace(v9).version, WORKSPACE_VERSION);
  });
  test('所見コメントは会社ごとに保存され、書き戻し・複製・全社バックアップで保たれる', () => {
    let ws = toWorkspace(getSampleMultiData());
    ws = withActiveData(ws, { ...activeData(ws), reportComment: '収益性は改善傾向' });
    assert.equal(ws.companies[0].reportComment, '収益性は改善傾向');
    assert.equal(activeData(ws).reportComment, '収益性は改善傾向');
    ws = duplicateCompany(ws, ws.companies[0].id);
    assert.equal(ws.companies[1].reportComment, '収益性は改善傾向');
    const r = parseAnyBackup(backupToJson(ws));
    assert.deepEqual(r.workspace, ws);
  });
});
