import type { ReadingBook, Report, Row, ShelfBook } from './types';

export function readingProgress(value: unknown): number | undefined {
  if (value == null || value === '' || typeof value === 'boolean') return undefined;
  const progress = Number(value);
  return Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : undefined;
}

export function lastReadTime(book: ShelfBook): number {
  const value = Number(book.lastReadAt ?? book.readUpdateTime);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function readingDate(value: unknown): string {
  const timestamp = Number(value);
  const date = new Date(timestamp * 1000);
  return timestamp > 0 && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '未提供';
}

export function sortShelfBooks(books: ShelfBook[], sort: string): ShelfBook[] {
  const metric = (b: ShelfBook) => sort === 'progress' ? readingProgress(b.progress ?? b.readingProgress) ?? -1 : sort === 'duration' ? (typeof b.readingTime === 'number' && Number.isFinite(b.readingTime) && b.readingTime >= 0 ? b.readingTime : -1) : lastReadTime(b);
  return [...books].sort((a, b) => metric(b) - metric(a));
}

export function duration(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value > 0 && value < 60) return '不足1分钟';
  const minutes = Math.floor(value / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return [h ? `${h}小时` : '', m || !h ? `${m}分钟` : ''].join('');
}

export function bookDetailText(books: ReadingBook[]) {
  return books.length ? books.map(b => `《${b.title}》${b.seconds == null ? '' : ` · ${duration(b.seconds)}`}`).join('\n') : '未返回对应书籍时长明细';
}

export function monthlyTooltip(report: Report, index: number, value: number, unit: string) {
  const month = report.series.months[index];
  const books = report.series.monthlyBooks?.[month] || [];
  const notes = report.series.monthlyNoteBooks?.[month] || [];
  const recent = report.series.monthlyRecentBooks?.[month] || [];
  return `${month}\n${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit}${books.length ? `\n\n本月阅读排行\n${bookDetailText(books)}` : notes.length ? `\n\n本月笔记线索\n${bookDetailText(notes)}` : recent.length ? `\n\n本月最近阅读线索\n${bookDetailText(recent)}` : '\n\n当月没有可核对的逐书记录'}`;
}

export function calendarTooltip(report: Report, date: string, minutes?: number) {
  const heading = `${date}\n${minutes == null ? '无当天阅读明细' : `当天总计 · ${duration(minutes * 60)}`}`;
  const dayNotes = report.series.dailyNoteBooks?.[date] || [];
  const recent = report.series.dailyRecentBooks?.[date] || [];
  if (dayNotes.length || recent.length) {
    const clues = new Map<string, { book: ReadingBook; sources: string[] }>();
    for (const [books, label] of [[dayNotes, '笔记'], [recent, '最后阅读']] as const) for (const book of books) {
      const key = book.bookId || book.title;
      const found = clues.get(key);
      if (found) found.sources.push(label);
      else clues.set(key, { book, sources: [label] });
    }
    const entries = [...clues.values()];
    const lines = entries.slice(0, 5).map(({ book }) => `《${book.title}》`);
    return `${heading}\n\n当日书籍线索\n${lines.join('\n')}${entries.length > 5 ? `\n另有 ${entries.length - 5} 本` : ''}`;
  }
  const monthBooks = report.series.monthlyBooks?.[date.slice(0, 7)] || [];
  return `${heading}${monthBooks.length ? `\n\n本月阅读排行\n${bookDetailText(monthBooks.slice(0, 5))}` : '\n\n当天没有可核对的逐书记录'}`;
}

export function readingStatus(book: Row, notebook?: Row): '读完' | '在读' | '未读' {
  const progress = Number(book.progress ?? book.readingProgress ?? notebook?.readingProgress);
  if (Number(book.finishReading) === 1 || progress === 100) return '读完';
  if (book.progressFetchState === 'fetched' && readingProgress(book.progress) !== undefined) return progress > 0 || Number(book.isStartReading) === 1 || Number(book.recordReadingTime) > 0 ? '在读' : '未读';
  if (Number(notebook?.markedStatus) === 1) return '读完';
  if (progress > 0 || Number(book.isStartReading) === 1 || Number(book.readUpdateTime) > 0 || Number(book.recordReadingTime) > 0 || Number(notebook?.noteCount) > 0 || Number(notebook?.reviewCount) > 0 || Number(notebook?.bookmarkCount) > 0) return '在读';
  return '未读';
}

export function shelfReadingStates(report: Report): Row[] {
  if (!report.shelf.books) return report.shelf.finished.filter(row => ['读完', '在读', '未读'].includes(row.name));
  const counts = { 读完: 0, 在读: 0, 未读: 0 };
  for (const book of report.shelf.books) {
    const status: unknown = book.readingStatus;
    counts[status === '读完' || status === '在读' || status === '未读' ? status : readingStatus(book)]++;
  }
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}
