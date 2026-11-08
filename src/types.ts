export type Row = Record<string, any>;
export const FEATURED_HIGHLIGHT_LIMIT = 10;
export interface ShelfBook extends Row {
  bookId?: string;
  progressFetchState?: 'fetched' | 'failed';
  progress?: number;
  /** Account lifetime reading seconds from shelf.bookProgress[].readingTime. */
  readingTime?: number;
  lastReadAt?: number;
  recordReadingTime?: number;
  finishTime?: number;
  chapterUid?: number;
  chapterTitle?: string;
}
export interface ReadingBook { bookId: string; title: string; seconds?: number; category?: string; periodNote?: string; }

export interface Personality {
  year: string;
  title: string;
  annualQuestion: string;
  description: string;
  visualArchetype?: string;
  artPersona?: string;
  personaReason?: string;
  evidence?: string[];
}

export interface Analysis {
  demo?: boolean;
  prompt?: string;
  summary: string;
  yearlyPersonality: Personality[];
  thoughtClusters: { keyword: string; books: string[]; thoughtQuote: string }[];
  model: string;
  generatedAt: string;
}

export type InsightKind = 'recommendations' | 'cognition' | 'collision';
export interface InsightResult {
  demo?: boolean;
  prompt?: string;
  kind: InsightKind;
  model: string;
  generatedAt: string;
  coverage: { available: number; processed: number; batches: number; incomplete: boolean; mode?: 'selected' | 'all'; unique?: number; sampled?: boolean; books?: number; totalBooks?: number; excerptChars?: number };
  sections: { title: string; items: { heading: string; explanation: string; collisionType?: '锋芒交锋' | '暗夜回响' | '一体两面'; dialogue?: string; reconciliation?: string; blindSpot?: string; readingAnchor?: string; quoteIds?: string[]; bookId?: string; bookTitle?: string; status?: string }[] }[];
}

export interface Report {
  meta: { start: string; end: string; range: string; generatedAt: string; sampleReport?: boolean; dataCaveat: string; skillVersion?: string; timezone?: string; schemaVersion?: number };
  kpis: Row;
  series: {
    months: string[];
    monthlyReadHours: number[];
    monthlyReadDays: number[];
    monthlyReadStat: Row[];
    dailyHeat: [string, number][];
    weekdayHeat: number[][];
    weekdayNames: string[];
    cumulativeReadHours: [string, number][];
    annualRows: Row[];
    hourly?: number[];
    hourlySource?: 'annual' | 'monthly' | 'overall' | 'unavailable';
    hourlyNote?: string;
    monthlyBooks?: Record<string, ReadingBook[]>;
    dailyBooks?: Record<string, ReadingBook[]>;
    monthlyNoteBooks?: Record<string, ReadingBook[]>;
    dailyNoteBooks?: Record<string, ReadingBook[]>;
    monthlyRecentBooks?: Record<string, ReadingBook[]>;
    dailyRecentBooks?: Record<string, ReadingBook[]>;
  };
  reading: { topBooks: Row[]; categories: Row[]; authors: Row[]; publishers: Row[]; readListen: Row[]; authorsSource: string };
  shelf: { composition: Row[]; categories: Row[]; finished: Row[]; privacy: Row[]; archives: Row[]; books?: ShelfBook[] };
  notes: { topBooks: Row[]; typeTotals: Row[]; progressScatter: any[][]; wordCloud: Row[]; timeline: Row[]; highlightLength: Row[]; categories?: Row[] };
  readerPortrait: { summary?: string; poeticSummary?: string; goldenQuote: Row | string; quotes: Row[]; allHighlights?: Row[] };
  evolution?: { year: string; hours: number; categories: Row[]; books: string[]; highlights: string[] }[];
  coverage: Row;
  warnings?: string[];
  analysis?: Analysis;
  insights?: Partial<Record<InsightKind, InsightResult>>;
}

export type Page = 'overview' | 'personality' | 'insights' | 'trends' | 'evolution' | 'preferences' | 'shelf' | 'notes' | 'settings';
export interface AIConfig { apiKey: string; endpoint: string; model: string; protocol: 'chat' | 'responses' | 'anthropic' }
