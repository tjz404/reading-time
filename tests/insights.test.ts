import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInsight, highlightBatches, validateInsightItems } from '../lib/insights';
import { aggregate, monthSummary } from '../lib/report';
import type { AIConfig, Report, Row } from '../src/types';
import { aiEvidence, analyze, validateAnalysis } from '../lib/ai';
import { defaultPrompts, resolvePrompt, PROMPT_LIMIT } from '../src/aiPrompts';

const quotes = new Map<string, Row>([
  ['a:0', { id: 'a:0', bookId: 'a', bookTitle: '甲书', text: '判断需要证据' }],
  ['a:1', { id: 'a:1', bookId: 'a', bookTitle: '甲书', text: '谨慎作出决定' }],
  ['b:0', { id: 'b:0', bookId: 'b', bookTitle: '乙书', text: '也要容纳不确定性' }]
]);
const shelf = new Map<string, Row>([
  ['new', { bookId: 'new', title: '书架未读', readingStatus: '未读' }],
  ['reading', { bookId: 'reading', title: '书架在读', readingStatus: '在读' }],
  ['done', { bookId: 'done', title: '书架已读', readingStatus: '读完' }]
]);

test('insights only accept real shelf IDs and correctly matched reading states', () => {
  const result = validateInsightItems('recommendations', { items: [
    { heading: '未读', explanation: '匹配兴趣', bookId: 'new', status: '未读' },
    { heading: '在读', explanation: '接着读', bookId: 'reading', status: '在读' },
    { heading: '伪造', explanation: '不存在', bookId: 'fake', status: '未读' },
    { heading: '误标', explanation: '已经读过', bookId: 'done', status: '未读' },
    { heading: '已读', explanation: '不可推荐', bookId: 'done', status: '读完' },
    { heading: '书架外', explanation: '仅作探索', bookTitle: '另一本书', status: '书架外' },
    { heading: '重复', explanation: '已有', bookTitle: '书架未读', status: '书架外' }
  ] }, quotes, shelf, new Set(['书架未读', '书架在读', '书架已读']));
  assert.deepEqual(result.map(item => item.bookTitle), ['书架未读', '书架在读', '另一本书']);
  assert.match(result[2].status || '', /待核实/);
  assert.equal(validateInsightItems('recommendations', { items: [{ heading: '误报', explanation: '已在书架', bookTitle: ' 《书架未读》 ', status: '书架外' }] }, quotes, shelf, new Set(['书架未读'])).length, 0);
});

test('invalid model entries are rejected without treating null as a quote', () => {
  assert.throws(() => validateInsightItems('cognition', null as unknown as Row, quotes, shelf, new Set()), /可核对/);
  assert.deepEqual(validateInsightItems('cognition', { items: [null, 3, { heading: '有效', explanation: '有来源', blindSpot: '视角的灰度', quoteIds: ['a:0', 'b:0'] }] }, quotes, shelf, new Set()).map(item => item.heading), ['有效']);
});

test('cognition needs an original quote and collisions need two different books', () => {
  const input = { items: [
    { heading: '可核对', explanation: '只作推测', blindSpot: '条件性的盲区', collisionType: '暗夜回响', dialogue: '两种视角的拟想交锋', reconciliation: '留出行动与证据的位置', quoteIds: ['a:0', 'b:0'] },
    { heading: '同一本', explanation: '不能当跨书', blindSpot: '仅作学习路径的观察', quoteIds: ['a:0', 'a:1'] },
    { heading: '不存在', explanation: '没有证据', quoteIds: ['fake'] }
  ] };
  assert.deepEqual(validateInsightItems('collision', input, quotes, shelf, new Set()).map(row => row.heading), ['可核对']);
  assert.deepEqual(validateInsightItems('cognition', input, quotes, shelf, new Set()).map(row => row.heading), ['可核对', '同一本']);
});

