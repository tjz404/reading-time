import type { InsightKind, Report, Row } from './types';

export type HighlightMode = 'selected' | 'all';
export const HIGHLIGHT_BATCH_CHARS = 14000;

function interleave(groups: Row[][]) {
  const result: Row[] = [];
  const length = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < length; index++) for (const group of groups) if (group[index]) result.push(group[index]);
  return result;
}

function spread(rows: Row[]) {
  // Visit evenly spaced dates first, then fill the gaps without losing any entries.
  const sorted = [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const order: number[] = [], queue: [number, number][] = [[0, sorted.length - 1]];
  for (let index = 0; index < queue.length; index++) {
    const [start, end] = queue[index];
    if (start > end) continue;
    const middle = Math.floor((start + end) / 2);
    order.push(middle);
    queue.push([start, middle - 1], [middle + 1, end]);
  }
  return order.map(index => sorted[index]);
}

function relatedQuotes(quotes: Row[]) {
  // Bounded lexical retrieval across books; the model still judges the relationship.
  const postings = new Map<string, number[]>(), pairs: { score: number; left: number; right: number }[] = [];
  for (const [index, quote] of quotes.entries()) {
    const words: string[] = String(quote.text).toLowerCase().match(/[a-z]{3,}|[\u3400-\u9fff]{2,}/g) || [];
    const tokens = [...new Set(words.flatMap((word: string) => /^[a-z]/.test(word) ? [word] : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))))].slice(0, 64);
    const scores = new Map<number, number>();
    for (const token of tokens) for (const other of postings.get(token) || []) if (quotes[other].bookId !== quote.bookId) scores.set(other, (scores.get(other) || 0) + 1);
    const best = [...scores].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) pairs.push({ score: best[1], left: best[0], right: index });
    for (const token of tokens) {
      const bucket = postings.get(token) || [];
      if (bucket.length >= 24) bucket.shift();
      bucket.push(index); postings.set(token, bucket);
    }
  }
  const result: Row[] = [], used = new Set<number>();
  for (const pair of pairs.sort((a, b) => b.score - a.score)) {
    if (used.has(pair.left) || used.has(pair.right)) continue;
    used.add(pair.left); used.add(pair.right);
    result.push(quotes[pair.left], quotes[pair.right]);
    if (result.length >= 80) break;
  }
  return result;
}

export function highlightPlan(report: Report, kind: InsightKind, mode: HighlightMode = 'selected') {
  const raw = report.readerPortrait.allHighlights || [], seen = new Set<string>();
  const quotes: Row[] = [];
  for (const [index, quote] of raw.entries()) {
    if (typeof quote.text !== 'string' || !quote.text.trim()) continue;
    const text = quote.text.trim(), bookId = String(quote.bookId || quote.bookTitle || 'unknown');
    const key = `${bookId}\u0000${text.replace(/\s+/g, ' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push({ id: String(quote.id || `legacy:${index}`), bookId, bookTitle: String(quote.bookTitle || '未知书籍').slice(0, 120), text: text.slice(0, mode === 'selected' ? 600 : 1200), date: quote.createdAt, chapterUid: quote.chapterUid == null ? undefined : String(quote.chapterUid).slice(0, 80) });
  }
  const groups = new Map<string, Row[]>();
  for (const quote of quotes) { if (!groups.has(quote.bookId)) groups.set(quote.bookId, []); groups.get(quote.bookId)!.push(quote); }
  const balanced = interleave([...groups.values()].map(spread));
  const candidates = mode === 'selected' && kind === 'collision' ? interleave([relatedQuotes(quotes), balanced.slice(0, 80), balanced.slice(80)]) : balanced;
  const ordered = [...new Map(candidates.map(quote => [quote.id, quote])).values()];
  const batches: Row[][] = [], sizes: number[] = [];
  for (const quote of ordered) {
    const size = JSON.stringify(quote).length + 1;
    let batch = batches.length - 1;
    if (batch < 0 || batches[batch].length >= 40 || sizes[batch] + size > HIGHLIGHT_BATCH_CHARS) {
      if (mode === 'selected' && batches.length >= 4) continue;
      batch = batches.length; batches.push([]); sizes.push(2);
    }
    batches[batch].push(quote); sizes[batch] += size;
  }
  const selected = batches.flat();
  return { mode, available: raw.length, unique: quotes.length, selected: selected.length, books: new Set(selected.map(quote => quote.bookId)).size, totalBooks: groups.size, batches, requests: batches.length + (kind === 'cognition' && batches.length > 1 ? 1 : 0), sampled: selected.length < quotes.length, excerptChars: mode === 'selected' ? 600 : 1200 };
}
