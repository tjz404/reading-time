import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { collectReport } from './lib/gateway';
import { analyze } from './lib/ai';
import { analyzeInsight } from './lib/insights';
import type { InsightKind, InsightResult, Report } from './src/types';
import { resolvePrompt } from './src/aiPrompts';
import { createSampleReport } from './lib/sample';

const root = process.env.NODE_ENV === 'production' || import.meta.url.endsWith('/dist/server.js') ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') : path.dirname(fileURLToPath(import.meta.url));
const production = root !== path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '24mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) { res.status(403).json({ error: '请从本站发起请求。' }); return; } } catch { res.status(403).json({ error: '无效请求来源。' }); return; }
  }
  next();
});

interface Job { state: 'running' | 'done' | 'error' | 'cancelled'; message: string; completed: number; total: number; report?: Report; controller: AbortController; updated: number }
const jobs = new Map<string, Job>();
interface InsightJob { state: 'running' | 'done' | 'error'; message: string; completed: number; total: number; result?: InsightResult; controller: AbortController; updated: number }
const insightJobs = new Map<string, InsightJob>();
setInterval(() => { for (const [id, job] of jobs) if (Date.now() - job.updated > 30 * 60_000) { job.controller.abort(); jobs.delete(id); } }, 60_000).unref();
setInterval(() => { for (const [id, job] of insightJobs) if (Date.now() - job.updated > 30 * 60_000) { job.controller.abort(); insightJobs.delete(id); } }, 60_000).unref();

app.post('/api/reports', (req, res) => {
  const { apiKey, months = 24 } = req.body || {};
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || ![12, 24, 36].includes(months)) { res.status(400).json({ error: '请填写有效的微信读书 API Key，并选择分析范围。' }); return; }
  if ([...jobs.values()].filter(j => j.state === 'running').length >= 4) { res.status(429).json({ error: '正在分析的任务较多，请稍后重试。' }); return; }
  const id = randomUUID(), controller = new AbortController();
  const job: Job = { state: 'running', message: '正在连接微信读书', completed: 0, total: 1, controller, updated: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ id });
  void collectReport(apiKey.trim(), months, (message, completed, total) => { Object.assign(job, { message, completed, total, updated: Date.now() }); }, controller.signal)
    .then(report => { if (!controller.signal.aborted) Object.assign(job, { state: 'done', report, message: '分析完成', updated: Date.now() }); })
    .catch(error => { if (!controller.signal.aborted) Object.assign(job, { state: 'error', message: error.name === 'TimeoutError' ? '微信读书请求超时，请重试。' : error.message || '分析失败，请重试。', updated: Date.now() }); });
});

app.get('/api/reports/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: '分析任务已过期，请重新开始。' }); return; }
  job.updated = Date.now();
  res.json({ state: job.state, message: job.message, completed: job.completed, total: job.total, ...(job.state === 'done' ? { report: job.report } : {}) });
});
app.delete('/api/reports/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) { job.controller.abort(); jobs.delete(req.params.id); }
  res.status(204).end();
});
app.post('/api/analyze', async (req, res) => {
  const { report, config, prompt } = req.body || {};
  if (!report?.meta || !Array.isArray(report?.reading?.topBooks) || !Array.isArray(report?.readerPortrait?.quotes) || !Array.isArray(report?.series?.annualRows) || !config) { res.status(400).json({ error: '请先生成阅读报告，再配置模型。' }); return; }
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try { res.json(await analyze(report, config, controller.signal, resolvePrompt('personality', prompt))); }
  catch (error) { if (!res.headersSent && !controller.signal.aborted) res.status(502).json({ error: error instanceof Error && error.name === 'TimeoutError' ? '模型请求超时，请重试或更换模型。' : error instanceof Error ? error.message : '模型分析失败。' }); }
});
app.post('/api/insights', (req, res) => {
  const { report, config, kind, prompt, mode = 'selected' } = req.body || {};
  if (!['selected', 'all'].includes(mode)) { res.status(400).json({ error: '请选择精选解读或全部划线。' }); return; }
  if (!['recommendations', 'cognition', 'collision'].includes(kind) || !report?.meta || !Array.isArray(report?.readerPortrait?.quotes) || !Array.isArray(report?.reading?.topBooks) || !config || typeof config.apiKey !== 'string') { res.status(400).json({ error: '请先准备阅读报告和模型配置。' }); return; }
  if (kind !== 'recommendations' && !Array.isArray(report.readerPortrait.allHighlights)) { res.status(400).json({ error: '旧报告缺少完整划线，请重新连接微信读书。' }); return; }
  let resolved: string;
  try { resolved = resolvePrompt(kind, prompt); } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if ([...insightJobs.values()].filter(j => j.state === 'running').length >= 2) { res.status(429).json({ error: '深度解读任务较多，请稍后再试。' }); return; }
  const id = randomUUID(), controller = new AbortController();
  const job: InsightJob = { state: 'running', message: '正在准备阅读证据', completed: 0, total: 1, controller, updated: Date.now() };
  insightJobs.set(id, job);
  res.status(202).json({ id });
  void analyzeInsight(report, config, kind as InsightKind, (completed, total) => Object.assign(job, { completed, total, message: `已完成 ${completed} / ${total} 次模型请求`, updated: Date.now() }), controller.signal, resolved, mode)
    .then(result => { if (!controller.signal.aborted) Object.assign(job, { state: 'done', result, message: '解读完成', updated: Date.now() }); })
    .catch(error => { if (!controller.signal.aborted) Object.assign(job, { state: 'error', message: error instanceof Error ? error.message : '深度解读失败，请重试。', updated: Date.now() }); });
});
app.get('/api/insights/:id', (req, res) => {
  const job = insightJobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: '解读任务已过期，请重新生成。' }); return; }
  job.updated = Date.now();
  res.json({ state: job.state, message: job.message, completed: job.completed, total: job.total, ...(job.state === 'done' ? { result: job.result } : {}) });
});
app.delete('/api/insights/:id', (req, res) => {
  const job = insightJobs.get(req.params.id);
  if (job) { job.controller.abort(); insightJobs.delete(req.params.id); }
  res.status(204).end();
});
app.get('/api/sample', (_req, res) => {
  try {
    res.json(createSampleReport());
  } catch { res.status(500).json({ error: '示例数据暂时无法读取。' }); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));

if (production) {
  app.use(express.static(path.join(root, 'dist/client')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/client/index.html')));
} else {
  const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { port: Number(process.env.PORT || 3100) + 1 } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: error instanceof SyntaxError ? '请求数据格式无效。' : '请求无法处理，请重试。' }));
const port = Number(process.env.PORT || 3100);
app.listen(port, '127.0.0.1', () => console.log(`Reading Time: http://localhost:${port}`));