test('all fetched highlights include dates outside the stats window without changing featured quotes', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600 }, '2025-01')], annual: [], shelf: {}, notebooks: [{ bookId: 'a', book: { title: '甲书' } }], details: [{ bookId: 'a', highlights: [
    { markText: '这是区间内的完整划线与思考记录', createTime: 1735747200, chapterUid: 5 },
    { markText: '这是更早年份的完整划线', createTime: 1672531200 }
  ], reviews: [] }] });
  assert.equal(report.readerPortrait.allHighlights?.length, 2);
  assert.equal(report.readerPortrait.quotes.length, 1);
  assert.equal(highlightBatches(report).flat().length, 2);
  assert.equal(highlightBatches(report)[0][0].chapterUid, '5');
  assert.equal(highlightBatches(report)[0][1].chapterUid, undefined);
});

test('collision batches interleave book sources and retain every saved quote', () => {
  const report = { readerPortrait: { allHighlights: [
    ...Array.from({ length: 35 }, (_, i) => ({ id: `a:${i}`, bookId: 'a', text: `观点甲${i}`, bookTitle: '甲书' })),
    ...Array.from({ length: 35 }, (_, i) => ({ id: `b:${i}`, bookId: 'b', text: `观点乙${i}`, bookTitle: '乙书' }))
  ] } } as unknown as Report;
  const batches = highlightBatches(report, true);
  assert.equal(batches.flat().length, 70);
  assert.deepEqual(new Set(batches[0].map(q => q.bookId)), new Set(['a', 'b']));
});

test('long highlights retain their original IDs while model inputs stay bounded', () => {
  const report = { readerPortrait: { allHighlights: [{ id: 'x:1', bookId: 'x', bookTitle: '长书', text: '读'.repeat(15000) }] } } as unknown as Report;
  assert.equal(highlightBatches(report)[0][0].id, 'x:1');
  assert.equal(highlightBatches(report)[0][0].text.length, 1200);
});

const config: AIConfig = { endpoint: 'https://1.1.1.1/v1', protocol: 'chat', apiKey: 'test-only', model: 'mock' };
const fixture = () => ({ meta: {}, kpis: {}, shelf: { books: [...shelf.values()] }, reading: { categories: [], topBooks: [] }, readerPortrait: { quotes: [], allHighlights: [...quotes.values()] } }) as unknown as Report;

test('recommendations generate three groups, and an all-finished shelf still supports external books', async t => {
  const calls: Row[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content);
    calls.push(input);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [
      ...input.books.map((book: Row) => ({ heading: '阅读建议', explanation: '依据兴趣', bookId: book.bookId, status: book.status })),
      { heading: '延伸阅读', explanation: '探索新主题', bookTitle: '外部书目', status: '书架外' }
    ] }) } }] });
  });
  const result = await analyzeInsight(fixture(), config, 'recommendations', () => {});
  assert.deepEqual(result.sections.map(s => s.items.length), [1, 1, 1]);
  assert.equal(calls.flatMap(c => c.books).some(b => b.bookId === 'done'), false);
  const finished = fixture();
  finished.shelf.books = [shelf.get('done')!];
  const external = await analyzeInsight(finished, config, 'recommendations', () => {});
  assert.equal(external.sections[2].items.length, 1);
});

test('collision jobs verify evidence, finish progress, reject invalid JSON and respect cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ heading: '证据与不确定性', explanation: '相似观点', collisionType: '暗夜回响', dialogue: '两书视角的拟想交锋', reconciliation: '现实中的行动指引', quoteIds: [input.highlights[0].id, input.highlights[1].id] }] }) } }] });
  });
  const steps: number[][] = [];
  const result = await analyzeInsight(fixture(), config, 'collision', (done, total) => steps.push([done, total]));
  assert.equal(result.sections[0].items.length, 1);
  assert.deepEqual(steps.at(-1), [result.coverage.batches, result.coverage.batches]);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(analyzeInsight(fixture(), config, 'cognition', () => {}, abort.signal), { name: 'AbortError' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'invalid json' } }] }));
  await assert.rejects(analyzeInsight(fixture(), config, 'cognition', () => {}), /可解析/);
});

