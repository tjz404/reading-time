import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { FEATURED_HIGHLIGHT_LIMIT, type AIConfig, type Analysis, type Report, type Row } from '../src/types';
import { resolvePrompt, withPrompt } from '../src/aiPrompts';
import { readingStatus } from '../src/readingDetails';

export function endpointFor(config: AIConfig) {
  const url = new URL(config.endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('模型地址必须是有效的 HTTPS 地址，不能包含账号、查询参数或片段。');
  const suffix = config.protocol === 'responses' ? '/responses' : config.protocol === 'anthropic' ? '/messages' : '/chat/completions';
  const p = url.pathname.replace(/\/+$/, '');
  if (!/\/(chat\/completions|responses|messages)$/.test(p)) url.pathname = `${p || '/v1'}${suffix}`;
  return url;
}

export function publicAddress(address: string) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a >= 224 || a === 198 && (b === 18 || b === 19));
  }
  // Only public global-unicast IPv6 addresses; mapped IPv4 uses the IPv4 rules.
  if (value.startsWith('::ffff:')) return publicAddress(value.slice(7));
  return isIP(value) === 6 && /^[23]/.test(value);
}

export async function validateEndpoint(url: URL, resolve: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>> = (hostname, options) => lookup(hostname, options)) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname, { all: true });
  const deepSeekProxy = hostname.toLowerCase() === 'api.deepseek.com';
  const proxyAddress = (address: string) => isIP(address) === 4 && address.startsWith('198.') && Number(address.split('.')[1]) >= 18 && Number(address.split('.')[1]) <= 19;
  if (!records.length || records.some(r => !publicAddress(r.address) && !(deepSeekProxy && proxyAddress(r.address)))) throw new Error('模型地址必须指向公网服务。');
}

export function aiEvidence(report: Report) {
  const years = report.evolution || report.series.annualRows.map(r => ({ year: r.year, hours: r.hours, categories: [], books: [], highlights: [] }));
  const source = report.readerPortrait.allHighlights?.length ? report.readerPortrait.allHighlights : report.readerPortrait.quotes;
  const highlights: Row[] = [];
  const add = (quote: Row) => {
    if (typeof quote.text !== 'string' || !quote.text.trim() || highlights.length >= FEATURED_HIGHLIGHT_LIMIT || highlights.some(q => q.text === quote.text && q.book === quote.bookTitle && q.date === quote.createdAt)) return;
    highlights.push({ text: quote.text.slice(0, 1200), book: quote.bookTitle, date: quote.createdAt });
  };
  // Reserve evidence for each year before filling remaining slots with featured excerpts.
  for (let slot = 0; slot < 4; slot++) for (const year of years) {
    const quotes = source.filter(q => String(q.createdAt || '').startsWith(`${year.year}-`));
    const books = new Map<string, Row[]>();
    for (const q of quotes) { const key = String(q.bookId || q.bookTitle || ''); if (!books.has(key)) books.set(key, []); books.get(key)!.push(q); }
    const diverse = [...books.values()].flatMap(group => group.slice(0, 1)).concat([...books.values()].flatMap(group => group.slice(1)));
    if (diverse[slot]) add(diverse[slot]);
  }
  for (const q of [...report.readerPortrait.quotes, ...source]) add(q);
  const counts = { 读完: 0, 在读: 0, 未读: 0 };
  for (const book of report.shelf.books || []) {
    const status: unknown = book.readingStatus;
    counts[status === '读完' || status === '在读' || status === '未读' ? status : readingStatus(book)]++;
  }
  return {
    range: report.meta.range, kpis: report.kpis,
    categories: report.reading.categories.slice(0, 12), books: report.reading.topBooks.slice(0, 30).map(({ title, author, hours }) => ({ title, author, hours })),
    years: years.map(year => ({ ...year, highlights: highlights.filter(q => String(q.date || '').startsWith(`${year.year}-`)).slice(0, 4) })),
    highlights,
    currentShelf: { scope: '当前书架状态，非年度完读率', available: Boolean(report.shelf.books), counts, finishedShare: report.shelf.books?.length ? counts.读完 / report.shelf.books.length : null },
    keywords: report.notes.wordCloud.filter(row => typeof row.name === 'string' && !/[A-Za-z]/.test(row.name)).slice(0, 20)
  };
}

const SYSTEM = `只根据输入数据生成年度阅读人格肖像，不得虚构书籍、划线、年份或统计。MBTI 是年度阅读气质的文学诠释。只输出严格JSON：{"summary":"150字以内整体解读","yearlyPersonality":[{"year":"输入中的年份","title":"16型之一的四字母MBTI","annualQuestion":"12至20字年度核心金句","description":"120至160字深度肖像，直接切入精神面貌，以真实书目和可用划线细节展开","visualArchetype":"4至6字文学称号","artPersona":"精神共鸣作家或思想家，可为空","personaReason":"25字以内类比理由，可为空","evidence":["2至4条：维度＋真实数据或细节＋洞察"]}],"thoughtClusters":[{"keyword":"4至10字思想主题","books":["真实书名"],"thoughtQuote":"分析概括，不假装原文"}]}。按输入years逐年生成。不得把区间或其他年份材料当该年证据。缺少划线时从实际书目或主题展开，不编造引语或把读者内心动机当事实。currentShelf仅描述当前账户，不能推算某年完读率；不推算未提供的逐书阅读起止时间。正文不添加模板化免责声明，不输出未定型。最多6个主题。`;

