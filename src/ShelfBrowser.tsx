import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, Search } from 'lucide-react';
import { duration, lastReadTime, readingDate, readingProgress, readingStatus, sortShelfBooks } from './readingDetails';
import { InfoTip } from './InfoTip';
import type { Report, ShelfBook } from './types';

function Progress({ book }: { book: ShelfBook }) {
  const value = readingProgress(book.progress ?? book.readingProgress);
  return value == null ? <span className="muted">未提供</span> : <span className="book-progress"><progress aria-label={`${book.title}阅读进度`} value={value} max={100} /><span>{value}%</span></span>;
}

function ReadingTime({ seconds }: { seconds?: number }) {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? <>{duration(seconds)}</> : <>未提供</>;
}

function ReadingLink({ book }: { book: ShelfBook }) {
  const link = book.readerLink || book.deepLink;
  if (typeof link !== 'string' || !/^(https:\/\/|weread:\/\/)/i.test(link)) return null;
  return <a className="text-action" href={link} target="_blank" rel="noreferrer">{book.readerLink ? '打开阅读' : '查看详情'}<ExternalLink size={14} /></a>;
}

function BookCover({ book }: { book: ShelfBook }) {
  const [failed, setFailed] = useState(false);
  return book.cover && !failed ? <img className="book-cover" src={book.cover} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /> : <span className="book-cover cover-fallback" aria-hidden="true"><BookOpen size={17} strokeWidth={1.3} /></span>;
}

