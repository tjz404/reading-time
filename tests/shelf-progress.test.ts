import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReport, fetchShelfProgress, GatewayError } from '../lib/gateway';
import { aggregate, monthSummary } from '../lib/report';
import { aiEvidence } from '../lib/ai';
import { normalizeSample } from '../src/api';
import { duration, lastReadTime, readingDate, readingProgress, readingStatus, sortShelfBooks } from '../src/readingDetails';
import type { Row } from '../src/types';

test('progress uses documented lowercase routes, deduplicates books and joins the current chapter', async () => {
  const calls: [string, Row][] = [], warnings: string[] = [];
  const book = { bookId: 'a', title: '测试书', readUpdateTime: 1 };
  const result = await fetchShelfProgress(async (api, params = {}) => {
    calls.push([api, params]);
    return api === '/book/getprogress' ? { book: { progress: 1, chapterUid: 12, updateTime: 1735747200, recordReadingTime: 3660, finishTime: 123 } } : { chapters: [{ chapterUid: 12, title: '第二章' }] };
  }, [book, book], warnings, new AbortController().signal, () => {});
  assert.deepEqual(calls, [['/book/getprogress', { bookId: 'a' }], ['/book/chapterinfo', { bookId: 'a' }]]);
  assert.equal(result[0].progress, 1);
  assert.equal(result[0].recordReadingTime, 3660);
  assert.equal(result[0].chapterTitle, '第二章');
  assert.equal(result[0].finishTime, undefined);
  assert.equal(readingStatus(result[0]), '在读');
  assert.equal(readingDate(lastReadTime(result[0])), '2025-01-02');
  assert.equal(book.readUpdateTime, 1);
  assert.deepEqual(warnings, []);
});

test('shelf bookProgress readingTime is the total; recordReadingTime is not substituted', async () => {
  const transport = (async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    const responses: Record<string, Row> = {
      '/readdata/detail': { totalReadTime: 3600, readDays: 1 },
      '/shelf/sync': { books: [{ bookId: 'a', title: '有时长' }, { bookId: 'b', title: '没有时长' }], bookProgress: [{ bookId: 'a', progress: 45, readingTime: 5400 }, { bookId: 'b', progress: 1 }] },
      '/user/notebooks': { books: [], hasMore: 0 },
      '/book/getprogress': { book: { progress: 45, recordReadingTime: 0 } },
    };
    if (!(request.api_name in responses)) throw new Error(`Unexpected route ${request.api_name}`);
    return new Response(JSON.stringify(responses[request.api_name]));
  }) as typeof fetch;
  const report = await collectReport('mock-test-key', 12, () => {}, new AbortController().signal, transport);
  assert.equal(report.shelf.books?.[0].readingTime, 5400);
  assert.equal(report.shelf.books?.[1].readingTime, undefined);
  assert.equal(report.shelf.books?.[0].recordReadingTime, 0);
  assert.equal(report.coverage.shelfReadingTimeAvailable, 1);
  assert.equal(report.kpis.totalReadHours, 12, 'shelf lifetime time is not added to monthly totals');
  assert.deepEqual(sortShelfBooks(report.shelf.books || [], 'duration').map(b => b.bookId), ['a', 'b']);
});

test('duration displays minute precision, not seconds', () => {
  assert.equal(duration(0), '0分钟');
  assert.equal(duration(10), '不足1分钟');
  assert.equal(duration(61), '1分钟');
  assert.equal(duration(3660), '1小时1分钟');
});

test('progress failures preserve existing data and chapter failures preserve fetched progress', async () => {
  const warnings: string[] = [];
  const books = await fetchShelfProgress(async (api, params = {}) => {
    if (params.bookId === 'failed' || api === '/book/chapterinfo') throw new Error('unavailable');
    if (params.bookId === 'empty') return {};
    return { book: { progress: 100, chapterUid: 2, finishTime: 1735747200 } };
  }, [{ bookId: 'failed', title: '失败', progress: 45 }, { bookId: 'done' }, { bookId: 'empty' }], warnings, new AbortController().signal, () => {});
  assert.equal(books[0].progress, 45);
  assert.equal(books[0].progressFetchState, 'failed');
  assert.equal(books[1].progressFetchState, 'fetched');
  assert.equal(books[1].finishTime, 1735747200);
  assert.equal(books[2].progressFetchState, 'failed');
  assert.equal(books[2].progress, undefined);
  assert.equal(warnings.length, 3);
});

test('fatal gateway errors and cancellation stop progress collection', async () => {
  await assert.rejects(fetchShelfProgress(async () => { throw new GatewayError('upgrade', true); }, [{ bookId: 'a' }], [], new AbortController().signal, () => {}), /upgrade/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchShelfProgress(async () => { throw new Error('must not call'); }, [{ bookId: 'a' }], [], controller.signal, () => {}), { name: 'AbortError' });
});

