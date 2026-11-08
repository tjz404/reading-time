import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadingAtlas } from '../src/ReadingAtlas';
import type { Report } from '../src/types';

function atlasWith(categories: { name: string; hours: number }[]) {
  const report = { reading: { categories } } as unknown as Report;
  return renderToStaticMarkup(createElement(ReadingAtlas, { report, onExplore: () => {} }));
}

test('reading atlas ranks actual positive category hours and retains an accessible label', () => {
  const html = atlasWith([
    { name: '人文', hours: 12 },
    { name: '不纳入', hours: 0 },
    { name: '科学', hours: 25 },
  ]);
  assert.match(html, /阅读领域图谱：科学 25 小时；人文 12 小时/);
  assert.ok(html.indexOf('科学</text>') < html.indexOf('人文</text>'));
  assert.ok(!html.includes('不纳入'));
  assert.match(html, /探索阅读偏好/);
});

test('reading atlas shows a truthful empty state with no network', () => {
  const html = atlasWith([]);
  assert.match(html, /当前报告还没有分类时长/);
  assert.ok(!html.includes('atlas-network-mobile'));
});
