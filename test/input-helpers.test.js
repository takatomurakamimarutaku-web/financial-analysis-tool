import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_FIELDS, copyFromPrevious, liveGroup, missingRequired } from '../js/input-helpers.js';
import { createEmptyPeriod, getSampleMultiData } from '../js/store.js';

describe('未入力の主な科目', () => {
  test('空の期はすべて、サンプルの期はなし', () => {
    assert.equal(missingRequired(createEmptyPeriod('')).length, REQUIRED_FIELDS.length);
    assert.deepEqual(missingRequired(getSampleMultiData().periods[2]), []);
  });
  test('0 は入力済み。非表示の科目は数えない', () => {
    const p = createEmptyPeriod('');
    p.pl.sales = 0;
    const keys = missingRequired(p, ['depreciation']).map((f) => f.key);
    assert.ok(!keys.includes('sales'));
    assert.ok(!keys.includes('depreciation'));
    assert.ok(keys.includes('netAssets'));
  });
});

describe('前の期からのコピー', () => {
  const prev = () => getSampleMultiData().periods[1];
  test('未入力の欄にだけコピーし、入力済みの欄は変えない', () => {
    const cur = createEmptyPeriod('2026/3期');
    cur.pl.sales = 999;
    const { period, count } = copyFromPrevious(cur, prev());
    assert.equal(period.pl.sales, 999);
    assert.equal(period.bs.cash, prev().bs.cash);
    assert.equal(period.label, '2026/3期');
    assert.deepEqual(period.adjustments, []);
    const filled = Object.values(prev().pl).filter((v) => typeof v === 'number').length + Object.values(prev().bs).filter((v) => typeof v === 'number').length;
    assert.equal(count, filled - 1);
    assert.equal(cur.bs.cash, null, '元の期は変えない');
  });
  test('コピーするものがなければ0件', () => {
    assert.equal(copyFromPrevious(prev(), prev()).count, 0);
    assert.equal(copyFromPrevious(createEmptyPeriod(''), null).count, 0);
  });
  test('内訳：親科目に直接入力済みで内訳がない期には、その親の内訳はコピーしない', () => {
    const custom = [{ key: 'c-1', parent: 'sga' }, { key: 'c-2', parent: 'cash' }];
    const p0 = { ...createEmptyPeriod(''), details: { 'c-1': 100, 'c-2': 50 } };
    const cur = createEmptyPeriod('');
    cur.pl.sga = 300;
    const { period } = copyFromPrevious(cur, p0, custom);
    assert.equal(period.details['c-1'], undefined);
    assert.equal(period.details['c-2'], 50);
  });
});

describe('入力中の桁区切り', () => {
  test('整数部に3桁ごとのカンマ。小数・マイナス・△にも対応', () => {
    assert.deepEqual(liveGroup('1234567'), { text: '1,234,567', caret: 9 });
    assert.equal(liveGroup('-12345.678').text, '-12,345.678');
    assert.equal(liveGroup('△1000').text, '△1,000');
    assert.equal(liveGroup('1,2345').text, '12,345');
    assert.equal(liveGroup('1000.').text, '1,000.');
  });
  test('カーソルはカンマ以外の文字数で同じ位置に戻す', () => {
    // 「1234|5」→「12,34|5」
    assert.deepEqual(liveGroup('12345', 4), { text: '12,345', caret: 5 });
    // 先頭
    assert.deepEqual(liveGroup('12345', 0), { text: '12,345', caret: 0 });
  });
  test('数字でない・全角・空はそのまま', () => {
    assert.deepEqual(liveGroup('abc', 1), { text: 'abc', caret: 1 });
    assert.deepEqual(liveGroup('１２３４', 2), { text: '１２３４', caret: 2 });
    assert.deepEqual(liveGroup('-', 1), { text: '-', caret: 1 });
    assert.equal(liveGroup('999').text, '999');
  });
});
