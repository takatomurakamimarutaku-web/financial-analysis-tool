import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCLAIMER, PRIVACY, REPORT_DISCLAIMER, ONBOARDING_STEPS, COPYRIGHT, CONTACT,
  indicatorHelp, hasHelp, helpCatalog,
} from '../js/help.js';
import { INDICATORS, buildComparison } from '../js/calc.js';
import { createDefaultEvaluation } from '../js/badges.js';
import { getSampleMultiData } from '../js/store.js';

describe('免責・プライバシー・ガイドの文言', () => {
  test('参考値であること・助言ではないこと・外部送信しないことを含む', () => {
    assert.match(DISCLAIMER.join(), /参考値/);
    assert.match(DISCLAIMER.join(), /助言ではありません/);
    assert.match(PRIVACY.join(), /外部のサーバーへの送信.*一切ありません/);
    assert.match(REPORT_DISCLAIMER, /参考値.*助言/);
    assert.match(COPYRIGHT, /All rights reserved/);
    assert.equal(CONTACT, null); // 問い合わせ先は未定
  });
  test('初回ガイドは3画面で、サンプル導線とホーム画面追加の手順がある', () => {
    assert.equal(ONBOARDING_STEPS.length, 3);
    assert.ok(ONBOARDING_STEPS.some((s) => s.action === 'sample'));
    assert.match(ONBOARDING_STEPS.map((s) => s.lines.join()).join(), /ホーム画面に追加/);
  });
});

describe('指標のヘルプ', () => {
  test('全指標と比較表の追加行に計算式・意味がある', () => {
    const rows = buildComparison(getSampleMultiData()).rows.filter((r) => r.group !== 'amounts');
    for (const r of rows) {
      assert.ok(hasHelp(r.id), r.id);
      const h = indicatorHelp(r.id);
      assert.ok(h.formula && h.meaning, r.id);
    }
    assert.equal(indicatorHelp('sales'), null);
    assert.equal(hasHelp('sales'), false);
  });
  test('年日数を計算式に反映し、評価の目安を付ける', () => {
    assert.match(indicatorHelp('receivableDays', { days: 360 }).formula, /× 360/);
    const h = indicatorHelp('equityRatio', { evaluation: createDefaultEvaluation() });
    assert.equal(h.guide.text, '良好 30%以上 ／ 注意 10%未満');
    assert.equal(indicatorHelp('ccc', { evaluation: createDefaultEvaluation() }).guide, null);
  });
  test('解説一覧は区分ごとで、全指標を含む', () => {
    const cat = helpCatalog();
    const ids = cat.flatMap((g) => g.items.map((h) => h.id));
    for (const i of INDICATORS) assert.ok(ids.includes(i.id));
    assert.ok(ids.includes('adjustedNetDebtToNormalizedEbitda'));
  });
});
