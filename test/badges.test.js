import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BADGE_TARGETS, TKC_TARGETS, JFC_INDUSTRIES, CRITERIA, JFC_DATA_CHECKED_AT, jfcSurveyLabel, jfcYearsSummary, jfcUpdateDue,
  createDefaultEvaluation, normalizeEvaluation, ruleFor, judge, badgeFor, badgesFor,
  criterionLabel, guideFor, boundsText, setCriterion, setOverride, resetOverrides,
  setTkcValue, setBadgeDisabled, reportNote, isModified,
} from '../js/badges.js';
import { calcIndicators, INDICATORS } from '../js/calc.js';
import { createDefaultSettings, normalizeSettings } from '../js/settings.js';
import { migrate, migrateV6toV7, normalizeData, getSampleData, parseBackup, backupToJson } from '../js/store.js';

const ev = (changes = {}) => ({ ...createDefaultEvaluation(), ...changes });
const ok = (value) => ({ value, status: 'ok' });
const period = (pl = {}, bs = {}) => ({ pl, bs, adjustments: [], debtLikeItems: [], cashLikeItems: [] });

describe('評価バッジ：基準セット', () => {
  test('対象はすべて既存の指標または比較表の行', () => {
    const ids = new Set([...INDICATORS.map((i) => i.id), 'adjustedNetDebtToNormalizedEbitda', 'normalizedEbitdaMargin']);
    for (const t of BADGE_TARGETS) assert.ok(ids.has(t.id), t.id);
    assert.equal(CRITERIA.length, 4);
  });
  test('公庫は9業種・9指標で、出典ファイルと年度を持つ', () => {
    assert.equal(JFC_INDUSTRIES.length, 9);
    for (const ind of JFC_INDUSTRIES) {
      assert.equal(Object.keys(ind.values).length, 9, ind.id);
      assert.match(ind.year, /^202[45]年度$/);
      assert.match(ind.file, /^sme_findings2_\d\db\.pdf$/);
      for (const [avg, median] of Object.values(ind.values)) {
        assert.equal(typeof avg, 'number');
        assert.equal(typeof median, 'number');
      }
    }
    assert.equal(JFC_INDUSTRIES.find((x) => x.id === 'construction').year, '2024年度');
    assert.equal(JFC_INDUSTRIES.find((x) => x.id === 'manufacturing').year, '2024年度');
    assert.equal(JFC_INDUSTRIES.find((x) => x.id === 'services').year, '2025年度');
  });
  test('公庫データの年度・公表月（年次更新の確認用）', () => {
    for (const ind of JFC_INDUSTRIES) {
      assert.match(ind.published, /^\d{4}-(0[1-9]|1[0-2])$/, ind.id);
      // 公表は調査年度の翌年
      assert.equal(Number(ind.published.slice(0, 4)), Number(ind.year.slice(0, 4)) + 1, ind.id);
      assert.ok(ind.count > 0 && ind.goodCount > 0 && ind.goodCount <= ind.count, ind.id);
    }
    assert.match(JFC_DATA_CHECKED_AT, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(jfcSurveyLabel(JFC_INDUSTRIES[0]), '2024年度調査');
    assert.equal(jfcYearsSummary(), '建設業・製造業は2024年度調査（2025年8月公表）、ほかの業種は2025年度調査（2026年8月公表）です');
    assert.equal(jfcYearsSummary([JFC_INDUSTRIES[2]]), 'すべての業種が2025年度調査（2026年8月公表）です');
    assert.equal(jfcUpdateDue(new Date(2026, 9, 24)), false);
    assert.equal(jfcUpdateDue(new Date(2027, 8, 30)), false);
    assert.equal(jfcUpdateDue(new Date(2027, 9, 1)), true);
    assert.match(guideFor('equityRatio', ev({ criterion: 'jfc', jfcIndustry: 'services' })).source, /2025年度調査/);
  });
  test('標準のしきい値', () => {
    const r = ruleFor('currentRatio', ev());
    assert.deepEqual([r.dir, r.good, r.caution, r.source], ['high', 150, 100, 'standard']);
    assert.deepEqual([ruleFor('fixedRatio', ev()).good, ruleFor('fixedRatio', ev()).caution], [100, 200]);
    assert.equal(ruleFor('ccc', ev()), null); // 回転日数はバッジなし
  });
  test('古田土会計：変更のある指標だけ置き換え、残りは標準。境界ごとに引き継ぎを記録', () => {
    const e = ev({ criterion: 'furutado' });
    assert.deepEqual([ruleFor('equityRatio', e).good, ruleFor('equityRatio', e).caution], [60, 30]);
    const q = ruleFor('quickRatio', e);
    assert.deepEqual([q.good, q.caution, q.source], [100, 70, 'furutado']);
    assert.deepEqual(q.inherited, { good: false, caution: true });
    assert.equal(ruleFor('operatingMargin', e).source, 'standard');
    assert.deepEqual([ruleFor('assetTurnover', e).good, ruleFor('assetTurnover', e).caution], [2.5, 1.5]);
  });
  test('公庫：良好 = 黒字かつ自己資本プラス企業平均、注意 = 中央値。対象外の指標は標準', () => {
    const e = ev({ criterion: 'jfc', jfcIndustry: 'manufacturing' });
    const r = ruleFor('equityRatio', e);
    assert.deepEqual([r.good, r.caution, r.source], [24.5, -3.8, 'jfc']);
    assert.equal(ruleFor('roe', e).source, 'standard');
    assert.match(guideFor('roe', e).notes.join(), /公庫の調査にない指標/);
  });
  test('公庫：平均が中央値より悪い指標は中央値を良好の境界にする', () => {
    const e = ev({ criterion: 'jfc', jfcIndustry: 'manufacturing' });
    const f = ruleFor('fixedLongTermRatio', e); // 低いほど良い：平均53.2 < 中央値60.7 は通常
    assert.deepEqual([f.good, f.caution], [53.2, 60.7]);
    const s = ruleFor('grossMargin', ev({ criterion: 'jfc', jfcIndustry: 'services' })); // 平均75.7 < 中央値84.3
    assert.deepEqual([s.good, s.caution], [84.3, 84.3]);
    assert.match(guideFor('grossMargin', ev({ criterion: 'jfc', jfcIndustry: 'services' })).notes.join(), /中央値を良好の境界/);
  });
  test('TKC：初期値は空で、未入力の指標は標準。入力した値で判定する', () => {
    const e = ev({ criterion: 'tkc' });
    assert.deepEqual(e.tkc, { industry: '', values: {} });
    assert.equal(ruleFor('equityRatio', e).source, 'standard');
    assert.match(guideFor('equityRatio', e).notes.join(), /TKCの値が未入力/);
    const e2 = setTkcValue(e, 'equityRatio', { good: 45, caution: 20 });
    const r = ruleFor('equityRatio', e2);
    assert.deepEqual([r.good, r.caution, r.source], [45, 20, 'tkc']);
    assert.equal(badgeFor('equityRatio', ok(0.5), period(), e2).text, '優良水準');
    assert.equal(badgeFor('equityRatio', ok(0.1), period(), e2).text, '黒字平均未満');
    assert.equal(setTkcValue(e2, 'equityRatio', { good: null, caution: null }).tkc.values.equityRatio, undefined);
    assert.equal(setTkcValue(e, 'netDebtToEbitda', { good: 1 }), e); // 入力対象外
    assert.ok(!TKC_TARGETS.includes('netDebtToEbitda'));
  });
});

describe('評価バッジ：判定', () => {
  test('境界値は良好側（以上・以下）。注意は未満・超', () => {
    const hi = { dir: 'high', good: 5, caution: 0 };
    assert.equal(judge(hi, 5), 'good');
    assert.equal(judge(hi, 4.99), null);
    assert.equal(judge(hi, 0), null);
    assert.equal(judge(hi, -0.01), 'caution');
    const lo = { dir: 'low', good: 100, caution: 200 };
    assert.equal(judge(lo, 100), 'good');
    assert.equal(judge(lo, 200), null);
    assert.equal(judge(lo, 200.01), 'caution');
    assert.equal(judge(hi, null), null);
  });
  test('% は丸める前の値で判定（浮動小数の誤差で境界を外さない）', () => {
    assert.equal(badgeFor('equityRatio', ok(0.29 + 0.01), period(), ev()).level, 'good'); // 0.3 付近
    assert.equal(badgeFor('equityRatio', ok(0.2999), period(), ev()), null); // 表示は30.0%でも未満
  });
  test('分母0・未入力・参考外はバッジなし', () => {
    assert.equal(badgeFor('currentRatio', { value: null, status: 'na' }, period(), ev()), null);
    assert.equal(badgeFor('roe', { value: null, status: 'notApplicable' }, period(), ev()), null);
    assert.equal(badgeFor('currentRatio', undefined, period(), ev()), null);
  });
  test('自己資本比率マイナスは「注意（債務超過）」', () => {
    const b = badgeFor('equityRatio', ok(-0.1), period(), ev({ criterion: 'jfc' }));
    assert.equal(b.text, '同業中央値未満（債務超過）');
    assert.equal(badgeFor('equityRatio', ok(-0.1), period(), ev()).text, '注意（債務超過）');
  });
  test('ROE は自己資本比率が注意のとき良好にしない', () => {
    const thin = period({}, { netAssets: 5, totalAssets: 100 });
    assert.equal(badgeFor('roe', ok(0.5), thin, ev()), null);
    const thick = period({}, { netAssets: 40, totalAssets: 100 });
    assert.equal(badgeFor('roe', ok(0.5), thick, ev()).text, '良好');
    assert.equal(badgeFor('roe', ok(-0.1), thin, ev()).text, '注意');
  });
  test('ICR：支払利息0で営業黒字は良好（利息負担なし）、営業赤字は注意', () => {
    const na = { value: null, status: 'na' };
    assert.equal(badgeFor('icr', na, period({ interestExpense: 0, operatingIncome: 10 }), ev()).text, '良好（利息負担なし）');
    assert.equal(badgeFor('icr', na, period({ interestExpense: 0, operatingIncome: -10 }), ev()).text, '注意（営業赤字）');
    assert.equal(badgeFor('icr', na, period({ interestExpense: null, operatingIncome: 10 }), ev()), null);
  });
  test('ネットデット÷EBITDA：ネットキャッシュは良好、EBITDA赤字で借入ありは注意', () => {
    const cash = period({ operatingIncome: 10, depreciation: 0 }, { interestBearingDebt: 10, cash: 30 });
    assert.equal(badgeFor('netDebtToEbitda', ok(-2), cash, ev()).text, '良好（実質無借金）');
    const loss = period({ operatingIncome: -20, depreciation: 5 }, { interestBearingDebt: 100, cash: 30 });
    assert.equal(badgeFor('netDebtToEbitda', { value: null, status: 'notApplicable' }, loss, ev()).text, '注意（EBITDA赤字）');
    const mid = period({ operatingIncome: 10, depreciation: 0 }, { interestBearingDebt: 70, cash: 30 });
    assert.equal(badgeFor('netDebtToEbitda', ok(4), mid, ev()), null);
    assert.equal(badgeFor('netDebtToEbitda', ok(6), mid, ev()).text, '注意');
  });
  test('D/E：有利子負債0は良好', () => {
    assert.equal(badgeFor('deRatio', ok(0), period(), ev()).text, '良好');
  });
  test('サンプルデータの全指標を判定できる（標準・古田土・公庫）', () => {
    const d = getSampleData();
    const p = d.periods[0];
    const res = calcIndicators(p);
    for (const c of ['standard', 'furutado', 'jfc', 'tkc']) {
      const out = badgesFor(res, p, ev({ criterion: c }));
      for (const b of Object.values(out)) {
        assert.ok(['good', 'caution'].includes(b.level));
        assert.equal(typeof b.text, 'string');
      }
    }
  });
  test('全体オフ・指標ごとのオフ', () => {
    assert.equal(badgeFor('currentRatio', ok(3), period(), ev({ enabled: false })), null);
    const e = setBadgeDisabled(ev(), 'currentRatio', true);
    assert.equal(badgeFor('currentRatio', ok(3), period(), e), null);
    assert.equal(badgeFor('quickRatio', ok(3), period(), e).level, 'good');
    assert.deepEqual(setBadgeDisabled(e, 'currentRatio', false).disabled, []);
  });
});

describe('評価バッジ：表示と設定', () => {
  test('現在の基準名', () => {
    assert.equal(criterionLabel(ev()), '標準');
    assert.equal(criterionLabel(ev({ criterion: 'jfc', jfcIndustry: 'manufacturing' })), '公庫・製造業（2024年度調査）');
    assert.equal(criterionLabel(ev({ criterion: 'tkc' })), 'TKC・業種未入力（自分で入力）');
    const e = setOverride(ev({ criterion: 'furutado' }), 'equityRatio', { good: 50, caution: 30 });
    assert.equal(criterionLabel(e), '古田土会計（一部変更）');
    assert.equal(isModified(setCriterion(e, 'standard')), false); // 変更は基準ごと
    assert.equal(criterionLabel(resetOverrides(e)), '古田土会計');
  });
  test('しきい値の変更は判定に反映され、ラベルは「良好・注意」になる', () => {
    let e = ev({ criterion: 'jfc', jfcIndustry: 'manufacturing' });
    e = setOverride(e, 'currentRatio', { good: 300, caution: '' });
    const r = ruleFor('currentRatio', e);
    assert.deepEqual([r.good, r.caution, r.modified], [300, null, true]);
    assert.equal(badgeFor('currentRatio', ok(3.5), period(), e).text, '良好');
    assert.equal(badgeFor('currentRatio', ok(0.5), period(), e), null);
    assert.equal(setOverride(e, 'currentRatio', null).overrides.jfc, undefined);
  });
  test('評価の目安の文言', () => {
    const g = guideFor('equityRatio', ev({ criterion: 'furutado' }));
    assert.equal(g.text, '良好 60%以上 ／ 注意 30%未満');
    assert.equal(g.source, '古田土会計');
    assert.equal(boundsText(ruleFor('fixedRatio', ev())), '良好 100%以下 ／ 注意 200%超');
    assert.equal(boundsText(ruleFor('assetTurnover', ev())), 'この基準では評価しません');
    const j = guideFor('equityRatio', ev({ criterion: 'jfc', jfcIndustry: 'manufacturing' }));
    assert.match(j.notes[0], /黒字かつ自己資本プラス企業平均 24.5% ／ 中央値 -3.8%/);
  });
  test('レポートの注記に基準と出典が入る。オフなら空', () => {
    assert.match(reportNote(ev({ criterion: 'jfc', jfcIndustry: 'construction' })), /公庫・建設業（2024年度調査）.*小企業の経営指標調査.*6,838社/);
    assert.equal(reportNote(ev({ enabled: false })), '');
  });
  test('normalizeEvaluation は不正な値を既定に戻し、TKCの業種名・値を残す', () => {
    const n = normalizeEvaluation({
      enabled: false, criterion: 'x', jfcIndustry: 'y', disabled: ['roe', 'zzz', 'roe'],
      overrides: { furutado: { equityRatio: { good: 50, caution: 'a' }, nope: { good: 1 } }, tkc: { roe: { good: 1 } } },
      tkc: { industry: '金属製品製造業', values: { roe: { good: 12, caution: 5 }, netDebt: { good: 1 }, roa: { good: null } } },
    });
    assert.equal(n.enabled, false);
    assert.equal(n.criterion, 'standard');
    assert.equal(n.jfcIndustry, 'manufacturing');
    assert.deepEqual(n.disabled, ['roe']);
    assert.deepEqual(n.overrides, { furutado: { equityRatio: { good: 50, caution: null } } });
    assert.deepEqual(n.tkc, { industry: '金属製品製造業', values: { roe: { good: 12, caution: 5 } } });
    assert.deepEqual(normalizeEvaluation(null), createDefaultEvaluation());
  });
});

describe('データ移行 version 6 → 7', () => {
  const v6 = () => {
    const d = JSON.parse(JSON.stringify(getSampleData()));
    d.version = 6;
    delete d.settings.evaluation;
    return d;
  };
  test('評価基準を既定（標準・表示オン）で追加し、金額と他の設定は変えない', () => {
    const src = v6();
    const d = migrateV6toV7(src);
    assert.equal(d.version, 7);
    assert.deepEqual(d.settings.evaluation, createDefaultEvaluation());
    assert.deepEqual(d.periods, src.periods);
    assert.deepEqual({ ...d.settings, evaluation: undefined }, { ...normalizeSettings(src.settings), evaluation: undefined });
    assert.equal(src.settings.evaluation, undefined); // 元データは変更しない
  });
  test('migrate・バックアップ復元で v7 になり、TKC の入力値もバックアップに含まれる', () => {
    assert.equal(normalizeData(migrate(v6())).version, 8);
    const d = getSampleData();
    d.settings.evaluation = setTkcValue({ ...d.settings.evaluation, criterion: 'tkc' }, 'roa', { good: 8, caution: 3 });
    const r = parseBackup(backupToJson(d));
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.settings.evaluation.tkc.values.roa, { good: 8, caution: 3 });
    assert.equal(r.data.settings.evaluation.criterion, 'tkc');
  });
  test('既定の設定に評価基準が入る', () => {
    assert.deepEqual(createDefaultSettings().evaluation, createDefaultEvaluation());
  });
});