test('collisions require all theatre fields, an allowed type and exactly two books; dates preserve order', () => {
  const evidence = new Map<string, Row>([
    ['late', { text: '后来的原文', bookId: 'a', date: '2026-02-01' }],
    ['early', { text: '早期的原文', bookId: 'b', date: '2025-01-01' }],
    ['same', { text: '同书的原文', bookId: 'a' }]
  ]);
  const item = { heading: '两种力量彼此照亮', explanation: '你在两句话之间看见了不同的温度。', collisionType: '一体两面', dialogue: '书甲的视角审视乙书，乙书向甲书回应。', reconciliation: '行动时借力，停顿时校准。', quoteIds: ['late', 'early'] };
  const valid = validateInsightItems('collision', { items: [item] }, evidence, shelf, new Set());
  assert.deepEqual(valid[0].quoteIds, ['early', 'late']);
  assert.equal(valid[0].collisionType, '一体两面');
  for (const invalid of [{ ...item, dialogue: '' }, { ...item, reconciliation: '' }, { ...item, collisionType: '镜像合谋' }, { ...item, quoteIds: ['late', 'same'] }, { ...item, quoteIds: ['late', 'early', 'same'] }]) assert.deepEqual(validateInsightItems('collision', { items: [invalid] }, evidence, shelf, new Set()), []);
  evidence.get('early')!.date = undefined;
  assert.deepEqual(validateInsightItems('collision', { items: [item] }, evidence, shelf, new Set())[0].quoteIds, ['late', 'early']);
});

test('cognition synthesizes evidence from multiple batches into one report', async t => {
  let synthesized = false;
  const systems: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const messages = JSON.parse(String(options.body)).messages;
    systems.push(messages[0].content);
    const input = JSON.parse(messages[1].content);
    if (input.observations) synthesized = true;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ heading: input.observations ? '综合认知主题' : '候选观察', explanation: '有证据的深度画像', blindSpot: '过度依赖这一视角时，也许会忽略其中的灰度。', quoteIds: input.highlights.slice(0, 2).map((q: Row) => q.id) }] }) } }] });
  });
  const report = fixture();
  report.readerPortrait.allHighlights = Array.from({ length: 60 }, (_, index) => ({ id: `a:${index}`, bookId: 'a', bookTitle: '甲书', text: `真实测试证据${index}` }));
  const result = await analyzeInsight(report, config, 'cognition', () => {}, undefined, '重点分析我的证据观');
  assert.equal(synthesized, true);
  assert.equal(result.coverage.processed, 60);
  assert.equal(result.coverage.batches, 3);
  assert.equal(result.sections[0].items[0].heading, '综合认知主题');
  assert.equal(result.prompt, '重点分析我的证据观');
  assert.equal(systems.length, 3);
  assert.ok(systems.every(system => system.includes('重点分析我的证据观') && system.includes('JSON')));
  assert.ok(systems.every(system => system.includes('知识采集') && system.includes('场景豁免') && system.includes('张力') && system.includes('不布置作业')));
  assert.match(result.sections[0].items[0].blindSpot || '', /灰度/);
});

test('cognition rejects single, repeated or invented evidence and requires a separate blind spot', () => {
  const item = { heading: '测试切片', explanation: '深度画像', blindSpot: '条件性的暗线盲区' };
  const items = [
    { ...item, quoteIds: ['a:0'] },
    { ...item, quoteIds: ['a:0', 'a:0'] },
    { ...item, quoteIds: ['a:0', 'fake'] },
    { ...item, blindSpot: '', quoteIds: ['a:0', 'b:0'] },
    { ...item, quoteIds: ['a:0', 'b:0'] }
  ];
  assert.equal(validateInsightItems('cognition', { items }, quotes, shelf, new Set()).length, 1);
});

test('all four prompt defaults exist and blank, oversized or non-text overrides fail', () => {
  assert.equal(Object.keys(defaultPrompts).length, 4);
  assert.equal(resolvePrompt('personality'), defaultPrompts.personality);
  assert.ok(Object.values(defaultPrompts).every(prompt => prompt.length <= PROMPT_LIMIT));
  for (const value of ['', '   ', 3, '读'.repeat(PROMPT_LIMIT + 1)]) assert.throws(() => resolvePrompt('collision', value), /提示词/);
});

