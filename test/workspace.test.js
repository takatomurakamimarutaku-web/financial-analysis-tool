import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_VERSION, MAX_COMPANIES, migrateV7toV8, createWorkspace, normalizeWorkspace, toWorkspace, validateWorkspace,
  activeData, withActiveData, addCompany, duplicateCompany, renameCompany, removeCompany, moveCompany, setActiveCompany,
  companyLabel, loadWorkspace, saveWorkspace, parseAnyBackup, createUndoSnapshot, saveUndo, loadUndo, clearUndo,
} from '../js/workspace.js';
import {
  getSampleMultiData, getSampleData, createEmptyData, STORAGE_KEY, UNDO_KEY, deleteAllData, backupToJson,
} from '../js/store.js';
import { calcIndicators } from '../js/calc.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

describe('データ移行 version 7 → 8（複数社）', () => {
  test('v7 のデータはそのまま1社目になり、金額・設定・計算結果は変わらない', () => {
    const v7 = getSampleMultiData();
    const ws = migrateV7toV8(v7);
    assert.equal(ws.version, WORKSPACE_VERSION);
    assert.equal(ws.companies.length, 1);
    assert.equal(ws.activeId, ws.companies[0].id);
    const d = activeData(ws);
    assert.deepEqual(d, v7);
    assert.deepEqual(calcIndicators(d.periods[2]), calcIndicators(v7.periods[2]));
  });
  test('保存済みの v7 を読み込むと移行される（保存キーは従来と同じ）', () => {
    const st = memoryStorage();
    st.setItem(STORAGE_KEY, JSON.stringify(getSampleData()));
    const { workspace, error } = loadWorkspace(st);
    assert.equal(error, null);
    assert.equal(workspace.companies[0].companyName, 'サンプル株式会社');
    assert.equal(saveWorkspace(workspace, st).ok, true);
    assert.equal(JSON.parse(st.getItem(STORAGE_KEY)).version, 8);
    assert.deepEqual(loadWorkspace(st).workspace, workspace);
  });
  test('v1 など古い形式からも移行できる。壊れたデータはエラー', () => {
    const v1 = { version: 1, periods: [{ label: '', pl: {}, bs: {}, adjustments: [], debtLikeItems: [] }] };
    assert.equal(toWorkspace(v1).companies.length, 1);
    const st = memoryStorage();
    st.setItem(STORAGE_KEY, '{x');
    assert.match(loadWorkspace(st).error, /壊れている/);
    assert.equal(loadWorkspace(null).error, 'この環境ではデータを保存できません');
  });
});

describe('会社の操作', () => {
  const ws0 = () => migrateV7toV8(getSampleMultiData());
  test('追加・切り替え・書き戻し', () => {
    let ws = addCompany(ws0());
    assert.equal(ws.companies.length, 2);
    assert.equal(activeData(ws).companyName, '');
    const d = activeData(ws);
    ws = withActiveData(ws, { ...d, companyName: 'B社' });
    assert.equal(ws.companies[1].companyName, 'B社');
    ws = setActiveCompany(ws, ws.companies[0].id);
    assert.equal(activeData(ws).companyName, 'サンプル株式会社');
    assert.equal(setActiveCompany(ws, 'nope'), ws);
  });
  test('設定は全社共通', () => {
    let ws = addCompany(ws0());
    const d = activeData(ws);
    ws = withActiveData(ws, { ...d, settings: { ...d.settings, theme: 'dark' } });
    ws = setActiveCompany(ws, ws.companies[0].id);
    assert.equal(activeData(ws).settings.theme, 'dark');
  });
  test('複製は直後に入り、中身は独立している', () => {
    const base = ws0();
    const ws = duplicateCompany(base, base.companies[0].id);
    assert.equal(ws.companies[1].companyName, 'サンプル株式会社（コピー）');
    assert.equal(ws.activeId, ws.companies[1].id);
    ws.companies[1].periods[0].pl.sales = 1;
    assert.notEqual(base.companies[0].periods[0].pl.sales, 1);
  });
  test('名前変更・並べ替え・削除（最後の1社は削除できない）', () => {
    let ws = addCompany(ws0());
    const [a, b] = ws.companies;
    ws = renameCompany(ws, b.id, 'B社');
    assert.equal(companyLabel(ws.companies[1]), 'B社');
    ws = moveCompany(ws, b.id, -1);
    assert.deepEqual(ws.companies.map((c) => c.id), [b.id, a.id]);
    assert.equal(moveCompany(ws, b.id, -1), ws);
    ws = removeCompany(ws, b.id); // 選択中（B）を削除 → 残りを選ぶ
    assert.deepEqual(ws.companies.map((c) => c.id), [a.id]);
    assert.equal(ws.activeId, a.id);
    assert.equal(removeCompany(ws, a.id), ws);
    assert.equal(companyLabel({ companyName: ' ' }), '（会社名未入力）');
  });
  test(`会社は${MAX_COMPANIES}社まで`, () => {
    let ws = createWorkspace();
    for (let i = 0; i < MAX_COMPANIES + 3; i++) ws = addCompany(ws);
    assert.equal(ws.companies.length, MAX_COMPANIES);
    assert.equal(duplicateCompany(ws, ws.companies[0].id), ws);
  });
  test('正規化：id の重複・不正な activeId を直す。会社が0なら空の1社', () => {
    const ws = addCompany(ws0());
    const broken = { ...ws, activeId: 'x', companies: [ws.companies[0], { ...ws.companies[1], id: ws.companies[0].id }] };
    const n = normalizeWorkspace(broken);
    assert.notEqual(n.companies[0].id, n.companies[1].id);
    assert.equal(n.activeId, n.companies[0].id);
    assert.equal(normalizeWorkspace({ ...ws, companies: [] }).companies.length, 1);
    assert.equal(normalizeWorkspace({ version: 7 }), null);
  });
});