export function ShelfBrowser({ report }: { report: Report }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState<string | null>(null);
  const source = report.shelf.books;
  const books = useMemo(() => sortShelfBooks((source || []).filter(b => (!query.trim() || `${b.title || ''} ${b.author || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (status === 'all' || (b.readingStatus || readingStatus(b)) === status)), sort), [source, query, status, sort]);
  const recent = useMemo(() => sortShelfBooks((source || []).filter(b => lastReadTime(b) > 0 && (b.readingStatus || readingStatus(b)) === '在读'), 'recent').slice(0, 5), [source]);
  const ranked = useMemo(() => new Map(report.reading.topBooks.filter(row => row.bookId && typeof row.seconds === 'number' && row.seconds > 0).map(row => [String(row.bookId), row.seconds as number])), [report.reading.topBooks]);
  const fetched = report.coverage.shelfProgressFetched;

  function showBook(book: ShelfBook) {
    setQuery(''); setStatus('all'); setSelected(String(book.bookId));
    requestAnimationFrame(() => document.getElementById('shelf-browser')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  return <>
    <section className="recent-reading" aria-labelledby="recent-reading-title">
      <div className="section-heading"><h2 id="recent-reading-title">最近在读</h2><span className="source-label">按最后阅读时间</span></div>
      {recent.length ? <div className="recent-books">{recent.map(b => <div className="recent-book" key={b.bookId}>
        <button className="recent-book-title" onClick={() => showBook(b)}><BookCover book={b} /><span><strong>{b.title}</strong><small>{b.author || '作者未提供'}</small></span></button>
        <Progress book={b} /><time>{readingDate(lastReadTime(b))}</time>
      </div>)}</div> : <p className="shelf-empty">{source ? '暂无带阅读日期的在读书籍。' : '当前报告没有单书记录，连接微信读书后查看。'}</p>}
    </section>
    <section id="shelf-browser" className="shelf-browser" aria-labelledby="shelf-browser-title">
      <div className="section-heading"><h2 id="shelf-browser-title">书架明细</h2><span className="info-actions"><InfoTip label="书架阅读时长口径" text="累计时长来自书架单书记录，属于账户全部历史；当前接口未返回时显示未提供。区间排行时长是所选日期内每月最多十本书的时长累计，仅为覆盖到的排行样本，不能当作单书全量时长。" /><span className="source-label">{books.length} 本电子书</span></span></div>
      {typeof fetched === 'number' && <p className="data-coverage">已核对 {fetched} / {report.coverage.shelfProgressRequested} 本单书进度；{typeof report.coverage.shelfReadingTimeAvailable === 'number' ? `${report.coverage.shelfReadingTimeAvailable} 本有累计时长。` : ''}{report.coverage.shelfProgressErrors > 0 ? ` ${report.coverage.shelfProgressErrors} 本进度读取失败，保留已有记录。` : ''}</p>}
      {source ? <>
        <div className="table-tools shelf-tools"><label className="search-input"><Search size={16} /><input aria-label="搜索书名或作者" placeholder="搜索书名或作者" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <select aria-label="筛选阅读状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="读完">读完</option><option value="在读">在读</option><option value="未读">未读</option></select>
          <select aria-label="书架排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近阅读</option><option value="progress">阅读进度</option><option value="duration">累计时长</option></select>
        </div>
        {books.length ? <div className="table-wrap"><table className="shelf-table"><thead><tr><th>书名 / 作者</th><th>状态</th><th>进度</th><th>累计时长</th><th>区间排行</th><th>最近阅读</th></tr></thead><tbody>{books.map((b, i) => {
          const id = String(b.bookId || i), expanded = selected === id;
          return <ShelfRow key={id} book={b} rankedSeconds={ranked.get(String(b.bookId))} index={i} expanded={expanded} toggle={() => setSelected(expanded ? null : id)} />;
        })}</tbody></table></div> : <p className="shelf-empty">没有匹配的书籍，试试其他书名或状态。</p>}
      </> : <p className="shelf-empty">这份报告仅包含聚合统计，连接微信读书后可查看书架明细。</p>}
    </section>
  </>;
}

function ShelfRow({ book: b, rankedSeconds, index, expanded, toggle }: { book: ShelfBook; rankedSeconds?: number; index: number; expanded: boolean; toggle: () => void }) {
  const progress = readingProgress(b.progress ?? b.readingProgress);
  return <>
    <tr className={expanded ? 'shelf-row-selected' : ''}>
      <td><button className="shelf-book-toggle" aria-expanded={expanded} aria-controls={`book-detail-${index}`} onClick={toggle}><BookCover book={b} /><span><strong>{b.title || '未命名书籍'}</strong><small>{b.author || '作者未提供'}</small></span>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></td>
      <td data-label="状态">{b.readingStatus || readingStatus(b)}</td><td data-label="进度"><Progress book={b} /></td><td data-label="累计时长"><ReadingTime seconds={b.readingTime} /></td><td data-label="区间排行"><ReadingTime seconds={rankedSeconds} /></td><td data-label="最近阅读"><time>{readingDate(lastReadTime(b))}</time></td>
    </tr>
    <tr hidden={!expanded} id={`book-detail-${index}`} className="book-detail-row"><td colSpan={6}><div className="book-detail-content">
      <h3>《{b.title || '未命名书籍'}》阅读详情</h3>
      <dl className="book-detail-facts"><div><dt>分类</dt><dd>{b.category || '未分类'}</dd></div><div><dt>阅读进度</dt><dd>{progress == null ? '未提供' : `${progress}%`}</dd></div><div><dt>当前章节</dt><dd>{b.chapterTitle || '未提供'}</dd></div><div><dt>累计阅读时长</dt><dd><ReadingTime seconds={b.readingTime} /></dd></div><div><dt>区间排行时长</dt><dd><ReadingTime seconds={rankedSeconds} /></dd></div><div><dt>最后阅读</dt><dd>{readingDate(lastReadTime(b))}</dd></div><div><dt>读完日期</dt><dd>{progress === 100 ? readingDate(b.finishTime) : '未提供'}</dd></div></dl>
      <p className="muted">{b.progressFetchState === 'failed' ? '本次单书进度读取失败，显示已有记录。重新分析可重试。' : b.progressFetchState !== 'fetched' ? '此报告尚未核对单书进度，重新连接并分析可更新。' : ''}</p>
      <ReadingLink book={b} />
    </div></td></tr>
  </>;
}