function textFrom(payload: Row) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.choices?.[0]?.message?.content === 'string') return payload.choices[0].message.content;
  if (Array.isArray(payload.content)) return payload.content.filter((r: Row) => r.type === 'text').map((r: Row) => r.text).join('\n');
  return (payload.output || []).flatMap((r: Row) => (r.content || []).map((c: Row) => c.text || '')).join('\n');
}

export function validateAnalysis(value: Row, report: Report): Omit<Analysis, 'model' | 'generatedAt'> {
  const years = (report.evolution || report.series.annualRows).map(r => String(r.year));
  if (typeof value.summary !== 'string' || !value.summary.trim() || !Array.isArray(value.yearlyPersonality) || !Array.isArray(value.thoughtClusters)) throw new Error('模型返回内容不完整，请重试或更换模型。');
  const yearlyPersonality = years.map(year => {
    const row = value.yearlyPersonality.find((r: Row) => String(r.year) === year);
    if (!row || !/^[EI][NS][TF][JP]$/.test(row.title) || typeof row.description !== 'string' || typeof row.annualQuestion !== 'string') throw new Error(`模型没有返回有效的 ${year} 年阅读人格，请重试。`);
    return { year, title: row.title, annualQuestion: row.annualQuestion.slice(0, 120), description: row.description.slice(0, 3000), visualArchetype: typeof row.visualArchetype === 'string' ? row.visualArchetype.slice(0, 80) : '', artPersona: typeof row.artPersona === 'string' ? row.artPersona.slice(0, 80) : '', personaReason: typeof row.personaReason === 'string' ? row.personaReason.slice(0, 1000) : '', evidence: Array.isArray(row.evidence) ? row.evidence.filter((e: unknown) => typeof e === 'string').slice(0, 4) : [] };
  });
  const titles = new Set([...report.reading.topBooks.map(b => b.title), ...(report.evolution || []).flatMap(y => y.books)]);
  const thoughtClusters = value.thoughtClusters.slice(0, 6).filter((c: Row) => typeof c.keyword === 'string' && typeof c.thoughtQuote === 'string' && Array.isArray(c.books)).map((c: Row) => ({ keyword: c.keyword.slice(0, 80), books: c.books.filter((b: unknown) => typeof b === 'string' && titles.has(b)).slice(0, 3), thoughtQuote: c.thoughtQuote.slice(0, 1000) }));
  return { summary: value.summary.slice(0, 4000), yearlyPersonality, thoughtClusters };
}

export async function callModel(config: AIConfig, system: string, content: string, signal?: AbortSignal, maxTokens = 6000): Promise<Row> {
  if (!config.apiKey?.trim() || !config.model?.trim() || !['chat', 'responses', 'anthropic'].includes(config.protocol)) throw new Error('请填写模型 Key、模型名称和接口类型。');
  const url = endpointFor(config);
  await validateEndpoint(url);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Row;
  if (config.protocol === 'anthropic') {
    headers['x-api-key'] = config.apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = config.protocol === 'responses' ? { model: config.model, instructions: system, input: content, max_output_tokens: maxTokens } : { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], max_tokens: maxTokens };
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]) });
  const payload = await response.json().catch(() => { throw new Error('模型服务返回了非 JSON 响应，请检查接口地址。'); });
  if (!response.ok) throw new Error(`模型请求失败（${response.status}）。请检查 Key、模型权限和余额。`);
  const text = textFrom(payload).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: Row;
  try { parsed = JSON.parse(text); } catch { throw new Error('模型没有返回可解析的分析结果，请重试。'); }
  return parsed;
}

export async function analyze(report: Report, config: AIConfig, signal?: AbortSignal, customPrompt?: string): Promise<Analysis> {
  const prompt = resolvePrompt('personality', customPrompt);
  const evidence = aiEvidence(report);
  const emptyYear = evidence.years.find(year => !(Number(year.hours) > 0) && !year.books?.length && !year.highlights.length && !year.categories?.length);
  if (emptyYear) throw new Error(`${emptyYear.year} 年没有可用的年度阅读线索，请更新阅读数据后重试。`);
  const parsed = await callModel(config, withPrompt(SYSTEM, prompt), JSON.stringify(evidence), signal);
  return { ...validateAnalysis(parsed, report), prompt, model: config.model, generatedAt: new Date().toISOString() };
}
