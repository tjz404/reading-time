import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, BrainCircuit, Check, Fingerprint, GitCompareArrows, LoaderCircle, RotateCcw, Sparkles, SquarePen, X } from 'lucide-react';
import { analyzeReport, jsonRequest, post } from './api';
import { defaultPrompts, PROMPT_LIMIT, type InterpretationKind } from './aiPrompts';
import { Personality } from './ReportViews';
import type { AIConfig, Analysis, InsightKind, InsightResult, Report, Row } from './types';
import { highlightPlan, type HighlightMode } from './highlightPlan';
import { estimateHighlightTokens } from './tokenEstimate';
import { InfoTip } from './InfoTip';

const modes: { kind: InterpretationKind; title: string; description: string; icon: typeof BookOpen }[] = [
  { kind: 'personality', title: 'MBTI 阅读性格', description: '从书目与年度主题，看见阅读中的自己', icon: Fingerprint },
  { kind: 'recommendations', title: '阅读推荐', description: '书架未读、正在读，以及书架外的下一本', icon: BookOpen },
  { kind: 'cognition', title: '个人认知图谱与暗线报告', description: '核心张力、防御武器与智识趣味', icon: BrainCircuit },
  { kind: 'collision', title: '跨书籍的想法大碰撞', description: '让不同书中相似或对立的观点彼此对话', icon: GitCompareArrows }
];

