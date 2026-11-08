import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { aggregate, monthSummary, monthsInRange, timestamp } from './report';
import type { Report, Row, ShelfBook } from '../src/types';
import { readingProgress } from '../src/readingDetails';

export class GatewayError extends Error {
  constructor(message: string, public fatal = false) { super(message); }
}

export function skillVersion() {
  for (const p of [path.resolve('.agents/skills/weread-skills/SKILL.md'), path.join(homedir(), '.agents/skills/weread-skills/SKILL.md'), path.join(homedir(), '.codex/skills/weread-skills/SKILL.md')]) {
    try { const version = readFileSync(p, 'utf8').match(/^version:\s*([\d.]+)/m)?.[1]; if (version) return version; } catch { /* Use the documented version if no local skill is installed. */ }
  }
  return '1.0.5';
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

export function createGateway(apiKey: string, version: string, signal?: AbortSignal, transport = fetch) {
  return async (api_name: string, params: Row = {}): Promise<Row> => {
    signal?.throwIfAborted();
    const response = await transport('https://i.weread.qq.com/api/agent/gateway', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...params, api_name, skill_version: version }),
      signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])])
    });
    const data = await response.json().catch(() => { throw new GatewayError('微信读书返回了无法解析的数据，请稍后重试。'); }) as Row;
    if (data.upgrade_info) throw new GatewayError(`微信读书接口要求升级：${data.upgrade_info.message || '请更新 weread-skills 后重试。'}`, true);
    if (!response.ok || nError(data.errcode)) throw new GatewayError(data.errmsg || `微信读书请求失败（${response.status}），请检查 API Key。`, response.status === 401 || response.status === 403);
    return data;
  };
}
const nError = (value: unknown) => value != null && Number(value) !== 0;
type Call = ReturnType<typeof createGateway>;

export function joinShelfReadingTime(shelf: Row): void {
  const byId = new Map<string, number>();
  for (const entry of Array.isArray(shelf.bookProgress) ? shelf.bookProgress : []) {
    if (!entry?.bookId || typeof entry.readingTime !== 'number' || !Number.isFinite(entry.readingTime) || entry.readingTime < 0) continue;
    byId.set(String(entry.bookId), entry.readingTime);
  }
  shelf.books = (shelf.books || []).map((book: ShelfBook) => {
    const readingTime = byId.get(String(book.bookId));
    return readingTime === undefined ? book : { ...book, readingTime };
  });
}

export async function fetchShelfProgress(call: Call, books: ShelfBook[], warnings: string[], signal: AbortSignal, step: (message: string) => void): Promise<ShelfBook[]> {
  const results = new Map<string, ShelfBook>();
  const unique = [...new Map(books.filter(b => b.bookId).map(b => [String(b.bookId), b])).values()];
  await mapLimit(unique, 3, async book => {
    const bookId = String(book.bookId);
    let result: ShelfBook = { ...book, progressFetchState: 'failed' };
    try {
      signal.throwIfAborted();
      const data = await call('/book/getprogress', { bookId });
      const p = data.book;
      if (!p || typeof p !== 'object' || Array.isArray(p) || !['progress', 'isStartReading', 'recordReadingTime', 'updateTime'].some(key => p[key] != null)) throw new GatewayError('未返回单书进度');
      result = { ...book, progressFetchState: 'fetched' };
      const progress = readingProgress(p.progress);
      if (progress !== undefined) result.progress = progress;
      for (const key of ['recordReadingTime', 'chapterUid', 'isStartReading']) {
        if (typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] >= 0) result[key] = p[key];
      }
      if (typeof p.updateTime === 'number' && p.updateTime > 0 && Number.isFinite(p.updateTime)) result.lastReadAt = p.updateTime;
      if (progress === 100 && typeof p.finishTime === 'number' && p.finishTime > 0 && Number.isFinite(p.finishTime)) result.finishTime = p.finishTime;
    } catch (error) {
      if (signal.aborted || error instanceof GatewayError && error.fatal) throw error;
      warnings.push(`《${book.title || bookId}》单书进度读取失败，保留书架与笔记记录`);
    }
    if (result.progressFetchState === 'fetched' && result.chapterUid != null && result.chapterUid > 0) {
      try {
        const data = await call('/book/chapterinfo', { bookId });
        const chapter = data.chapters?.find((c: Row) => c.chapterUid === result.chapterUid);
        if (typeof chapter?.title === 'string') result.chapterTitle = chapter.title;
      } catch (error) {
        if (signal.aborted || error instanceof GatewayError && error.fatal) throw error;
        warnings.push(`《${book.title || bookId}》当前章节名称读取失败，保留阅读进度`);
      }
    }
    results.set(bookId, result);
    step(`已核对《${book.title || bookId}》阅读进度`);
  });
  return books.map(b => results.get(String(b.bookId)) || { ...b, progressFetchState: 'failed' });
}

