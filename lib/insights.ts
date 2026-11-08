import { callModel } from './ai';
import { lastReadTime, readingDate, readingProgress, readingStatus } from '../src/readingDetails';
import type { AIConfig, InsightKind, InsightResult, Report, Row } from '../src/types';
import { resolvePrompt, withPrompt } from '../src/aiPrompts';
import { highlightPlan, type HighlightMode } from '../src/highlightPlan';
import { COGNITION, SYNTHESIZE_COGNITION, COLLISION, COLLISION_TYPES, HIGHLIGHT_OUTPUT_TOKENS } from '../src/insightInstructions';

type InsightItem = InsightResult['sections'][number]['items'][number];

const reading = (book: Row) => ['读完', '在读', '未读'].includes(book.readingStatus) ? book.readingStatus : readingStatus(book);
const safeText = (value: unknown, limit = 1000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const titleKey = (title: unknown) => safeText(title, 120).replace(/^[《〈\s]+|[》〉\s]+$/g, '').replace(/\s+/g, '').toLocaleLowerCase();

export function highlightBatches(report: Report, interleaveBooks = false) {
  const highlights: Row[] = (report.readerPortrait.allHighlights || []).map((quote, index) => ({ ...quote, id: String(quote.id || `legacy:${index}`) }));
  const source: Row[] = interleaveBooks ? (() => {
    const groups = new Map<string, Row[]>();
    for (const quote of highlights) {
      const key = String(quote.bookId || quote.bookTitle || 'unknown');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(quote);
    }
    const reordered: Row[] = [];
    while ([...groups.values()].some(group => group.length)) for (const group of groups.values()) { const next = group.shift(); if (next) reordered.push(next); }
    return reordered;
  })() : highlights;
  const batches: Row[][] = [];
  let batch: Row[] = [], size = 0;
  for (const [index, quote] of source.entries()) {
    if (typeof quote.text !== 'string' || !quote.text.trim()) continue;
    const item = { id: String(quote.id || `legacy:${index}`), bookId: String(quote.bookId || ''), bookTitle: String(quote.bookTitle || '未知书籍'), text: safeText(quote.text, 1200), date: quote.createdAt, chapterUid: quote.chapterUid == null ? undefined : safeText(String(quote.chapterUid), 80) };
    const length = JSON.stringify(item).length;
    if (batch.length && (batch.length >= 32 || size + length > 14000)) { batches.push(batch); batch = []; size = 0; }
    batch.push(item); size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function validateInsightItems(kind: InsightKind, value: Row, quotes: Map<string, Row>, shelf: Map<string, Row>, shelfTitles: Set<string>) {
  if (!value || !Array.isArray(value.items)) throw new Error('模型没有返回可核对的条目，请重试。');
  return (value.items as Row[]).slice(0, 8).flatMap((item: Row): InsightItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const heading = safeText(item.heading, 100), explanation = safeText(item.explanation, 700);
    if (!heading || !explanation) return [];
    if (kind === 'recommendations') {
      const status = item.status;
      const readingAnchor = safeText(item.readingAnchor, 30);
      if (status === '书架外') {
        const bookTitle = safeText(item.bookTitle, 120);
        return bookTitle && !shelfTitles.has(titleKey(bookTitle)) ? [{ heading, explanation, readingAnchor, bookTitle, status: '书架外 · 书目信息待核实' }] : [];
      }
      if (status !== '未读' && status !== '在读') return [];
      const bookId = String(item.bookId || ''), book = shelf.get(bookId);
      return book && reading(book) === status ? [{ heading, explanation, readingAnchor, bookId, bookTitle: String(book.title), status }] : [];
    }
    if (!Array.isArray(item.quoteIds) || item.quoteIds.some((id: unknown) => typeof id !== 'string' || !quotes.has(id))) return [];
    const ids = [...new Set(item.quoteIds)].slice(0, 3) as string[];
    if (!ids.length || (kind === 'collision' && new Set(ids.map(id => quotes.get(id)?.bookId)).size < 2)) return [];
    if (kind === 'collision') {
      const collisionType = item.collisionType, dialogue = safeText(item.dialogue, 500), reconciliation = safeText(item.reconciliation, 300);
      if (!COLLISION_TYPES.includes(collisionType) || !dialogue || !reconciliation || item.quoteIds.length !== 2 || ids.length !== 2 || quotes.get(ids[0])?.text === quotes.get(ids[1])?.text) return [];
      const date = (id: string) => String(quotes.get(id)?.date || quotes.get(id)?.createdAt || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date(ids[0])) && /^\d{4}-\d{2}-\d{2}$/.test(date(ids[1]))) ids.sort((a, b) => date(a).localeCompare(date(b)));
      return [{ heading, explanation, collisionType, dialogue, reconciliation, quoteIds: ids }];
    }
    if (kind === 'cognition') {
      const blindSpot = safeText(item.blindSpot, 400);
      if (!blindSpot || ids.length < 2 || new Set(ids.map(id => String(quotes.get(id)?.text || '').trim())).size < 2) return [];
      return [{ heading, explanation, blindSpot, quoteIds: ids }];
    }
    return [{ heading, explanation, quoteIds: ids }];
  });
}

const RECOMMEND = `仅基于输入书架和阅读偏好生成下一本阅读指南。只返回严格 JSON {"items":[{"heading":"6至10字微标题","explanation":"60至90字领读人手记，解释为什么是现在","readingAnchor":"30字以内阅读锚点，观察视角、阅读比喻或打开方式，不是考题","bookId":"本批书架候选原始ID或省略","bookTitle":"书名","status":"未读|在读|书架外"}]}。本批books中未读、在读各最多2本；仅allowExternal为true时推荐书架外最多2本，需为真实书目，本站未联网核实。currentReading是共同的在读背景，不得从中挑选不在本批books内的书架候选。favorites是区间排行样本，读过不等于读完；completed是当前书架已标记读完的样本。progress为当前进度百分比，currentChapter只是当前章节名，不能据此编造后续剧情或章节。没有值时不推测。不推荐已读完或无法核对状态的书。不得虚构阅读经历、用户动机、引语或购买链接。`;

export async function analyzeInsight(report: Report, config: AIConfig, kind: InsightKind, progress: (done: number, total: number) => void, signal?: AbortSignal, customPrompt?: string, mode: HighlightMode = 'selected'): Promise<InsightResult> {
  const prompt = resolvePrompt(kind, customPrompt);
  if (!['selected', 'all'].includes(mode)) throw new Error('请选择精选解读或全部划线。');
  const all = report.readerPortrait.allHighlights;
  if (kind !== 'recommendations' && (!all || !all.length)) throw new Error('这份报告未保存完整划线。请重新连接微信读书并生成报告后再试。');
  const shelfBooks = report.shelf.books || [], shelf = new Map(shelfBooks.filter(b => b.bookId).map(b => [String(b.bookId), b]));
  const shelfTitles = new Set(shelfBooks.map(b => titleKey(b.title)));
  const bookEvidence = (b: Row) => ({ bookId: String(b.bookId), title: safeText(b.title, 120), author: safeText(b.author, 120), category: safeText(b.category, 120), status: reading(b), progress: readingProgress(b.progress ?? b.readingProgress) ?? null, currentChapter: safeText(b.chapterTitle, 160) || null, lastReadAt: lastReadTime(b) > 0 ? readingDate(lastReadTime(b)) : null });
  const currentReading = shelfBooks.filter(b => reading(b) === '在读' && b.bookId && b.title).sort((a, b) => lastReadTime(b) - lastReadTime(a)).slice(0, 12).map(bookEvidence);
  const completed = shelfBooks.filter(b => reading(b) === '读完' && b.bookId && b.title).sort((a, b) => lastReadTime(b) - lastReadTime(a)).slice(0, 12).map(bookEvidence);
  const sections: InsightResult['sections'] = kind === 'recommendations' ? ['书架内 · 未读', '书架内 · 在读', '书架外 · 探索'].map(title => ({ title, items: [] })) : [{ title: kind === 'cognition' ? '个人认知图谱与暗线报告' : '跨书籍的想法大碰撞', items: [] }];
  const plan = kind === 'recommendations' ? undefined : highlightPlan(report, kind, mode);
  const chunks: Row[][] = kind === 'recommendations' ? (['未读', '在读'] as const).flatMap(status => {
    const items = shelfBooks.filter(b => reading(b) === status && b.bookId && b.title);
    return Array.from({ length: Math.ceil(items.length / 45) }, (_, i) => items.slice(i * 45, (i + 1) * 45).map(bookEvidence));
  }) : plan!.batches;
  if (plan && !chunks.length) throw new Error('没有有效划线可供分析，请更新阅读数据。');
  if (kind === 'recommendations' && !chunks.length) {
    if (!shelfBooks.length) throw new Error('当前没有可核对的书架数据，请先更新书架数据。');
    chunks.push([]);
  }
  let processed = 0, requests = 0;
  const totalRequests = chunks.length + (kind === 'cognition' && chunks.length > 1 ? 1 : 0);
  const discovered: InsightItem[][] = [];
  const record = (found: InsightItem[], index: number) => {
    discovered[index] = found;
    if (kind !== 'recommendations') return;
    for (const item of found) {
      const target = item.status === '未读' ? 0 : item.status === '在读' ? 1 : 2;
      if (!sections[target].items.some(old => item.bookId && old.bookId === item.bookId || item.bookTitle && titleKey(old.bookTitle) === titleKey(item.bookTitle))) sections[target].items.push(item);
    }
  };
  const controller = new AbortController();
  const taskSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const analyzeChunk = async (chunk: Row[], index: number) => {
    taskSignal.throwIfAborted();
    const payload = kind === 'recommendations' ? { books: chunk, interests: report.reading.categories.slice(0, 10), favorites: report.reading.topBooks.slice(0, 12).map(b => ({ title: b.title, author: b.author, hours: b.hours })), currentReading, completed, scope: '进度、章节和已读状态为当前书架快照；阅读排行为所选区间样本', allowExternal: index === 0 } : { highlights: chunk, selection: { mode, available: plan!.available, unique: plan!.unique, selected: plan!.selected, sampled: plan!.sampled, scope: '基于本次选取的材料观察，不推断全部划线中的主题频率，不保证穷尽所有关联' } };
    const response = await callModel(config, withPrompt(kind === 'recommendations' ? RECOMMEND : kind === 'cognition' ? COGNITION : COLLISION, prompt), JSON.stringify(payload), taskSignal, kind === 'recommendations' ? 3000 : HIGHLIGHT_OUTPUT_TOKENS[kind]);
    taskSignal.throwIfAborted();
    requests++;
    const allowed = kind === 'recommendations' ? shelf : new Map(chunk.map(q => [String(q.id), q]));
    const found = validateInsightItems(kind, response, allowed, kind === 'recommendations' ? new Map(chunk.map(b => [b.bookId, shelf.get(b.bookId)!])) : shelf, shelfTitles).filter(item => kind !== 'recommendations' || index === 0 || !item.status?.startsWith('书架外'));
    record(found, index);
    processed += chunk.length;
    progress(requests, totalRequests);
  };
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      taskSignal.throwIfAborted();
      const index = next++;
      try { await analyzeChunk(chunks[index], index); }
      catch (error) { controller.abort(error); throw error; }
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(chunks.length, kind === 'recommendations' ? 1 : 2) }, worker));
  const failed = workers.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  taskSignal.throwIfAborted();
  if (kind === 'cognition' && chunks.length > 1) {
    signal?.throwIfAborted();
    // Sample observations across the whole run so synthesis stays within a bounded context.
    const candidates = discovered.flat();
    const observations = candidates.length <= 24 ? candidates : Array.from({ length: 24 }, (_, index) => candidates[Math.floor((index + 0.5) * candidates.length / 24)]);
    if (observations.length) {
      const ids = new Set(observations.flatMap(item => item.quoteIds || []));
      const evidence = chunks.flat().filter(quote => ids.has(quote.id));
      const response = await callModel(config, withPrompt(SYNTHESIZE_COGNITION, prompt), JSON.stringify({ observations, highlights: evidence, selection: { mode, available: plan!.available, unique: plan!.unique, selected: plan!.selected, sampled: plan!.sampled } }), taskSignal, HIGHLIGHT_OUTPUT_TOKENS.synthesis);
      taskSignal.throwIfAborted();
      requests++;
      const merged = validateInsightItems(kind, response, new Map(evidence.map(q => [q.id, q])), shelf, shelfTitles);
      discovered.splice(0, discovered.length, merged);
    }
    progress(totalRequests, totalRequests);
  }
  if (kind !== 'recommendations') {
    // Spread evidence across the entire run, instead of returning only the first batches.
    const selected = discovered.filter(items => items.length);
    const slots = Math.min(12, selected.length);
    for (let index = 0; index < slots; index++) {
      const group = selected[Math.floor((index + 0.5) * selected.length / slots)];
      const item = group[index % group.length];
      if (!sections[0].items.some(old => old.quoteIds?.join(',') === item.quoteIds?.join(','))) sections[0].items.push(item);
    }
    for (const group of selected) for (const item of group) {
      if (sections[0].items.length >= 12) break;
      if (!sections[0].items.some(old => old.quoteIds?.join(',') === item.quoteIds?.join(','))) sections[0].items.push(item);
    }
  }
  for (const section of sections) section.items = section.items.slice(0, kind === 'recommendations' ? 6 : kind === 'cognition' ? 4 : 12);
  return { kind, prompt, model: config.model, generatedAt: new Date().toISOString(), coverage: { available: kind === 'recommendations' ? shelfBooks.length : (all || []).length, processed, batches: requests, incomplete: kind === 'recommendations' ? !report.shelf.books : Number(report.kpis.noteFetchErrors || 0) > 0, ...(plan ? { mode, unique: plan.unique, sampled: plan.sampled, books: plan.books, totalBooks: plan.totalBooks, excerptChars: plan.excerptChars } : {}) }, sections };
}
