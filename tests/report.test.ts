import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, dateKey, extractTerms, hourlyDistribution, monthSummary, monthsInRange, parseDuration } from '../lib/report';
import { createGateway, fetchNotebooks, fetchReviews, GatewayError } from '../lib/gateway';
import { endpointFor, publicAddress, validateAnalysis, validateEndpoint } from '../lib/ai';
import { bookDetailText, calendarTooltip, monthlyTooltip, readingStatus, shelfReadingStates } from '../src/readingDetails';
import type { ReadingBook, Report, Row } from '../src/types';

function fixture(): Report {
  return aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600, readDays: 2, readTimes: { 1735660800: 600 }, readLongest: [{ book: { bookId: 'a', title: '真实书', author: '作者' }, readTime: 1200 }, { readTime: 900 }], readStat: [] }, '2025-01')], annual: [{ year: '2025', totalReadTime: 3600, preferTime: [100, ...Array(23).fill(0)], preferCategory: [{ categoryTitle: '哲学', readingTime: 3600, readingCount: 1 }] }], shelf: { books: [{ bookId: 'a', title: '真实书', secret: 1, finishReading: 1 }], albums: [{ albumInfo: { name: '音频' }, albumInfoExtra: { secret: 0 } }], mp: { name: '文章' } }, notebooks: [{ bookId: 'a', book: { title: '真实书' }, noteCount: 3, reviewCount: 2, bookmarkCount: 1 }], details: [{ bookId: 'a', highlights: [{ markText: '哲学让我们思考生命的意义和时间的方向。', createTime: 1735747200 }, { markText: '不应出现在范围内的句子。', createTime: 946684800 }], reviews: [] }] });
}

