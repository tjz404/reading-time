import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Download, Eye, EyeOff, Fingerprint, LayoutDashboard, LibraryBig, LoaderCircle, Menu, Moon, NotebookPen, RefreshCw, Settings2, ShieldCheck, Sparkles, Sun, TrendingUp, Waypoints, X } from 'lucide-react';
import type { AIConfig, Page, Report } from './types';
import { downloadReport, jsonRequest, normalizeSample, post } from './api';
import type { InterpretationKind } from './aiPrompts';
import { Evolution, Notes, Overview, Personality, Preferences, Shelf, Trends } from './ReportViews';
import { InsightPage } from './InsightPage';
import { ModelConfigFields } from './ModelConfigFields';
import { demoMode, demoReport } from './demo';

const nav = [
  { id: 'overview', label: '阅读总览', en: 'Overview', icon: LayoutDashboard },
  { id: 'personality', label: '阅读性格', en: 'Personality', icon: Fingerprint },
  { id: 'insights', label: 'AI 解读', en: 'Reading insights', icon: Sparkles },
  { id: 'trends', label: '阅读趋势', en: 'Reading trends', icon: TrendingUp },
  { id: 'evolution', label: '阅读演化', en: 'Evolution', icon: Waypoints },
  { id: 'preferences', label: '阅读偏好', en: 'Preferences', icon: BookOpen },
  { id: 'shelf', label: '我的书架', en: 'Bookshelf', icon: LibraryBig },
  { id: 'notes', label: '笔记与划线', en: 'Notes & highlights', icon: NotebookPen }
] as const;

