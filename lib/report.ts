import { FEATURED_HIGHLIGHT_LIMIT, type ReadingBook, type Report, type Row } from '../src/types';
import { lastReadTime, readingProgress, readingStatus } from '../src/readingDetails';

export const TIMEZONE = 'Asia/Shanghai';
export const n = (value: unknown): number => Math.max(0, Number(value) || 0);
export const hours = (seconds: unknown) => Math.round(n(seconds) / 36) / 100;
export const dateKey = (timestamp: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp * 1000));
export const today = () => dateKey(Date.now() / 1000);
export const timestamp = (date: string) => new Date(`${date}T00:00:00+08:00`).getTime() / 1000;

export function monthsInRange(count: number, end = today()): string[] {
  const [year, month] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - count + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export function parseDuration(text: unknown) {
  const value = String(text ?? '');
  return n(value.match(/([\d.]+)小时/)?.[1]) * 3600 + n(value.match(/([\d.]+)分钟/)?.[1]) * 60 + n(value.match(/([\d.]+)秒/)?.[1]);
}

export function monthSummary(data: Row, label: string) {
  const daily = Object.entries(data.readTimes || {}).flatMap(([ts, value]) => {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return [];
    const date = dateKey(num);
    return date.startsWith(label) && date <= today() ? [{ date, seconds: n(value) }] : [];
  });
  return { ...data, label, daily, seconds: n(data.totalReadTime), days: n(data.readDays) };
}

function counter() {
  const map = new Map<string, number>();
  return { add: (name: string, value: number) => map.set(name, (map.get(name) || 0) + value), rows: (key = 'value') => [...map].map(([name, value]) => ({ name, [key]: value })).sort((a, b) => n(b[key]) - n(a[key])) as Row[] };
}

export function hourlyDistribution(months: Row[], annual: Row[], overall: Row = {}) {
  const valid = (row: Row) => Array.isArray(row.preferTime) && row.preferTime.length === 24 && row.preferTime.some((v: unknown) => n(v) > 0);
  const monthly = months.filter(valid), yearly = annual.filter(valid);
  const source = monthly.length === months.length && monthly.length ? 'monthly' : yearly.length ? 'annual' : valid(overall) ? 'overall' : monthly.length ? 'monthly' : 'unavailable';
  const rows = source === 'monthly' ? monthly : source === 'annual' ? yearly : source === 'overall' ? [overall] : [];
  const values = Array<number>(24).fill(0);
  for (const row of rows) row.preferTime.forEach((value: unknown, i: number) => { values[(i + 6) % 24] += n(value); });
  const word = [overall, ...annual, ...months].map(row => row.preferTimeWord).find((text: unknown) => typeof text === 'string' && text.trim());
  const note = source === 'overall' ? '账户全部历史的小时分布；所选区间未返回完整时段数据' : source === 'annual' ? `覆盖到的自然年口径 · ${yearly.length}/${annual.length} 年有时段数据` : source === 'monthly' ? `所选区间 · ${monthly.length}/${months.length} 个月有时段数据` : `微信读书未返回24小时分布${word ? `；${word}（接口文字概述）` : ''}`;
  return { values, source, note } as const;
}

export function aggregate(input: { months: Row[]; annual: Row[]; overall?: Row; shelf: Row; notebooks: Row[]; details: Row[]; warnings: string[]; version: string }): Report {
  const { months, annual, shelf, notebooks, details, warnings, version } = input;
  const start = `${months[0].label}-01`, end = today();
  const inRange = (ts: unknown) => { const t = Number(ts); return Number.isFinite(t) && t > 0 && dateKey(t) >= start && dateKey(t) <= end; };
  const cats = counter(), categoryCounts = counter(), authors = counter(), authorCounts = counter(), publishers = counter();
  const books = new Map<string, Row>();
  const daily = months.flatMap(m => m.daily).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of months) for (const item of m.readLongest || []) {
    const book = item.book || item.albumInfo;
    const title = book?.title || book?.name;
    if (!title) continue;
    const id = String(book.bookId || book.albumId || title);
    const old = books.get(id);
    books.set(id, { bookId: id, title, author: book.author || book.authorName || '', cover: book.cover || '', seconds: (old?.seconds || 0) + n(item.readTime) });
  }
  let read = 0, listen = 0;
  const hourly = hourlyDistribution(months, annual, input.overall);
  for (const a of annual) {
    for (const c of a.preferCategory || []) { const name = c.categoryTitle || c.parentCategoryTitle || '未分类'; cats.add(name, n(c.readingTime)); categoryCounts.add(name, n(c.readingCount)); }
    for (const row of a.preferAuthor || []) { authors.add(row.name, parseDuration(row.readTime)); authorCounts.add(row.name, n(row.count)); }
    for (const row of a.preferPublisher || []) publishers.add(row.name, n(row.count));
    read += n(a.wrReadTime); listen += n(a.wrListenTime);
  }
  const authorsSource = authors.rows().length ? 'annualPreferAuthor' : 'monthlyReadLongest';
  if (authorsSource === 'monthlyReadLongest') {
    for (const b of books.values()) if (b.author) { authors.add(b.author, b.seconds); authorCounts.add(b.author, 1); }
  }
  const noteFetchErrors = warnings.filter(w => /划线读取失败|想法读取失败/.test(w)).length;
  const shelfCats = counter(), finished = counter(), privacy = counter();
  for (const name of ['读完', '在读', '未读']) finished.add(name, 0);
  const shelfBooks: Row[] = shelf.books || [], albums: Row[] = shelf.albums || [];
  const mp = shelf.mp && Object.keys(shelf.mp).length ? 1 : 0;
  const notebookLookup = new Map(notebooks.map(nb => [String(nb.bookId || nb.book?.bookId), nb]));
  for (const b of shelfBooks) { shelfCats.add(b.category || '未分类', 1); const nb = notebookLookup.get(String(b.bookId)); if (b.progressFetchState !== 'fetched' && readingProgress(nb?.readingProgress) !== undefined) b.progress = readingProgress(nb?.readingProgress); b.readingStatus = readingStatus(b, nb); finished.add(b.readingStatus, 1); privacy.add(n(b.secret) === 1 ? '私密阅读' : '公开阅读', 1); }
  for (const a of albums) { shelfCats.add('有声/专辑', 1); privacy.add(n(a.albumInfoExtra?.secret) === 1 ? '私密阅读' : '公开阅读', 1); }
  if (mp) { shelfCats.add('文章收藏', 1); privacy.add('私密阅读', 1); }
  const noteTypes = counter();
  const noteBooks = notebooks.map(item => {
    const b = item.book || {}, id = String(item.bookId || b.bookId);
    noteTypes.add('划线', n(item.noteCount)); noteTypes.add('想法/点评', n(item.reviewCount)); noteTypes.add('书签', n(item.bookmarkCount));
    return { bookId: id, title: b.title || '未命名书籍', author: b.author || '', cover: b.cover || '', progress: item.readingProgress == null ? null : n(item.readingProgress), total: n(item.noteCount) + n(item.reviewCount) + n(item.bookmarkCount), highlightCount: n(item.noteCount), reviewCount: n(item.reviewCount), bookmarkCount: n(item.bookmarkCount) };
  }).sort((a, b) => b.total - a.total);
  const lookup = new Map(noteBooks.map(b => [b.bookId, b]));
  const quotes: Row[] = [], allHighlights: Row[] = [], texts: string[] = [], timeline = counter(), lengths = counter();
  let highlightCount = 0, reviewCount = 0;
  const seen = new Set<string>();
  for (const detail of details) {
    const book = lookup.get(String(detail.bookId));
    for (const h of detail.highlights || []) {
      if (h.markText?.trim()) allHighlights.push({ id: `${detail.bookId}:${allHighlights.length}`, text: h.markText.trim(), bookId: String(detail.bookId), bookTitle: book?.title || '未知书籍', author: book?.author || '', createdAt: n(h.createTime) > 0 ? dateKey(n(h.createTime)) : undefined, chapterUid: h.chapterUid == null ? undefined : String(h.chapterUid) });
      if (!inRange(h.createTime) || !h.markText?.trim()) continue;
      highlightCount++; texts.push(h.markText); timeline.add(dateKey(n(h.createTime)).slice(0, 7), 1);
      lengths.add(h.markText.length < 50 ? '50字以下' : h.markText.length < 100 ? '50–99字' : h.markText.length < 200 ? '100–199字' : '200字及以上', 1);
      const text = h.markText.trim();
      if (!seen.has(text) && text.length >= 12) { seen.add(text); quotes.push({ text, bookId: detail.bookId, bookTitle: book?.title || '未知书籍', author: book?.author || '', createdAt: dateKey(n(h.createTime)) }); }
    }
    for (const item of detail.reviews || []) {
      const r = item.review || item;
      if (!inRange(r.createTime) || !r.content?.trim()) continue;
      reviewCount++; texts.push(r.content); timeline.add(dateKey(n(r.createTime)).slice(0, 7), 1);
    }
  }
  const terms = extractTerms(texts);
  quotes.sort((a, b) => quoteScore(b.text, terms) - quoteScore(a.text, terms));
  const totalSeconds = months.reduce((sum, m) => sum + m.seconds, 0);
  let cumulative = 0;
  const catsRows: Row[] = cats.rows('seconds').filter(c => c.seconds > 0).map(c => ({ ...c, hours: hours(c.seconds), count: categoryCounts.rows().find(row => row.name === c.name)?.value || 0 }));
  const topBooks: Row[] = [...books.values()].sort((a, b) => b.seconds - a.seconds).map(b => ({ ...b, hours: hours(b.seconds) }));
  const monthLabels = months.map(m => m.label);
  const bookMetadata = new Map([...shelfBooks, ...notebooks.map(nb => ({ ...nb.book, bookId: nb.bookId || nb.book?.bookId }))].map(b => [String(b.bookId), b]));
  const rankedBooks = (rows: Row[]): ReadingBook[] => rows.flatMap(row => {
    const book = row.book || row.albumInfo;
    const title = book?.title || book?.name;
    if (!title) return [];
    const id = String(book.bookId || book.albumId || title), meta = bookMetadata.get(id);
    return [{ bookId: id, title, seconds: n(row.readTime), category: book.category || book.categories?.[0]?.title || meta?.category || meta?.categories?.[0]?.title || '' }];
  });
  const monthlyBooks = Object.fromEntries(months.map(m => [m.label, rankedBooks(m.readLongest || [])]));
  const dailyNotes = new Map<string, Map<string, ReadingBook>>();
  const monthNotes = new Map<string, Map<string, ReadingBook>>();
  const dailyRecent = new Map<string, Map<string, ReadingBook>>();
  const monthRecent = new Map<string, Map<string, ReadingBook>>();
  for (const book of shelfBooks) {
    const day = lastReadTime(book) > 0 ? dateKey(lastReadTime(book)) : '';
    if (!day || day < start || day > end || !book.bookId || !book.title) continue;
    const row: ReadingBook = { bookId: String(book.bookId), title: book.title, category: book.category || book.categories?.[0]?.title || '', periodNote: '书架最后阅读日期，非逐书时长' };
    if (!dailyRecent.has(day)) dailyRecent.set(day, new Map());
    dailyRecent.get(day)!.set(row.bookId, row);
    const month = day.slice(0, 7);
    if (!monthRecent.has(month)) monthRecent.set(month, new Map());
    monthRecent.get(month)!.set(row.bookId, row);
  }
  const recordNote = (bookId: string, when: unknown) => {
    const ts = Number(when);
    if (!Number.isFinite(ts) || ts <= 0) return;
    const day = dateKey(ts);
    if (day < start || day > end) return;
    const book = bookMetadata.get(bookId);
    if (!book?.title) return;
    const row: ReadingBook = { bookId, title: book.title, category: book.category || book.categories?.[0]?.title || '', periodNote: '笔记活动，非阅读时长' };
    if (!dailyNotes.has(day)) dailyNotes.set(day, new Map());
    dailyNotes.get(day)!.set(bookId, row);
    const month = day.slice(0, 7);
    if (!monthNotes.has(month)) monthNotes.set(month, new Map());
    monthNotes.get(month)!.set(bookId, row);
  };
  for (const detail of details) {
    const id = String(detail.bookId || '');
    for (const note of detail.highlights || []) recordNote(id, note.createTime);
    for (const item of detail.reviews || []) recordNote(id, (item.review || item).createTime);
  }
  const monthlyNoteBooks = Object.fromEntries([...monthNotes].map(([month, rows]) => [month, [...rows.values()].slice(0, 10)]));
  const dailyNoteBooks = Object.fromEntries([...dailyNotes].map(([day, rows]) => [day, [...rows.values()].slice(0, 8)]));
  const monthlyRecentBooks = Object.fromEntries([...monthRecent].map(([month, rows]) => [month, [...rows.values()].slice(0, 10)]));
  const dailyRecentBooks = Object.fromEntries([...dailyRecent].map(([day, rows]) => [day, [...rows.values()].slice(0, 8)]));
  const weekday = new Map<string, number>();
  for (const d of daily) { const day = (new Date(`${d.date}T12:00:00+08:00`).getUTCDay() + 6) % 7; const key = `${monthLabels.indexOf(d.date.slice(0, 7))},${day}`; weekday.set(key, (weekday.get(key) || 0) + d.seconds); }
  const days = months.reduce((sum, m) => sum + m.days, 0);
  const summary = catsRows.length ? `你在${catsRows.slice(0, 3).map(c => c.name).join('、')}之间留下阅读的轨迹。${hours(totalSeconds)} 小时、${days} 个阅读日，构成这段时间的积累。${topBooks[0] ? `《${topBooks[0].title}》是你停留最久的一本书。` : ''}` : `这段时间，你累计阅读 ${hours(totalSeconds)} 小时，留下 ${highlightCount} 条可追溯的划线。`;
  return {
    meta: { start, end, range: `${start} 至 ${end}`, generatedAt: new Date().toISOString(), timezone: TIMEZONE, skillVersion: version, schemaVersion: 2, dataCaveat: '时长与阅读天数按自然月接口汇总；每日图表仅展示返回的明细。分类、作者、出版社按覆盖到的自然年统计。书架与笔记总量为当前账户累计值。' },
    kpis: { totalReadHours: hours(totalSeconds), readDays: days, shelfTotal: shelfBooks.length + albums.length + mp, ebookCount: shelfBooks.length, albumCount: albums.length, mpCount: mp, notebookBooks: noteBooks.length, noteTotal: noteBooks.reduce((s, b) => s + b.total, 0), highlightsFetchedInRange: highlightCount, reviewsFetchedInRange: reviewCount, noteFetchErrors },
    series: {
      months: monthLabels, monthlyReadHours: months.map(m => hours(m.seconds)), monthlyReadDays: months.map(m => m.days),
      monthlyReadStat: months.map(m => { const get = (stat: string) => n(String((m.readStat || []).find((r: Row) => r.stat === stat)?.counts || '').replace(/[^\d]/g, '')); return { month: m.label, readBooks: get('读过'), finishedBooks: get('读完'), notes: get('笔记') }; }),
      dailyHeat: daily.map(d => [d.date, Math.round(d.seconds / 6) / 10]),
      weekdayHeat: [...weekday].map(([key, seconds]) => { const [month, day] = key.split(',').map(Number); return [day, month, hours(seconds)]; }),
      weekdayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      cumulativeReadHours: daily.map(d => { cumulative += d.seconds; return [d.date, hours(cumulative)]; }),
      annualRows: annual.map(a => ({ year: a.year, hours: hours(a.totalReadTime), readDays: n(a.readDays) })), hourly: hourly.values, hourlySource: hourly.source, hourlyNote: hourly.note, monthlyBooks, monthlyNoteBooks, dailyNoteBooks, monthlyRecentBooks, dailyRecentBooks
    },
    reading: { topBooks, categories: catsRows, authorsSource, authors: authors.rows('seconds').map(a => ({ ...a, hours: hours(a.seconds), count: authorCounts.rows().find(r => r.name === a.name)?.value || 0 })), publishers: publishers.rows('count'), readListen: [{ name: '文字阅读', value: hours(read) }, { name: '听书/有声', value: hours(listen) }].filter(r => r.value > 0) },
    shelf: { composition: [{ name: '电子书', value: shelfBooks.length }, { name: '有声/专辑', value: albums.length }, { name: '文章收藏', value: mp }], categories: shelfCats.rows(), finished: finished.rows(), privacy: privacy.rows(), archives: (shelf.archive || []).map((a: Row) => ({ name: a.name || '未命名书单', value: (a.bookIds || []).length })), books: shelfBooks },
    notes: { topBooks: noteBooks, typeTotals: noteTypes.rows(), progressScatter: noteBooks.filter(b => b.progress !== null).map(b => [b.progress, b.total, b.title]), wordCloud: terms, timeline: monthLabels.map(month => ({ month, count: timeline.rows().find(r => r.name === month)?.value || 0 })), highlightLength: lengths.rows('count') },
    readerPortrait: { summary, goldenQuote: quotes[0] || '', quotes: quotes.slice(0, FEATURED_HIGHLIGHT_LIMIT), allHighlights },
    evolution: annual.map(a => {
      const annualBooks = rankedBooks(a.readLongest || []).map(b => ({ ...b, periodNote: '自然年时长' }));
      const monthly = new Map<string, ReadingBook>();
      for (const m of months.filter(m => m.label.startsWith(String(a.year)))) for (const b of monthlyBooks[m.label]) { const old = monthly.get(b.bookId); monthly.set(b.bookId, { ...b, seconds: (old?.seconds || 0) + b.seconds, periodNote: '所选月份排行累计' }); }
      const evidence = new Map([...monthly.values(), ...annualBooks].map(b => [b.bookId, b]));
      const normalizeCategory = (name: string) => name.trim().replace(/^\[|\]$/g, '').replace(/\s+/g, '');
      const belongs = (book: ReadingBook, category: Row) => {
        if (!book.category) return false;
        const parts = book.category.split(/[-－—]/).map(normalizeCategory).filter(Boolean);
        const title = normalizeCategory(category.categoryTitle || category.parentCategoryTitle || '');
        const parent = normalizeCategory(category.parentCategoryTitle || '');
        return title === parent || !parent ? parts[0] === title : parts.at(-1) === title && parts[0] === parent;
      };
      const noteBooks = [...monthNotes].filter(([month]) => month.startsWith(String(a.year))).flatMap(([, rows]) => [...rows.values()]);
      const recentBooks = [...monthRecent].filter(([month]) => month.startsWith(String(a.year))).flatMap(([, rows]) => [...rows.values()]);
      return { year: String(a.year), hours: hours(a.totalReadTime), categories: (a.preferCategory || []).filter((c: Row) => n(c.readingTime) > 0).map((c: Row) => { const name = c.categoryTitle || c.parentCategoryTitle || '未分类'; const ranked = [...evidence.values()].filter(b => belongs(b, c)).sort((x, y) => (y.seconds || 0) - (x.seconds || 0)); const seen = new Set(ranked.map(b => b.bookId)); const leads = [...noteBooks, ...recentBooks].filter(b => belongs(b, c) && !seen.has(b.bookId)); const classified = [...ranked, ...new Map(leads.map(b => [b.bookId, b])).values()].slice(0, 12); return { name, hours: hours(c.readingTime), books: classified, booksNote: ranked.length ? '书籍时长来自排行样本；分类合计可能高于已列书籍' : leads.length ? '只找到对应分类的笔记或书架记录，不能由此推算逐书时长' : '年度分类有时长，但没有能归属到该分类的逐书样本' }; }), books: annualBooks.map(b => b.title), highlights: quotes.filter(q => q.createdAt.startsWith(String(a.year))).slice(0, 4).map(q => q.text) };
    }),
    coverage: { monthlyRequests: months.length, annualRequests: annual.length, monthsWithBookRanking: Object.values(monthlyBooks as Record<string, ReadingBook[]>).filter(rows => rows.length).length, monthsWithNotes: monthNotes.size, daysWithLastRead: dailyRecent.size, hourlySource: hourly.source, notebooks: noteBooks.length, noteDetailBooksFetched: details.length, noteFetchErrors, shelfProgressRequested: shelfBooks.length, shelfProgressFetched: shelfBooks.filter(b => b.progressFetchState === 'fetched').length, shelfProgressErrors: shelfBooks.filter(b => b.progressFetchState === 'failed').length, shelfReadingTimeAvailable: shelfBooks.filter(b => typeof b.readingTime === 'number' && Number.isFinite(b.readingTime) && b.readingTime >= 0).length }, warnings
  };
}

const DOMAIN_TERMS = ['人工智能', '机器学习', '深度学习', '大语言模型', '强化学习', '产品设计', '商业模式', '用户体验', '认知科学', '系统思考', '长期主义', '独立思考', '自由', '孤独', '社会', '心理', '历史', '哲学', '文学', '技术', '创业', '学习', '时间', '生命', '关系', '秩序', '意义', '资本', '知识', '决策', '创新', '科学', '文化', '经济', '人性', '自我'];
export function extractTerms(texts: string[]) {
  const text = texts.join('\n');
  const terms = DOMAIN_TERMS.map(name => ({ name, value: text.split(name).length - 1 })).filter(t => t.value > 0);
  return terms.sort((a, b) => b.value - a.value).slice(0, 35);
}
function quoteScore(text: string, terms: Row[]) { return terms.reduce((score, term) => score + (text.includes(term.name) ? 1 : 0), 0) + (text.length >= 20 && text.length <= 180 ? 3 : 0); }
