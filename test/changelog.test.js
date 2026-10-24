import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG, changesSince } from '../js/changelog.js';
import { APP_VERSION } from '../js/pwa.js';

test('更新履歴の先頭は現在のバージョンで、版は重複しない', () => {
  assert.equal(CHANGELOG[0].version, APP_VERSION);
  assert.equal(new Set(CHANGELOG.map((e) => e.version)).size, CHANGELOG.length);
  for (const e of CHANGELOG) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.items.length > 0);
  }
});

test('前回のバージョンから現在までの変更点', () => {
  const log = [{ version: 'v3', items: ['c'] }, { version: 'v2', items: ['b'] }, { version: 'v1', items: ['a'] }];
  assert.deepEqual(changesSince('v1', 'v3', log).map((e) => e.version), ['v3', 'v2']);
  assert.deepEqual(changesSince('v2', 'v3', log).map((e) => e.version), ['v3']);
  assert.deepEqual(changesSince(null, 'v3', log), []); // 初めての起動
  assert.deepEqual(changesSince('v3', 'v3', log), []);
  assert.deepEqual(changesSince('v0', 'v3', log).map((e) => e.version), ['v3']); // 履歴にない古い版：最新分のみ
  assert.deepEqual(changesSince('v1', 'v9', log), []);
});