function storedKey() { try { return sessionStorage.getItem('reading-time-key') || ''; } catch { return ''; } }
type Theme = 'dark' | 'light';
function storedTheme(): Theme { try { return localStorage.getItem('reading-time-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
const initialTheme = storedTheme();
document.documentElement.dataset.theme = initialTheme;
function Brand() { return <span className="brand"><BookOpen size={25} strokeWidth={1.3} /><span>reading<span className="brand-time">time</span><small>让阅读留下形状</small></span></span>; }
function Secret({ id, value, onChange, placeholder, required = true }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; required?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="secret-input"><input id={id} type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} required={required} minLength={8} /><button type="button" className="icon-button" title={visible ? '隐藏密钥' : '显示密钥'} aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [report, setReport] = useState<Report | null>(() => demoMode ? demoReport() : null), [page, setPage] = useState<Page>('overview');
  const [apiKey, setApiKey] = useState(storedKey), [remember, setRemember] = useState(!!storedKey());
  const [months, setMonths] = useState(24), [busy, setBusy] = useState(false), [sampleBusy, setSampleBusy] = useState(false);
  const [progress, setProgress] = useState({ message: '', completed: 0, total: 1 });
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [mobileNav, setMobileNav] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [modelConfig, setModelConfig] = useState<AIConfig>({ apiKey: '', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'chat' });
  const [insightKind, setInsightKind] = useState<InterpretationKind>('recommendations');
  const activeJob = useRef<string | null>(null), runId = useRef(0);
  const title = nav.find(item => item.id === page)?.label || '连接与设置';

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem('reading-time-theme', next); } catch { /* Storage is optional. */ }
  }
  const themeButton = <button type="button" className="icon-button" title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'} aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;

  useEffect(() => () => { runId.current++; if (activeJob.current) void fetch(`/api/reports/${activeJob.current}`, { method: 'DELETE', keepalive: true }); }, []);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); } }, [notice]);
  useEffect(() => {
    if (!mobileNav) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const drawer = document.getElementById('reading-navigation');
    const mobileWidth = window.matchMedia('(max-width: 760px)');
    const closeOnResize = () => { if (!mobileWidth.matches) setMobileNav(false); };
    mobileWidth.addEventListener('change', closeOnResize);
    drawer?.querySelector<HTMLButtonElement>('button[aria-label="关闭导航"]')?.focus();
    const handleDrawerKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNav(false);
        document.querySelector<HTMLButtonElement>('[aria-label="打开导航"]')?.focus();
      } else if (event.key === 'Tab' && drawer) {
        const buttons = [...drawer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handleDrawerKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      mobileWidth.removeEventListener('change', closeOnResize);
      window.removeEventListener('keydown', handleDrawerKey);
      if (drawer?.contains(document.activeElement)) document.querySelector<HTMLButtonElement>('[aria-label="打开导航"]')?.focus();
    };
  }, [mobileNav]);

  function navigate(next: Page) { setPage(demoMode && next === 'settings' ? 'insights' : next); setMobileNav(false); setError(''); window.scrollTo({ top: 0 }); }
  async function connect(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const run = ++runId.current;
    setBusy(true); setError(''); setProgress({ message: '正在连接微信读书', completed: 0, total: 1 });
    try {
      try { if (remember) sessionStorage.setItem('reading-time-key', apiKey.trim()); else sessionStorage.removeItem('reading-time-key'); } catch { /* Storage is optional. */ }
      const { id } = await post<{ id: string }>('/api/reports', { apiKey, months });
      if (run !== runId.current) { void fetch(`/api/reports/${id}`, { method: 'DELETE' }); return; }
      activeJob.current = id;
      while (run === runId.current) {
        const data = await jsonRequest<{ state: string; message: string; completed: number; total: number; report?: Report }>(`/api/reports/${id}`);
        if (run !== runId.current) return;
        setProgress(data);
        if (data.state === 'error') throw new Error(data.message);
        if (data.state === 'done' && data.report) {
          setReport(data.report); setPage('overview'); setConnecting(false); setNotice('阅读报告已更新');
          void fetch(`/api/reports/${id}`, { method: 'DELETE' }); activeJob.current = null;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } catch (e) { if (run === runId.current) setError(e instanceof Error ? e.message : '连接失败，请重试。'); }
    finally { if (run === runId.current) { setBusy(false); if (activeJob.current) { void fetch(`/api/reports/${activeJob.current}`, { method: 'DELETE' }); activeJob.current = null; } } }
  }
  function cancel() { runId.current++; if (activeJob.current) void fetch(`/api/reports/${activeJob.current}`, { method: 'DELETE' }); activeJob.current = null; setBusy(false); setProgress({ message: '', completed: 0, total: 1 }); }
  async function sample() {
    setSampleBusy(true); setError('');
    try { setReport(normalizeSample(await jsonRequest<Report>('/api/sample'))); setPage('overview'); setConnecting(false); }
    catch (e) { setError(e instanceof Error ? e.message : '示例读取失败'); }
    finally { setSampleBusy(false); }
  }
  function clear() { setReport(null); setApiKey(''); setModelConfig(c => ({ ...c, apiKey: '' })); setConnecting(false); setPage('overview'); try { sessionStorage.removeItem('reading-time-key'); } catch { /* Storage is optional. */ } }
  function openMBTI() { setInsightKind('personality'); navigate('insights'); }

  const connectionForm = <form className="connect-form" onSubmit={connect}>
    <label htmlFor="weread-key">微信读书 API Key</label><Secret id="weread-key" value={apiKey} onChange={setApiKey} placeholder="wrk-…" />
    <div className="connect-options"><label htmlFor="range">分析范围</label><select id="range" value={months} disabled={busy} onChange={e => setMonths(Number(e.target.value))}><option value={12}>最近 12 个月</option><option value={24}>最近 24 个月</option><option value={36}>最近 36 个月</option></select></div>
    <label className="checkbox-label"><input type="checkbox" checked={remember} onChange={e => { setRemember(e.target.checked); if (!e.target.checked) { try { sessionStorage.removeItem('reading-time-key'); } catch { /* Storage is optional. */ } } }} />本次浏览器会话记住 Key</label>
    {error && <p className="error-message" role="alert">{error}</p>}
    {busy ? <div className="progress-section" aria-live="polite"><div><LoaderCircle className="spin" size={16} /><span>{progress.message}</span></div><progress value={progress.completed} max={progress.total} /><div className="progress-footer"><small>{progress.completed} / {progress.total}</small><button type="button" className="text-action" onClick={cancel}>取消分析</button></div></div> : <button className="primary connect-button" type="submit">开始分析 <ArrowRight size={17} /></button>}
    <p className="privacy-copy"><ShieldCheck size={14} />密钥仅用于读取数据，不写入服务端磁盘。</p>
  </form>;

  if (!report || connecting && !demoMode) return <div className="onboarding"><header className="entry-header"><Brand /><div className="entry-header-actions">{themeButton}{report ? <button className="ghost" onClick={() => { cancel(); setConnecting(false); }}><ArrowLeft size={15} />返回报告</button> : <span className="entry-header-note">你的个人阅读档案</span>}</div></header><main className="entry-content"><div className="entry-copy"><h1>Reading Time</h1><p className="entry-description">把读过的时光，<br />慢慢看清。</p><p className="entry-support">从阅读的节律，到书页间的自己。</p>{!demoMode && connectionForm}<div className="sample-action"><span>{demoMode ? '完整合成阅读档案' : '先从一份阅读档案开始'}</span>{!demoMode && <button className="text-action" disabled={sampleBusy || busy} onClick={sample}>{sampleBusy ? <LoaderCircle size={15} className="spin" /> : '探索示例报告'}<ArrowRight size={15} /></button>}</div></div><figure className="entry-photo"><img src={`${import.meta.env.BASE_URL}reading.jpg`} alt="自然光下的图书馆，书籍铺满整面书墙" /><figcaption><span>每一页，都是时间的去处。</span><small>A LITTLE TIME. A WIDER WORLD.</small></figcaption></figure></main><footer className="entry-footer"><span>READING TIME · 个人阅读分析</span><span>基础分析无需 AI Key <span className="footer-dot">·</span> 深入解读由你选择</span></footer></div>;

  return <div className="app-shell"><button className={`nav-backdrop ${mobileNav ? 'open' : ''}`} aria-label="关闭导航" onClick={() => setMobileNav(false)} tabIndex={mobileNav ? 0 : -1} /><aside id="reading-navigation" className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="sidebar-brand"><Brand /><button className="icon-button mobile-only" title="关闭导航" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="workspace-label">我的阅读空间</div><nav aria-label="阅读分析导航">{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={17} strokeWidth={1.4} /><span>{item.label}</span>{page === item.id && <ChevronRight size={13} />}</button>)}</nav><div className="sidebar-bottom">{!demoMode && <button className="ai-entry" onClick={() => navigate('settings')}><Sparkles size={17} strokeWidth={1.3} /><div><strong>{report.analysis ? 'AI 深度分析已完成' : '让阅读，更懂你'}</strong><small>{report.analysis ? report.analysis.model : '开启 AI 深度解读'}</small></div><ArrowRight size={14} /></button>}{!demoMode && <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={17} strokeWidth={1.4} /><span>连接与设置</span></button>}<div className="account"><span className="account-avatar">{report.meta.sampleReport ? '例' : '阅'}</span><div><strong>{report.meta.sampleReport ? '示例阅读者' : '我的阅读档案'}</strong><small>{report.meta.sampleReport ? '合成数据 · 完整演示' : '微信读书已连接'}</small></div><ShieldCheck size={14} /></div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" title="打开导航" aria-label="打开导航" aria-controls="reading-navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Menu size={20} /></button><span>阅读空间</span><ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-actions">{report.meta.sampleReport && <span className="sample-badge">示例数据</span>}{themeButton}<button className="icon-button" title="导出报告 JSON" aria-label="导出报告 JSON" onClick={() => { downloadReport(report); setNotice('报告已导出'); }}><Download size={17} /></button>{!demoMode && <button className="icon-button" title="重新连接微信读书" aria-label="重新连接微信读书" onClick={() => { setError(''); setConnecting(true); }}><RefreshCw size={16} /></button>}</div></header><main className="report-main"><div className="page-heading"><div><h1>{title}</h1><p>{page === 'overview' ? '每一本读过的书，都在时间里留下了回声。' : nav.find(n => n.id === page)?.en || '管理数据连接与 AI 深度分析'}</p></div><div className="date-range"><CalendarDays size={14} /><span>{report.meta.start.replaceAll('-', '.')} — {report.meta.end.replaceAll('-', '.')}</span></div></div>{report.meta.sampleReport && <div className="sample-notice"><span>合成演示：阅读记录、章节、句子与解读均为演示编写，句子不是原书摘录。</span>{!demoMode && <button className="text-action" onClick={() => { setError(''); setConnecting(true); }}>连接我的微信读书 <ArrowRight size={14} /></button>}</div>}
      {report.warnings && report.warnings.length > 0 && <details className="coverage-warning"><summary>{report.warnings.length} 项数据读取未完成，报告展示已获取的内容</summary><ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      {page === 'overview' && <Overview report={report} navigate={navigate} />}{page === 'trends' && <Trends report={report} />}{page === 'personality' && <><Personality report={report} configure={openMBTI} />{report.analysis && <button className="ghost" onClick={openMBTI}>编辑提示词或重新生成 <ArrowRight size={15} /></button>}</>}{page === 'insights' && <InsightPage report={report} config={modelConfig} configured={Boolean(modelConfig.apiKey.trim() && modelConfig.model.trim() && modelConfig.endpoint.trim())} configure={() => navigate('settings')} selected={insightKind} onSelect={setInsightKind} onAnalysis={analysis => setReport(current => current && ({ ...current, analysis }))} onResult={(kind, result) => setReport(current => current && ({ ...current, insights: { ...current.insights, [kind]: result } }))} />}{page === 'evolution' && <Evolution report={report} configure={openMBTI} />}{page === 'preferences' && <Preferences report={report} />}{page === 'shelf' && <Shelf report={report} />}{page === 'notes' && <Notes report={report} />}{page === 'settings' && <AISettings report={report} reconnect={() => { setError(''); setConnecting(true); }} clear={clear} navigate={navigate} config={modelConfig} setConfig={setModelConfig} />}
      <footer className="report-footer"><span>reading time</span><p>{report.meta.dataCaveat}</p><small>生成于 {new Date(report.meta.generatedAt.replace(' CST', '+08:00').replace(' ', 'T')).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small></footer></main></div>{notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}</div>;
}

function AISettings({ report, reconnect, clear, navigate, config, setConfig }: { report: Report; reconnect: () => void; clear: () => void; navigate: (p: Page) => void; config: AIConfig; setConfig: React.Dispatch<React.SetStateAction<AIConfig>> }) {
  const update = (patch: Partial<AIConfig>) => setConfig(c => ({ ...c, ...patch }));
  function submit(e: FormEvent) { e.preventDefault(); navigate('insights'); }
  return <div className="settings-content"><section className="settings-section"><div className="settings-section-heading"><div><h2>模型配置</h2><p>配置保留在当前页面会话中，四种解读共用。</p></div><Sparkles size={22} strokeWidth={1.3} /></div><form onSubmit={submit}><ModelConfigFields config={config} setConfig={setConfig} /><label className="field-label" htmlFor="ai-key">模型 API Key</label><Secret id="ai-key" value={config.apiKey} onChange={apiKey => update({ apiKey })} placeholder="输入模型服务的 API Key" /><div className="settings-submit"><button className="primary" type="submit">保存配置并返回 AI 解读 <ArrowRight size={16} /></button></div></form></section><section className="settings-section"><h2>数据连接</h2><div className="connection-status"><span><ShieldCheck size={18} />{report.meta.sampleReport ? '正在浏览合成示例' : '微信读书报告已生成'}</span><button className="ghost" onClick={reconnect}><RefreshCw size={14} />{report.meta.sampleReport ? '连接微信读书' : '更新阅读数据'}</button></div><p className="muted">范围：{report.meta.range}。调整范围需要重新读取数据。</p></section><section className="settings-section"><h2>数据与隐私</h2><p className="muted">当前报告保留在页面内存中，刷新后会清除。导出的 JSON 包含阅读统计、已读取的完整划线和已生成解读及其提示词，不含 API Key。请妥善保管。</p><div className="settings-submit"><button className="ghost" onClick={() => downloadReport(report)}><Download size={15} />导出报告 JSON</button><button className="text-action" onClick={clear}>清除报告与会话密钥</button></div></section></div>;
}
