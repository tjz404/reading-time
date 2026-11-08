import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInsight } from '../lib/insights';
import type { AIConfig, Report, Row } from '../src/types';
import { highlightPlan, HIGHLIGHT_BATCH_CHARS } from '../src/highlightPlan';

const config: AIConfig = { endpoint: 'https://1.1.1.1/v1', protocol: 'chat', apiKey: 'test-only', model: 'mock' };
const largeReport = () => ({ meta: {}, kpis: {}, shelf: { books: [] }, reading: { categories: [], topBooks: [] }, readerPortrait: { quotes: [], allHighlights: Array.from({ length: 3616 }, (_, index) => ({ id: `quote:${index}`, bookId: `book:${index % 40}`, bookTitle: `书籍${index % 40}`, createdAt: `${2020 + index % 6}-01-01`, text: `划线${index}：证据与行动在不确定性中的关系，关注自由与结构。` })) } }) as unknown as Report;

for (const kind of ['cognition', 'collision'] as const) test(`${kind} default bounds model calls for thousands of highlights`, async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ heading: '真实切片', explanation: '模拟画像', blindSpot: '条件性的暗线盲区', collisionType: '暗夜回响', dialogue: '两书视角的拟想交锋', reconciliation: '现实中的行动指引', quoteIds: input.highlights.slice(0, 2).map((quote: Row) => quote.id) }] }) } }] });
  });
  const result = await analyzeInsight(largeReport(), config, kind, () => {});
  assert.ok(calls <= 5, `expected <=5 calls, got ${calls}`);
  assert.ok(result.coverage.processed <= 160);
  assert.equal(result.coverage.mode, 'selected');
  assert.equal(result.coverage.sampled, true);
  assert.equal(result.coverage.available, 3616);
  console.log(`${kind}: ${calls} model calls, ${result.coverage.processed} / 3616 quotes sent`);
});

test('selection is deterministic, bounds long inputs and keeps real IDs, books and dates', () => {
  const report = largeReport();
  const original = JSON.stringify(report);
  const plan = highlightPlan(report, 'cognition');
  assert.deepEqual(plan, highlightPlan(report, 'cognition'));
  assert.equal(plan.books, 40);
  assert.equal(new Set(plan.batches.flat().map(q => q.date.slice(0, 4))).size, 6);
  assert.ok(plan.batches.every(batch => JSON.stringify(batch).length <= HIGHLIGHT_BATCH_CHARS));
  assert.ok(plan.batches.flat().every(q => report.readerPortrait.allHighlights!.some(raw => raw.id === q.id && raw.createdAt === q.date)));
  assert.equal(JSON.stringify(report), original);
  report.readerPortrait.allHighlights = Array.from({ length: 200 }, (_, index) => ({ id: `long:${index}`, bookId: `book:${index % 3}`, text: `${index}${'文'.repeat(2000)}` }));
  const long = highlightPlan(report, 'cognition');
  assert.ok(long.requests <= 5);
  assert.ok(long.batches.every(batch => JSON.stringify(batch).length <= HIGHLIGHT_BATCH_CHARS));
});

test('all mode retains every unique quote and deduplicates only within the same book', () => {
  const report = largeReport();
  const quote = report.readerPortrait.allHighlights![0];
  report.readerPortrait.allHighlights!.push({ ...quote, id: 'duplicate' }, { ...quote, id: 'other-book', bookId: 'other' });
  const plan = highlightPlan(report, 'collision', 'all');
  assert.equal(plan.available, 3618);
  assert.equal(plan.unique, 3617);
  assert.equal(plan.selected, 3617);
  assert.equal(plan.sampled, false);
  assert.equal(plan.requests, plan.batches.length);
  assert.equal(plan.batches.flat().some(q => q.id === 'duplicate'), false);
  assert.equal(plan.batches.flat().some(q => q.id === 'other-book'), true);
});

test('lexical retrieval can bring a cross-book pair from distant input positions into selection', () => {
  const report = largeReport();
  report.readerPortrait.allHighlights![0] = { id: 'distant:a', bookId: 'a', text: '熵增耗散驱动生命秩序。' };
  report.readerPortrait.allHighlights!.push({ id: 'distant:b', bookId: 'b', text: '熵增耗散驱动生命秩序，也构成不同领域的比喻。' });
  const plan = highlightPlan(report, 'collision');
  // Strong shared vocabulary is a retrieval signal, not a claim of semantic agreement.
  const ids = plan.batches.flat().map(q => q.id);
  assert.ok(ids.includes('distant:a') && ids.includes('distant:b'));
});

test('batch execution overlaps at most two requests and all mode covers every unique input', async t => {
  let active = 0, peak = 0;
  const progress: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  });
  const result = await analyzeInsight(largeReport(), config, 'collision', done => progress.push(done), undefined, undefined, 'all');
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(result.coverage.processed, 3616);
  assert.equal(result.coverage.sampled, false);
  assert.equal(progress.at(-1), result.coverage.batches);
  assert.ok(progress.every((value, index) => value === index + 1));
});

test('a failed parallel batch aborts the other request and never starts queued work', async t => {
  let calls = 0, cancelled = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 3));
      return Response.json({ choices: [{ message: { content: 'invalid json' } }] });
    }
    return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => { cancelled = true; reject(options.signal!.reason); }, { once: true }));
  });
  await assert.rejects(analyzeInsight(largeReport(), config, 'cognition', () => {}), /可解析/);
  assert.equal(calls, 2);
  assert.equal(cancelled, true);
});