test('zero and missing progress remain distinct and sorting does not mutate the report', () => {
  for (const v of [null, undefined, '', -1, 101, NaN, true]) assert.equal(readingProgress(v), undefined);
  assert.equal(readingProgress(0), 0);
  assert.equal(readingProgress(1), 1);
  assert.equal(readingStatus({ progressFetchState: 'fetched', progress: 0, readUpdateTime: 1735747200 }, { readingProgress: 45 }), '未读');
  assert.equal(readingStatus({ progressFetchState: 'fetched', progress: 1 }, { readingProgress: 100, markedStatus: 1 }), '在读');
  const books = [{ bookId: 'unknown' }, { bookId: 'a', progress: 1, lastReadAt: 5, readingTime: 7200, recordReadingTime: 0 }, { bookId: 'b', progress: 100, readUpdateTime: 3, readingTime: 100, recordReadingTime: 9999 }];
  assert.deepEqual(sortShelfBooks(books, 'recent').map(b => b.bookId), ['a', 'b', 'unknown']);
  assert.deepEqual(sortShelfBooks(books, 'progress').map(b => b.bookId), ['b', 'a', 'unknown']);
  assert.deepEqual(sortShelfBooks(books, 'duration').map(b => b.bookId), ['a', 'b', 'unknown']);
  assert.equal(books[0].bookId, 'unknown');
});

test('aggregate tracks progress coverage without adding lifetime time to the reporting interval; featured quotes and AI are capped at ten', () => {
  const report = aggregate({ version: '1.0.5', warnings: ['《书》单书进度读取失败，保留书架与笔记记录'], months: [monthSummary({ totalReadTime: 3600 }, '2025-01')], annual: [], shelf: { books: [{ bookId: 'a', title: '书', progressFetchState: 'fetched', progress: 1, recordReadingTime: 360000, lastReadAt: 1735747200 }, { bookId: 'b', progressFetchState: 'failed' }] }, notebooks: [{ bookId: 'a', book: { title: '书' }, readingProgress: 100, noteCount: 15 }], details: [{ bookId: 'a', highlights: Array.from({ length: 15 }, (_, i) => ({ markText: `时间与生命留下的真实划线内容第${i}条。`, createTime: 1735747200 })) }] });
  assert.equal(report.kpis.totalReadHours, 1);
  assert.equal(report.shelf.books?.[0].readingStatus, '在读');
  assert.equal(report.coverage.shelfProgressFetched, 1);
  assert.equal(report.coverage.shelfProgressErrors, 1);
  assert.equal(report.coverage.noteFetchErrors, 0);
  assert.equal(report.series.dailyRecentBooks?.['2025-01-02'][0].title, '书');
  assert.equal(report.kpis.highlightsFetchedInRange, 15);
  assert.equal(report.readerPortrait.quotes.length, 10);
  report.readerPortrait.quotes = Array(20).fill(report.readerPortrait.quotes[0]);
  assert.equal(aiEvidence(report).highlights.length, 10);
  assert.equal(normalizeSample(report).readerPortrait.quotes.length, 10);
});

test('full gateway collection includes shelf progress, chapters and complete job progress without a live key', async () => {
  const calls: Row[] = [], steps: number[][] = [];
  const transport = (async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body)); calls.push(request);
    let result: Row;
    switch (request.api_name) {
      case '/readdata/detail': result = { totalReadTime: 3600, readDays: 1 }; break;
      case '/shelf/sync': result = { books: [{ bookId: 'a', title: '完整流程的书' }] }; break;
      case '/user/notebooks': result = { books: [{ bookId: 'a', book: { title: '完整流程的书' }, readingProgress: 100 }], hasMore: 0 }; break;
      case '/book/getprogress': result = { book: { progress: 1, recordReadingTime: 360000, chapterUid: 9, updateTime: 1735747200 } }; break;
      case '/book/chapterinfo': result = { chapters: [{ chapterUid: 9, title: '当前一章' }] }; break;
      case '/book/bookmarklist': result = { updated: [] }; break;
      case '/review/list/mine': result = { reviews: [], hasMore: 0 }; break;
      default: throw new Error(`Unexpected route ${request.api_name}`);
    }
    return new Response(JSON.stringify(result));
  }) as typeof fetch;
  const report = await collectReport('mock-test-key', 12, (_message, completed, total) => { steps.push([completed, total]); }, new AbortController().signal, transport);
  assert.equal(report.kpis.totalReadHours, 12);
  assert.equal(report.shelf.books?.[0].chapterTitle, '当前一章');
  assert.equal(report.shelf.books?.[0].readingStatus, '在读');
  assert.equal(report.coverage.shelfProgressFetched, 1);
  assert.ok(steps.every(([completed, total]) => completed <= total));
  assert.equal(steps.at(-1)?.[0], steps.at(-1)?.[1]);
  assert.ok(calls.every(c => c.skill_version === '1.0.5' && !c.params));
});