test('MBTI does not invent a portrait for a year without reading evidence', async () => {
  const report = fixture();
  report.series = { annualRows: [{ year: 2023, hours: 0 }] } as unknown as Report['series'];
  report.notes = { wordCloud: [] } as unknown as Report['notes'];
  await assert.rejects(analyze(report, config), /2023 年没有可用的年度阅读线索/);
});

test('MBTI uses the edited prompt while keeping its existing schema and evidence', async t => {
  let system = '';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const messages = JSON.parse(String(options.body)).messages;
    system = messages[0].content;
    const evidence = JSON.parse(messages[1].content);
    assert.equal(evidence.highlights.length, 3);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '模拟总结', yearlyPersonality: [], thoughtClusters: [] }) } }] });
  });
  const report = fixture(); report.series = { annualRows: [] } as unknown as Report['series']; report.notes = { wordCloud: [] } as unknown as Report['notes'];
  const result = await analyze(report, config, undefined, '少用类比，增加证据解释');
  assert.match(system, /少用类比，增加证据解释/);
  assert.match(system, /yearlyPersonality/);
  assert.equal(result.prompt, '少用类比，增加证据解释');
});

test('MBTI excerpts keep yearly book attribution and distinguish current shelf from annual completion', () => {
  const report = fixture();
  report.series = { annualRows: [{ year: 2024, hours: 3 }, { year: 2025, hours: 7 }] } as unknown as Report['series'];
  report.notes = { wordCloud: [] } as unknown as Report['notes'];
  report.readerPortrait.allHighlights = [
    { id: 'old', bookId: 'a', bookTitle: '甲书', text: '早年的真实摘录', createdAt: '2024-02-01' },
    { id: 'new', bookId: 'b', bookTitle: '乙书', text: '后来的真实摘录', createdAt: '2025-02-01' }
  ];
  const evidence = aiEvidence(report);
  assert.equal(evidence.years[0].highlights[0].book, '甲书');
  assert.equal(evidence.years[1].highlights[0].book, '乙书');
  assert.equal(evidence.years[0].highlights.some(q => q.book === '乙书'), false);
  assert.equal(evidence.currentShelf.counts.读完, 1);
  assert.equal(evidence.currentShelf.finishedShare, 1 / 3);
  assert.match(evidence.currentShelf.scope, /非年度/);
  assert.throws(() => validateAnalysis({ summary: 'ok', yearlyPersonality: [{ year: '2024', title: '未定型', annualQuestion: '金句', description: '描述' }], thoughtClusters: [] }, report), /有效/);
});

test('recommendation batches share current reading context and preserve separate reading anchors', async t => {
  const report = fixture();
  report.shelf.books = [
    ...Array.from({ length: 46 }, (_, index) => ({ bookId: `new-${index}`, title: `未读${index}`, readingStatus: '未读' })),
    { bookId: 'active', title: '当前在读', readingStatus: '在读', progress: 35, chapterTitle: '第三章', lastReadAt: 1735747200 },
    { bookId: 'done', title: '已读完', readingStatus: '读完' }
  ];
  report.reading.topBooks = [{ title: '读过的书', author: '某作者', hours: 12 }];
  const calls: Row[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content);
    calls.push(input);
    const book = input.books[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [
      { heading: '翻开新的视角', explanation: '现在读的理由', bookId: book.bookId, status: book.status, readingAnchor: '把这一章当成一扇观察日常的窗。' },
      { heading: '跨批候选', explanation: '不接受当前批以外书目', bookId: 'active', status: '在读' },
      { heading: '探索新书', explanation: '试读理由', bookTitle: '外部佳作', status: '书架外', readingAnchor: '换一种叙事的速度。' }
    ] }) } }] });
  });
  const result = await analyzeInsight(report, config, 'recommendations', () => {});
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.currentReading[0].progress === 35 && call.currentReading[0].currentChapter === '第三章'));
  assert.ok(calls.every(call => call.completed[0].status === '读完' && call.favorites[0].hours === 12));
  assert.equal(result.sections[0].items[0].readingAnchor, '把这一章当成一扇观察日常的窗。');
  assert.equal(result.sections[1].items.length, 1);
  assert.equal(result.sections[2].items.length, 1);
  assert.match(result.sections[2].items[0].status || '', /待核实/);
});