export async function fetchNotebooks(call: Call): Promise<Row[]> {
  const all = new Map<string, Row>();
  const cursors = new Set<number>();
  let lastSort: number | undefined;
  while (true) {
    const data = await call('/user/notebooks', { count: 100, ...(lastSort ? { lastSort } : {}) });
    const rows: Row[] = data.books || [];
    for (const b of rows) { const id = String(b.bookId || b.book?.bookId || ''); if (id) all.set(id, b); }
    if (!data.hasMore) return [...all.values()];
    const nextSort = Number(rows.at(-1)?.sort);
    if (!nextSort || cursors.has(nextSort)) throw new GatewayError('笔记分页游标未推进，无法确认数据完整性。请重试。');
    cursors.add(nextSort); lastSort = nextSort;
  }
}

export async function fetchReviews(call: Call, bookId: string): Promise<Row[]> {
  const all = new Map<string, Row>();
  const cursors = new Set<number>();
  let synckey: number | undefined;
  while (true) {
    const data = await call('/review/list/mine', { bookid: bookId, count: 100, ...(synckey ? { synckey } : {}) });
    for (const row of data.reviews || []) { const r = row.review || row; all.set(String(r.reviewId || `${r.createTime}:${r.content}`), row); }
    if (!data.hasMore) return [...all.values()];
    const next = Number(data.synckey);
    if (!next || cursors.has(next)) throw new GatewayError('想法分页游标未推进，该书想法未完整读取。');
    cursors.add(next); synckey = next;
  }
}

export async function collectReport(apiKey: string, count: number, progress: (message: string, completed: number, total: number) => void, signal: AbortSignal, transport = fetch): Promise<Report> {
  const version = skillVersion(), call = createGateway(apiKey, version, signal, transport);
  const labels = monthsInRange(count);
  const years = [...new Set(labels.map(m => m.slice(0, 4)))];
  let done = 0, total = labels.length + years.length + 3;
  const warnings: string[] = [];
  const step = (message: string) => progress(message, ++done, total);
  progress('正在连接微信读书', 0, total);
  // Authenticate before starting the batch, so invalid credentials do not fan out.
  const first = monthSummary(await call('/readdata/detail', { mode: 'monthly', baseTime: timestamp(`${labels[0]}-15`) }), labels[0]);
  step('已连接，正在读取月度阅读记录');
  const rest = await mapLimit(labels.slice(1), 3, async label => { const data = await call('/readdata/detail', { mode: 'monthly', baseTime: timestamp(`${label}-15`) }); step(`已读取 ${label} 阅读记录`); return monthSummary(data, label); });
  const annual = await mapLimit(years, 3, async year => { const data = await call('/readdata/detail', { mode: 'annually', baseTime: timestamp(`${year}-01-15`) }); step(`已读取 ${year} 年度偏好`); return { ...data, year }; });
  let overall: Row = {};
  try { overall = await call('/readdata/detail', { mode: 'overall' }); }
  catch (error) { if (signal.aborted || error instanceof GatewayError && error.fatal) throw error; warnings.push('账户总计阅读时段读取失败，保留月度与年度时段数据'); }
  step('阅读时段已核对');
  const shelf = await call('/shelf/sync'); joinShelfReadingTime(shelf); step('书架已同步');
  const notebooks = await fetchNotebooks(call); step(`找到 ${notebooks.length} 本笔记书籍`);
  total += new Set((shelf.books || []).filter((b: Row) => b.bookId).map((b: Row) => String(b.bookId))).size;
  progress('正在核对单书阅读进度', done, total);
  shelf.books = await fetchShelfProgress(call, shelf.books || [], warnings, signal, step);
  total += notebooks.length;
  progress('正在读取划线与想法', done, total);
  const details = await mapLimit(notebooks, 3, async nb => {
    signal.throwIfAborted();
    const bookId = String(nb.bookId || nb.book?.bookId);
    const detail: Row = { bookId, highlights: [], reviews: [] };
    for (const kind of ['highlights', 'reviews']) {
      try { detail[kind] = kind === 'highlights' ? (await call('/book/bookmarklist', { bookId })).updated || [] : await fetchReviews(call, bookId); }
      catch (error) { if (signal.aborted || error instanceof GatewayError && error.fatal) throw error; warnings.push(`《${nb.book?.title || bookId}》${kind === 'highlights' ? '划线' : '想法'}读取失败`); }
    }
    step(`正在整理《${nb.book?.title || '笔记'}》`);
    return detail;
  });
  signal.throwIfAborted();
  progress('正在生成阅读报告', total, total);
  return aggregate({ months: [first, ...rest], annual, overall, shelf, notebooks, details, warnings, version });
}