test('full month uses authoritative total, not incomplete daily sum; seconds remain seconds', () => {
  const report = fixture();
  assert.equal(report.kpis.totalReadHours, 1);
  assert.equal(report.series.dailyHeat[0][1], 10);
  assert.equal(report.kpis.readDays, 2);
  assert.equal(report.reading.topBooks[0].seconds, 1200);
  assert.equal(report.reading.topBooks.length, 1);
});
test('shelf includes albums and article entry; note total includes all three types', () => {
  const r = fixture();
  assert.equal(r.kpis.shelfTotal, 3);
  assert.equal(r.shelf.composition.reduce((sum, row) => sum + row.value, 0), 3);
  assert.equal(r.shelf.privacy.reduce((sum, row) => sum + row.value, 0), 3);
  assert.equal(r.kpis.noteTotal, 6);
  assert.equal(r.readerPortrait.quotes.length, 1);
  assert.deepEqual(r.readerPortrait.goldenQuote, r.readerPortrait.quotes[0]);
  assert.equal(r.notes.progressScatter.length, 0, 'missing progress must not become zero');
});
test('timestamps use Shanghai and hourly preference starts at 6am', () => {
  assert.equal(dateKey(1735660800), '2025-01-01');
  assert.deepEqual(monthsInRange(3, '2026-01-12'), ['2025-11', '2025-12', '2026-01']);
  assert.equal(fixture().series.hourly?.[6], 100);
  assert.equal(parseDuration('5小时30分钟'), 19800);
  assert.equal(parseDuration('12345'), 0);
});
test('hourly distribution falls back to overall when annual and monthly omit preferTime', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600 }, '2025-01')], annual: [{ year: '2025' }], overall: { preferTime: [7200, ...Array(23).fill(0)] }, shelf: {}, notebooks: [], details: [] });
  assert.equal(report.series.hourly?.[6], 7200);
  assert.equal(report.series.hourlySource, 'overall');
  assert.match(report.series.hourlyNote || '', /全部历史/);
});
test('hourly sources do not double count overlapping months, years and overall data', () => {
  const bins = (value: number) => [value, ...Array(23).fill(0)];
  const monthly = hourlyDistribution([{ preferTime: bins(100) }], [{ preferTime: bins(500) }], { preferTime: bins(1000) });
  assert.equal(monthly.values[6], 100);
  assert.equal(monthly.source, 'monthly');
  const annual = hourlyDistribution([{}], [{ preferTime: bins(500) }], { preferTime: bins(1000) });
  assert.equal(annual.values[6], 500);
  assert.equal(annual.source, 'annual');
});
test('monthly hover lists only the period book ranking, daily hover does not misstate monthly book time', () => {
  const report = fixture();
  assert.match(monthlyTooltip(report, 0, 1, '小时'), /真实书.*20分钟/);
  assert.match(calendarTooltip(report, '2025-01-01', 10), /当天总计 · 10分钟/);
  assert.match(calendarTooltip(report, '2025-01-01', 10), /本月阅读排行/);
  assert.match(calendarTooltip(report, '2025-01-01', 10), /本月阅读排行/);
  assert.match(bookDetailText([]), /未返回对应书籍时长明细/);
});
test('calendar favors combined daily clues and shows the monthly ranking only without either clue', () => {
  const sameDay = 1735747200;
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600, readTimes: { [sameDay]: 121 }, readLongest: [{ book: { bookId: 'ranked', title: '月榜书' }, readTime: 1800 }] }, '2025-01')], annual: [], shelf: { books: [{ bookId: 'shared', title: '双重线索', readUpdateTime: sameDay }, { bookId: 'recent', title: '仅最近阅读', readUpdateTime: sameDay }] }, notebooks: [{ bookId: 'shared', book: { title: '双重线索' } }, { bookId: 'note', book: { title: '仅笔记' } }], details: [{ bookId: 'shared', highlights: [{ createTime: sameDay, markText: '与另一个线索指向同一本书' }], reviews: [] }, { bookId: 'note', highlights: [{ createTime: sameDay, markText: '另一本书的笔记线索' }], reviews: [] }] });
  const daily = calendarTooltip(report, '2025-01-02', 121 / 60);
  assert.match(daily, /双重线索/);
  assert.match(daily, /仅笔记/);
  assert.match(daily, /仅最近阅读/);
  assert.equal(daily.match(/《双重线索》/g)?.length, 1);
  assert.doesNotMatch(daily, /月榜书|本月阅读排行|秒/);
  const fallback = calendarTooltip(report, '2025-01-03', 10);
  assert.match(fallback, /月榜书|本月阅读排行/);
  assert.doesNotMatch(fallback, /当天有笔记/);
});
test('shelf states distinguish not started and in progress and omit album completion', () => {
  assert.equal(readingStatus({ finishReading: 0, readUpdateTime: 0 }), '未读');
  assert.equal(readingStatus({ finishReading: 0, readUpdateTime: 1735747200 }), '在读');
  assert.equal(readingStatus({ finishReading: 1, readUpdateTime: 0 }), '读完');
  assert.equal(readingStatus({ finishReading: 0 }, { readingProgress: 1 }), '在读');
  assert.equal(readingStatus({ finishReading: 0 }, { readingProgress: 100 }), '读完');
  const result = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 600 }, '2025-01')], annual: [], shelf: { books: [{ bookId: 'a', finishReading: 1 }, { bookId: 'b', readUpdateTime: 1735747200 }, { bookId: 'c' }], albums: [{ albumInfo: { finish: 1 } }], mp: { name: '文章' } }, notebooks: [], details: [] });
  assert.deepEqual(shelfReadingStates(result).map(row => [row.name, row.value]), [['读完', 1], ['在读', 1], ['未读', 1]]);
  assert.equal(result.kpis.shelfTotal, 5);
});
test('annual category uses attributable ranked books with per-book duration', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600, readLongest: [{ book: { bookId: 'a', title: '史书' }, readTime: 1200 }] }, '2025-01')], annual: [{ year: '2025', totalReadTime: 3600, preferCategory: [{ categoryTitle: '历史', readingTime: 3600 }], readLongest: [{ book: { bookId: 'a', title: '史书' }, readTime: 3000 }] }], shelf: { books: [{ bookId: 'a', title: '史书', category: '历史' }] }, notebooks: [], details: [] });
  assert.equal(report.evolution?.[0].categories[0].books[0].seconds, 3000);
  assert.equal(report.evolution?.[0].categories[0].books[0].title, '史书');
});
test('yearly category matches shelf taxonomy by parent or child without assigning unrelated books', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 8000, readLongest: [{ book: { bookId: 'finance', title: '财经书' }, readTime: 3000 }, { book: { bookId: 'fiction', title: '女性小说书' }, readTime: 2000 }, { book: { bookId: 'other', title: '其他书' }, readTime: 1000 }] }, '2025-01')], annual: [{ year: '2025', preferCategory: [{ categoryTitle: '经济理财', parentCategoryTitle: '经济理财', readingTime: 3000 }, { categoryTitle: '女性小说', parentCategoryTitle: '精品小说', readingTime: 2000 }] }], shelf: { books: [{ bookId: 'finance', title: '财经书', category: '经济理财-财经' }, { bookId: 'fiction', title: '女性小说书', category: '精品小说-女性小说' }, { bookId: 'other', title: '其他书', category: '历史-世界史' }] }, notebooks: [], details: [] });
  assert.deepEqual(report.evolution?.[0].categories[0].books.map((b: ReadingBook) => b.title), ['财经书']);
  assert.deepEqual(report.evolution?.[0].categories[1].books.map((b: ReadingBook) => b.title), ['女性小说书']);
  assert.equal(report.evolution?.[0].categories[0].books[0].seconds, 3000);
});
test('word cloud keeps Chinese topics and omits isolated English fragments', () => {
  const terms = extractTerms(['said unto man user end system system', '对历史与哲学的思考，也是对生命的思考。']);
  assert.deepEqual(terms.map(row => row.name).sort(), ['历史', '哲学', '思考', '生命'].filter(word => word !== '思考').sort());
  assert.ok(terms.every(row => !/[a-z]/i.test(row.name)));
});
test('missing period rankings use explicitly labeled notebook activity without invented reading time', () => {
  const noteDate = 1735747200;
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600, readTimes: { [noteDate]: 600 } }, '2025-01')], annual: [{ year: '2025', preferCategory: [{ categoryTitle: '历史', readingTime: 3600 }] }], shelf: { books: [{ bookId: 'a', title: '史书', category: '历史' }] }, notebooks: [{ bookId: 'a', book: { bookId: 'a', title: '史书', category: '历史' }, sort: noteDate }], details: [{ bookId: 'a', highlights: [{ markText: '这一段留在读书笔记里。', createTime: noteDate }], reviews: [] }] });
  assert.match(monthlyTooltip(report, 0, 1, '小时'), /史书/);
  assert.doesNotMatch(monthlyTooltip(report, 0, 1, '小时'), /史书.*小时/);
  assert.match(calendarTooltip(report, '2025-01-02', 10), /史书/);
  assert.doesNotMatch(calendarTooltip(report, '2025-01-02', 10), /史书.*分钟/);
  assert.match(bookDetailText(report.evolution?.[0].categories[0].books || []), /史书/);
});
test('missing preferTime preserves an honest unavailable source and the available preference text', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 1200 }, '2025-01')], annual: [{ year: '2025', preferTimeWord: '偏好夜间阅读' }], shelf: {}, notebooks: [], details: [] });
  assert.equal(report.series.hourlySource, 'unavailable');
  assert.match(report.series.hourlyNote || '', /偏好夜间阅读/);
});
test('last read timestamps provide dated book leads but never manufacture per-book hours', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600, readTimes: { 1735747200: 900 } }, '2025-01')], annual: [{ year: '2025', preferCategory: [{ categoryTitle: '历史', readingTime: 3600 }] }], shelf: { books: [{ bookId: 'a', title: '史书', category: '历史', readUpdateTime: 1735747200 }] }, notebooks: [], details: [] });
  assert.match(monthlyTooltip(report, 0, 1, '小时'), /史书/);
  assert.match(calendarTooltip(report, '2025-01-02', 15), /当日书籍线索/);
  assert.doesNotMatch(bookDetailText(report.evolution?.[0].categories[0].books || []), /史书.*小时/);
  assert.equal(report.coverage.monthsWithBookRanking, 0);
  assert.equal(report.coverage.daysWithLastRead, 1);
});
test('unmatched annual category does not attribute unclassified books to that category', () => {
  const report = aggregate({ version: '1.0.5', warnings: [], months: [monthSummary({ totalReadTime: 3600 }, '2025-01')], annual: [{ year: '2025', preferCategory: [{ categoryTitle: '历史', readingTime: 3600 }], readLongest: [{ book: { bookId: 'a', title: '史书' }, readTime: 1800 }] }], shelf: {}, notebooks: [], details: [] });
  const category = report.evolution?.[0].categories[0];
  assert.equal(category?.books.length, 0);
  assert.match(category?.booksNote || '', /没有能归属/);
  assert.equal(report.meta.schemaVersion, 2);
});
test('gateway flattens parameters, reports skill version and stops on upgrade_info', async () => {
  let sent: Row = {};
  const transport = (async (_url: any, options: any) => { sent = JSON.parse(options.body); assert.equal(options.headers.Authorization, 'Bearer test-key'); return new Response(JSON.stringify({ upgrade_info: { message: '请升级' } })); }) as typeof fetch;
  const call = createGateway('test-key', '1.0.5', undefined, transport);
  await assert.rejects(call('/user/notebooks', { count: 100, lastSort: 123 }), (e: Error) => e instanceof GatewayError && e.fatal);
  assert.deepEqual(sent, { count: 100, lastSort: 123, api_name: '/user/notebooks', skill_version: '1.0.5' });
});
test('notebook and review pagination use exact documented cursors and deduplicate', async () => {
  const notebookCalls: Row[] = [];
  const call = async (_api: string, params: Row = {}) => { notebookCalls.push(params); return params.lastSort ? { books: [{ bookId: 'b', sort: 1 }], hasMore: 0 } : { books: [{ bookId: 'a', sort: 2 }], hasMore: 1 }; };
  assert.equal((await fetchNotebooks(call)).length, 2);
  assert.deepEqual(notebookCalls[1], { count: 100, lastSort: 2 });
  const reviewCalls: Row[] = [];
  const reviews = await fetchReviews(async (_api, params = {}) => { reviewCalls.push(params); return params.synckey ? { reviews: [{ review: { reviewId: 'r' } }], hasMore: 0 } : { reviews: [{ review: { reviewId: 'r' } }], synckey: 7, hasMore: 1 }; }, 'a');
  assert.equal(reviews.length, 1);
  assert.deepEqual(reviewCalls[1], { bookid: 'a', count: 100, synckey: 7 });
});
test('stalled notebook cursor errors instead of silently returning partial data', async () => {
  await assert.rejects(fetchNotebooks(async () => ({ books: [{ bookId: 'a', sort: 1 }], hasMore: 1 })), /游标未推进/);
});
test('AI endpoints normalize paths, reject private network addresses, and validate yearly output', () => {
  assert.equal(endpointFor({ apiKey: 'test', model: 'model', protocol: 'chat', endpoint: 'https://example.com/v1/' }).pathname, '/v1/chat/completions');
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(address), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.throws(() => endpointFor({ apiKey: 'test', model: 'model', protocol: 'chat', endpoint: 'http://example.com' }), /HTTPS/);
  assert.throws(() => validateAnalysis({ summary: 'ok', yearlyPersonality: [], thoughtClusters: [] }, fixture()), /2025/);
  const result = validateAnalysis({ summary: 'ok', yearlyPersonality: [{ year: 2025, title: 'INTP', annualQuestion: '真实的问题', description: '来自真实书的解读' }], thoughtClusters: [{ keyword: '主题', books: ['真实书', '虚构书'], thoughtQuote: '概括' }] }, fixture());
  assert.deepEqual(result.thoughtClusters[0].books, ['真实书']);
});
test('only the exact DeepSeek host accepts proxy DNS synthetic addresses', async () => {
  const synthetic = async () => [{ address: '198.18.0.133', family: 4 }];
  await validateEndpoint(new URL('https://api.deepseek.com/v1/chat/completions'), synthetic);
  await assert.rejects(validateEndpoint(new URL('https://example.com/v1'), synthetic), /公网/);
  await assert.rejects(validateEndpoint(new URL('https://api.deepseek.com.evil.test/v1'), synthetic), /公网/);
  await assert.rejects(validateEndpoint(new URL('https://api.deepseek.com/v1'), async () => [{ address: '127.0.0.1', family: 4 }]), /公网/);
});
