import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenRange, estimateHighlightTokens } from '../src/tokenEstimate';
import { highlightPlan } from '../src/highlightPlan';
import { defaultPrompts } from '../src/aiPrompts';
import type { Report } from '../src/types';

const fixture = () => ({ readerPortrait: { allHighlights: Array.from({ length: 200 }, (_, index) => ({ id: String(index), bookId: `book:${index % 4}`, bookTitle: '测试书籍', text: `原句${index}${'中文阅读材料'.repeat(20)}` })) } }) as unknown as Report;

test('token estimates include repeated prompts and grow when using all highlights', () => {
  const report = fixture();
  const selected = highlightPlan(report, 'collision'), all = highlightPlan(report, 'collision', 'all');
  const base = estimateHighlightTokens(selected, 'collision', defaultPrompts.collision);
  const expanded = estimateHighlightTokens(selected, 'collision', defaultPrompts.collision + '补充阅读方向'.repeat(100));
  const complete = estimateHighlightTokens(all, 'collision', defaultPrompts.collision);
  assert.ok(base.inputLow > 0 && base.inputHigh > base.inputLow);
  assert.ok(expanded.inputHigh > base.inputHigh);
  assert.ok(complete.inputHigh > base.inputHigh);
  assert.equal(base.outputLimit, selected.batches.length * 3600);
  const unicode = tokenRange('中文阅读');
  assert.ok(unicode.high > unicode.low);
});

test('cognition accounts for a potential synthesis call and empty plans cost zero', () => {
  const plan = highlightPlan(fixture(), 'cognition');
  const estimate = estimateHighlightTokens(plan, 'cognition', defaultPrompts.cognition);
  assert.equal(estimate.outputLimit, plan.batches.length * 3000 + 4000);
  const empty = highlightPlan({ readerPortrait: { allHighlights: [] } } as unknown as Report, 'collision');
  assert.deepEqual(estimateHighlightTokens(empty, 'collision', ''), { inputLow: 0, inputHigh: 0, outputLimit: 0 });
});