describe('バックアップ（1社分・全社）', () => {
  test('1社分のバックアップは従来形式で、kind=company として読める', () => {
    const r = parseAnyBackup(backupToJson(getSampleMultiData()));
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'company');
    assert.deepEqual(r.data, getSampleMultiData());
  });
  test('全社のバックアップは往復できる', () => {
    const ws = renameCompany(addCompany(migrateV7toV8(getSampleMultiData())), 'dummy', 'x');
    const r = parseAnyBackup(backupToJson(ws));
    assert.equal(r.kind, 'workspace');
    assert.deepEqual(r.workspace, ws);
  });
  test('全社のバックアップの不正な値は拒否', () => {
    const ws = migrateV7toV8(getSampleMultiData());
    ws.companies[0].periods[0].pl.sales = 'abc';
    const r = parseAnyBackup(backupToJson(ws));
    assert.equal(r.ok, false);
    assert.match(r.error, /companies\[0\]/);
    assert.deepEqual(validateWorkspace({ version: 8, companies: [] }), ['会社の数が不正です（1〜30社）']);
    assert.equal(parseAnyBackup('{}').ok, false);
    assert.equal(parseAnyBackup('').ok, false);
  });
});

describe('元に戻す（直前の全社の状態の退避）', () => {
  test('退避して読み戻すと同じ状態・期・操作名になる', () => {
    const st = memoryStorage();
    const ws = addCompany(migrateV7toV8(getSampleMultiData()));
    assert.equal(saveUndo(createUndoSnapshot(ws, 'removeCompany', 0, new Date('2026-10-24T00:00:00Z')), st), true);
    const u = loadUndo(st);
    assert.deepEqual(u.workspace, ws);
    assert.equal(u.label, '会社の削除');
    assert.equal(u.at.toISOString(), '2026-10-24T00:00:00.000Z');
    clearUndo(st);
    assert.equal(loadUndo(st), null);
  });
  test('v15〜v17 の1社分の退避（data）も読める', () => {
    const st = memoryStorage();
    st.setItem(UNDO_KEY, JSON.stringify({ action: 'clear', selected: 9, at: 'x', data: getSampleMultiData() }));
    const u = loadUndo(st);
    assert.deepEqual(activeData(u.workspace), getSampleMultiData());
    assert.equal(u.selected, 2);
    assert.equal(u.at, null);
  });
  test('壊れた退避データ・不正な形式は null。保存できない環境では false', () => {
    const st = memoryStorage();
    st.setItem(UNDO_KEY, '{');
    assert.equal(loadUndo(st), null);
    st.setItem(UNDO_KEY, JSON.stringify({ action: 'x', workspace: createWorkspace() }));
    assert.equal(loadUndo(st), null);
    const bad = getSampleMultiData();
    bad.periods[0].pl.sales = 'abc';
    st.setItem(UNDO_KEY, JSON.stringify({ action: 'clear', data: bad }));
    assert.equal(loadUndo(st), null);
    const broken = { setItem: () => { throw new Error('quota'); }, getItem: () => null, removeItem: () => {} };
    assert.equal(saveUndo(createUndoSnapshot(createWorkspace(), 'clear'), broken), false);
    assert.equal(saveUndo(createUndoSnapshot(createWorkspace(), 'clear'), null), false);
  });
  test('「すべてのデータを削除」は退避データも消す', () => {
    const st = memoryStorage();
    st.setItem(STORAGE_KEY, '{}');
    saveUndo(createUndoSnapshot(createWorkspace(), 'clear'), st);
    deleteAllData(st);
    assert.equal(st.map.has(UNDO_KEY), false);
    assert.equal(st.map.has(STORAGE_KEY), false);
  });
});

test('空のワークスペースは空の1社', () => {
  const ws = createWorkspace();
  assert.deepEqual(activeData(ws), createEmptyData());
});