export function InsightPage({ report, config, configured, configure, selected, onSelect, onAnalysis, onResult }: {
  report: Report; config: AIConfig; configured: boolean; configure: () => void;
  selected: InterpretationKind; onSelect: (kind: InterpretationKind) => void;
  onAnalysis: (analysis: Analysis) => void; onResult: (kind: InsightKind, result: InsightResult) => void;
}) {
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Partial<Record<InterpretationKind, string>>>({});
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('selected');
  const [progress, setProgress] = useState({ completed: 0, total: 1, message: '' });
  const job = useRef<string | null>(null), alive = useRef(true), run = useRef(0), request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; run.current++; request.current?.abort(); if (job.current) void fetch(`/api/insights/${job.current}`, { method: 'DELETE', keepalive: true }); job.current = null; request.current = null; };
  }, []);
  const result = selected === 'personality' ? report.analysis : report.insights?.[selected];
  const insight = selected !== 'personality' ? report.insights?.[selected] : undefined;
  const full = report.readerPortrait.allHighlights;
  const plan = useMemo(() => selected === 'cognition' || selected === 'collision' ? highlightPlan(report, selected, highlightMode) : null, [report.readerPortrait, selected, highlightMode]);
  const noData = selected === 'personality' ? false : selected === 'recommendations' ? !report.shelf.books?.length : !full?.length;
  const prompt = drafts[selected] ?? result?.prompt ?? defaultPrompts[selected];
  const tokens = useMemo(() => plan && (selected === 'cognition' || selected === 'collision') ? estimateHighlightTokens(plan, selected, prompt) : null, [plan, selected, prompt]);
  const canGenerate = configured && consent && !busy && !noData && Boolean(prompt.trim()) && prompt.length <= PROMPT_LIMIT;
  const quoteLookup = new Map((full || []).map((q, i) => [String(q.id || `legacy:${i}`), q]));
  const disclosure = selected === 'personality'
    ? '汇总统计、最多 30 本区间阅读排行书籍、年度分类与代表书目、最多 10 条含书名与日期的代表划线（每条至多 1200 字，优先覆盖各年）、高频关键词，以及当前书架已读／在读／未读数量与已读比例。当前书架状态不作为年度完读率。'
    : selected === 'recommendations'
      ? `从 ${report.shelf.books?.length || 0} 本书架书籍中筛选未读与在读候选，按批发送书名、作者、分类、状态、现有进度、当前章节名与最后阅读日期；每批另发送阅读分类、最多 12 本区间排行（含作者与时长）、最多各 12 本在读与已读书架样本。不发送章节正文；书架外书目没有联网验证。`
      : `本地扫描 ${plan?.available || 0} 条划线，去重后 ${plan?.unique || 0} 条；本次发送 ${plan?.selected || 0} 条，来自 ${plan?.books || 0} / ${plan?.totalBooks || 0} 本书。每条至多前 ${plan?.excerptChars || 600} 字，附书名、书籍 ID、现有日期与章节标识。${highlightMode === 'selected' ? '按书籍与时间选取代表材料；跨书碰撞另参考词语关联候选。精选不等于模型通读全部划线。' : '发送去重后的全部有效划线，时间和费用随材料量增加。'}${selected === 'cognition' ? '多批候选再汇总为至多 4 个切片。' : '模型判断候选间的呼应与对立，不保证找到所有关联。'}划线不代表你赞同原文观点。`;

  async function generate() {
    if (!canGenerate) return;
    const current = ++run.current, controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setProgress({ completed: 0, total: 1, message: '正在解读阅读材料' });
    let id: string | null = null;
    try {
      if (selected === 'personality') {
        const analysis = await analyzeReport(report, config, controller.signal, prompt);
        if (alive.current && current === run.current) onAnalysis(analysis);
        return;
      }
      const created = await post<{ id: string }>('/api/insights', { report, config, kind: selected, prompt, mode: highlightMode }, controller.signal);
      id = created.id;
      if (!alive.current || current !== run.current) return;
      job.current = id;
      while (alive.current && current === run.current) {
        const state = await jsonRequest<{ state: 'running' | 'done' | 'error'; message: string; completed: number; total: number; result?: InsightResult }>(`/api/insights/${id}`, { signal: controller.signal });
        if (!alive.current || current !== run.current) return;
        setProgress(state);
        if (state.state === 'error') throw new Error(state.message);
        if (state.state === 'done') { if (!state.result) throw new Error('解读完成但未收到结果，请重试。'); onResult(selected, state.result); break; }
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } catch (e) { if (alive.current && current === run.current && !(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : '生成失败，请重试。'); }
    finally { if (id) void fetch(`/api/insights/${id}`, { method: 'DELETE' }); if (current === run.current) { job.current = null; request.current = null; if (alive.current) setBusy(false); } }
  }
  function cancel() { run.current++; request.current?.abort(); request.current = null; if (job.current) { void fetch(`/api/insights/${job.current}`, { method: 'DELETE' }); job.current = null; } setBusy(false); setProgress({ completed: 0, total: 1, message: '' }); }

  return <div className="insight-page">
    <div className="section-lead"><h2>这次，想从哪个角度读懂自己？</h2></div>
    <div className="insight-picker" role="group" aria-label="AI 解读类型">{modes.map(({ kind, title, description, icon: Icon }) => <button key={kind} disabled={busy} className={selected === kind ? 'selected' : ''} aria-pressed={selected === kind} onClick={() => { onSelect(kind); setConsent(false); setError(''); }}><Icon size={20} /><strong>{title}</strong><span>{description}</span></button>)}</div>
    <section className="insight-workspace" aria-labelledby="insight-selected-title">
      <div className="insight-topline"><h2 id="insight-selected-title">{modes.find(m => m.kind === selected)?.title}</h2>{result && <span className="source-label"><Check size={15} />{result.demo ? '预置演示 · 未调用模型' : `${result.model} · 已生成`}</span>}</div>
      {plan && !noData && <div className="highlight-scope"><div className="segments" role="group" aria-label="划线分析范围"><button className={highlightMode === 'selected' ? 'selected' : ''} aria-pressed={highlightMode === 'selected'} disabled={busy} onClick={() => { setHighlightMode('selected'); setConsent(false); }}>精选解读</button><button className={highlightMode === 'all' ? 'selected' : ''} aria-pressed={highlightMode === 'all'} disabled={busy} onClick={() => { setHighlightMode('all'); setConsent(false); }}>全部划线</button></div><div className="highlight-estimate"><p>本次选取 {plan.selected} / {plan.unique} 条去重划线 · 最多 {plan.requests} 次模型请求{tokens && <> · 输入约 {tokens.inputLow.toLocaleString('zh-CN')}–{tokens.inputHigh.toLocaleString('zh-CN')} tokens</>}</p><InfoTip label="查看材料范围与 token 估算说明" text={`${disclosure}\n\n${configured ? `生成后发送至 ${config.endpoint}，包含本项提示词。` : '配置模型后，材料会发送至所选模型服务。'}\n\nToken 为按中英文字符比例估算的输入范围，包含逐批重复的系统提示词、当前提示词、书籍信息和原文；认知多批时另预留汇总候选与证据。${tokens ? `输出配置上限合计 ${tokens.outputLimit.toLocaleString('zh-CN')} tokens，不包含在输入估算内。` : ''}实际用量取决于模型分词、输出长度和可能的推理 token，以模型服务账单为准。`} /></div></div>}
      {noData && <p className="insight-empty">{selected === 'recommendations' ? '当前报告没有逐本书架及阅读状态，请连接微信读书生成新报告。' : '当前报告没有完整划线，请重新连接微信读书并生成新报告。'}</p>}
      {!configured && <div className="insight-config"><p>配置模型后即可生成本项解读。模型密钥只保留在页面内存中，刷新后清除。</p><button className="ghost" onClick={configure}>配置模型 <ArrowRight size={16} /></button></div>}
      {!noData && configured && <>
        {!plan && <div className="data-disclosure"><h3>本项解读发送的材料</h3><p>{disclosure}</p><small>主动生成后发送至 {config.endpoint}，同时发送本项提示词。{selected !== 'personality' && '按批请求，时间和费用随材料量增加。'}</small></div>}
        <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />我同意将本项材料发送给所选模型服务</label>
        <div className="settings-submit"><button className="primary" disabled={!canGenerate} onClick={generate}>{busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{busy ? '正在生成…' : result ? '重新生成本项解读' : '生成本项解读'}</button>{busy && <button className="ghost" onClick={cancel}><X size={16} />取消</button>}</div>
        {busy && <div className="insight-progress" role="status" aria-live="polite"><span>{progress.message}</span>{selected !== 'personality' && <progress value={progress.completed} max={progress.total} />}</div>}
      </>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {selected === 'personality' && report.analysis && <div className="insight-personality"><Personality report={report} configure={configure} /></div>}
      {insight && <>
        <p className="data-coverage">{insight.demo ? '本结果为预置演示，未发送材料或调用模型；引用句子均为演示编写，非原书摘录。' : <>{selected === 'recommendations' ? `核对了 ${insight.coverage.processed} / ${insight.coverage.available} 本书架书籍` : `模型分析 ${insight.coverage.processed} / ${insight.coverage.unique ?? insight.coverage.available} 条${insight.coverage.unique === undefined ? '' : '去重'}划线${insight.coverage.mode ? ` · ${insight.coverage.mode === 'selected' ? '精选解读' : '全部划线'}` : ''}`} · {insight.coverage.batches} 次模型请求。{insight.coverage.sampled ? '结果基于选取材料，模型未通读全部划线。' : ''}{insight.coverage.incomplete ? '部分材料读取失败，无法完整覆盖。' : '模型结果不保证穷尽所有候选。'}</>}</p>
        {insight.sections.map(section => <section className="insight-results" key={section.title}>
          <h3>{section.title}</h3>
          {section.items.length ? <div className="insight-list">{section.items.map((item, index) => <article key={`${item.bookId || item.bookTitle || item.heading}-${index}`}>
            <div className="insight-item-heading"><h4>{item.heading}</h4>{item.collisionType && <span className="collision-type">{item.collisionType}</span>}{item.status && <span>{item.status}</span>}</div>
            {item.bookTitle && <strong>《{item.bookTitle}》</strong>}
            <div className="insight-prose">
              {selected === 'cognition' && item.blindSpot && <h5 className="insight-part-title">深度画像</h5>}
              {selected === 'collision' && item.dialogue && <h5 className="insight-part-title">剧场导言 · 你的思想轨迹</h5>}
              <p>{item.explanation}</p>
              {item.blindSpot && <div className="insight-prose-section"><h5 className="insight-part-title">暗线盲区</h5><p>{item.blindSpot}</p></div>}
              {item.dialogue && <div className="insight-prose-section"><h5 className="insight-part-title">跨时空交锋 · 拟想对话</h5><p>{item.dialogue}</p></div>}
              {item.reconciliation && <div className="insight-prose-section"><h5 className="insight-part-title">破局调和</h5><p>{item.reconciliation}</p></div>}
              {item.readingAnchor && <p className="reading-anchor"><span>阅读锚点</span>{item.readingAnchor}</p>}
              {selected === 'cognition' && item.quoteIds?.length ? <h5 className="insight-part-title">证据原句</h5> : null}
              {selected === 'collision' && item.quoteIds?.length ? <h5 className="insight-part-title">碰撞原句</h5> : null}
              {item.quoteIds?.map(id => { const q: Row | undefined = quoteLookup.get(id); return q && <blockquote key={id}>“{q.text}”<cite>《{q.bookTitle}》{q.createdAt ? ` · ${q.createdAt}` : ' · 日期未提供'}</cite></blockquote>; })}
            </div>
          </article>)}</div> : <p className="insight-empty">当前材料没有足够可信的候选项。</p>}
        </section>)}
      </>}
      {(result || error) && <details className="prompt-retry" key={selected}>
        <summary><SquarePen size={17} />不满意？编辑提示词重试</summary>
        <div className="prompt-editor">
          <label htmlFor="insight-prompt">{modes.find(m => m.kind === selected)?.title} · 提示词</label>
          <textarea id="insight-prompt" rows={7} maxLength={PROMPT_LIMIT} value={prompt} disabled={busy} onChange={e => setDrafts(previous => ({ ...previous, [selected]: e.target.value }))} />
          <div className="prompt-editor-meta"><span>{prompt.length} / {PROMPT_LIMIT}</span><button className="text-action" disabled={busy} onClick={() => setDrafts(previous => ({ ...previous, [selected]: defaultPrompts[selected] }))}><RotateCcw size={14} />恢复默认提示词</button></div>
          <div className="settings-submit"><button className="primary" disabled={!canGenerate} onClick={generate}>{busy ? <LoaderCircle size={16} className="spin" /> : <RotateCcw size={16} />}使用修改后的提示词重试</button></div>
          {!consent && configured && <p className="muted">请先勾选本项材料发送确认。</p>}
          {!prompt.trim() && <p className="error-message">请填写提示词。</p>}
          <p className="muted">重新生成成功后替换当前结果；取消或失败时保留原结果。</p>
        </div>
      </details>}
    </section>
  </div>;
}
