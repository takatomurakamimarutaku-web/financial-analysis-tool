import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineChartSvg, escapeXml, niceTicks } from '../js/chart.js';

describe('chart.js', () => {
  test('escapeXml', () => {
    assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  test('niceTicks：範囲を覆う切りの良い目盛り', () => {
    const t = niceTicks(82000, 100000);
    assert.ok(t[0] <= 82000 && t[t.length - 1] >= 100000);
    assert.ok(t.length >= 2 && t.length <= 8);
    assert.deepEqual(niceTicks(NaN, 1), []);
    const same = niceTicks(5, 5);
    assert.ok(same[0] < 5 && same[same.length - 1] > 5);
  });
  test('点の数 = 数値の数、null で線が途切れる', () => {
    const svg = buildLineChartSvg({ labels: ['A', 'B', 'C', 'D'], values: [1, 2, null, 4] });
    assert.equal((svg.match(/<circle/g) || []).length, 3);
    assert.equal((svg.match(/<polyline/g) || []).length, 1);
  });
  test('1期のみでも描画できる', () => {
    const svg = buildLineChartSvg({ labels: ['2025/3期'], values: [100] });
    assert.equal((svg.match(/<circle/g) || []).length, 1);
    assert.ok(!svg.includes('NaN'));
  });
  test('データなし', () => {
    const svg = buildLineChartSvg({ labels: ['A'], values: [null] });
    assert.match(svg, /データなし/);
  });
  test('期名はエスケープされる', () => {
    const svg = buildLineChartSvg({ labels: ['<script>'], values: [1], title: '"x"' });
    assert.ok(!svg.includes('<script>'));
    assert.match(svg, /&lt;script&gt;/);
  });
  test('マイナス値を含んでも NaN にならない', () => {
    const svg = buildLineChartSvg({ labels: ['A', 'B'], values: [-0.05, 0.1] });
    assert.ok(!svg.includes('NaN'));
    assert.match(svg, /chart-zero/);
  });
});
