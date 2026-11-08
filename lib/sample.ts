import { sampleBooks } from '../data/sample-books';
import { aggregate, timestamp } from './report';
import { defaultPrompts } from '../src/aiPrompts';
import { highlightPlan } from '../src/highlightPlan';
import type { InsightKind, InsightResult, Report, Row } from '../src/types';

const END = '2026-11-08';
const GENERATED_AT = '2026-11-08T04:00:00.000Z';

export function createSampleReport(): Report {
  const books = sampleBooks.map((book, index) => {
    const status = index < 12 ? '读完' : index < 20 ? '在读' : '未读';
    const lastReadAt = index < 20 ? timestamp(index < 12 ? `202${4 + index % 3}-${String(2 + index % 9).padStart(2, '0')}-18` : `2026-11-${String(8 - (index - 12) % 7).padStart(2, '0')}`) : 0;
    return { bookId: `demo-book-${index + 1}`, title: book.title, author: book.author, category: book.category, publisher: book.publisher, progressFetchState: 'fetched' as const, progress: status === '读完' ? 100 : status === '在读' ? 22 + (index - 12) * 9 : 0, finishReading: status === '读完' ? 1 : 0, isStartReading: status === '未读' ? 0 : 1, lastReadAt, finishTime: status === '读完' ? lastReadAt : undefined, readingTime: 0, chapterUid: status === '未读' ? undefined : 1 + index % 5, chapterTitle: status === '未读' ? undefined : `第 ${1 + index % 5} 章（演示章节）`, secret: index % 5 === 0 ? 1 : 0 };
  });
  const months: Row[] = [];
  const annual = new Map<string, Row>();
  const details = books.map(book => ({ bookId: book.bookId, highlights: [] as Row[], reviews: [] as Row[] }));
  for (let index = 0; index < 24; index++) {
    // Start in December 2024, ending in the fixed November 2026 demo period.
    const month = new Date(Date.UTC(2024, 11 + index, 1)).toISOString().slice(0, 7);
    const year = month.slice(0, 4);
    const days = month === END.slice(0, 7) ? 8 : new Date(Date.UTC(Number(year), Number(month.slice(5)), 0)).getUTCDate();
    const active = Array.from({ length: 6 }, (_, slot) => (index * 5 + slot) % 20);
    const ids = [...new Set(active)];
    const totals = new Map<number, number>();
    const daily: Row[] = [];
    const preferTime = Array<number>(24).fill(0);
    for (let day = 1; day <= days; day++) {
      if ((day + index) % 4 === 0) continue;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const seconds = (22 + (day * 7 + index * 11) % 96) * 60;
      daily.push({ date, seconds });
      const bookIndex = ids[(day + index) % ids.length];
      totals.set(bookIndex, (totals.get(bookIndex) || 0) + seconds);
      books[bookIndex].readingTime += seconds;
      preferTime[((day % 3 === 0 ? 7 : 21) - 6 + 24) % 24] += seconds;
    }
    const readLongest = [...totals].map(([bookIndex, readTime]) => ({ book: books[bookIndex], readTime })).sort((a, b) => b.readTime - a.readTime);
    let notes = 0;
    for (const bookIndex of ids) {
      const date = daily[(bookIndex + index) % daily.length].date;
      for (const markText of sampleBooks[bookIndex].lines) details[bookIndex].highlights.push({ markText, createTime: timestamp(date), chapterUid: 1 + index % 5 });
      notes += sampleBooks[bookIndex].lines.length;
      if (index % 2 === 0) {
        details[bookIndex].reviews.push({ content: `读《${books[bookIndex].title}》的演示想法：把${books[bookIndex].category}里的知识放回日常决策，也留意这个视角没有解释的部分。`, createTime: timestamp(date) });
        notes++;
      }
    }
    const seconds = daily.reduce((sum, row) => sum + row.seconds, 0);
    months.push({ label: month, daily, seconds, days: daily.length, preferTime, readLongest, readStat: [{ stat: '读过', counts: ids.length }, { stat: '读完', counts: index % 3 === 0 ? 1 : 0 }, { stat: '笔记', counts: notes }] });
    if (!annual.has(year)) annual.set(year, { year, totalReadTime: 0, readDays: 0, preferCategory: [], readLongest: [], wrReadTime: 0, wrListenTime: 0 });
    const row = annual.get(year)!;
    row.totalReadTime += seconds; row.readDays += daily.length;
    row.wrReadTime += seconds * 0.9; row.wrListenTime += seconds * 0.1;
    for (const entry of readLongest) {
      let category = row.preferCategory.find((c: Row) => c.categoryTitle === entry.book.category);
      if (!category) { category = { categoryTitle: entry.book.category, readingTime: 0, readingCount: 0 }; row.preferCategory.push(category); }
      category.readingTime += entry.readTime; category.readingCount++;
      const existing = row.readLongest.find((b: Row) => b.book.bookId === entry.book.bookId);
      if (existing) existing.readTime += entry.readTime;
      else row.readLongest.push({ book: entry.book, readTime: entry.readTime });
    }
  }
  for (const book of books) if (book.lastReadAt) {
    const dates = details[Number(book.bookId.split('-').at(-1)) - 1].highlights.map(h => h.createTime);
    book.lastReadAt = Math.max(book.lastReadAt, ...dates);
    if (book.finishReading) book.finishTime = book.lastReadAt;
  }
  const notebooks = details.filter(detail => detail.highlights.length).map(detail => {
    const book = books.find(book => book.bookId === detail.bookId)!;
    return { bookId: book.bookId, book, readingProgress: book.progress, noteCount: detail.highlights.length, reviewCount: detail.reviews.length, bookmarkCount: 1 };
  });
  const report = aggregate({ months, annual: [...annual.values()].map(row => ({ ...row, preferCategory: row.preferCategory.sort((a: Row, b: Row) => b.readingTime - a.readingTime), preferPublisher: [...new Set(books.map(b => b.publisher))].map(name => ({ name, count: row.readLongest.filter((r: Row) => r.book.publisher === name).length })).filter(p => p.count > 0) })), shelf: { books, albums: [{ albumInfo: { name: '系统思考有声课（演示）' } }, { albumInfo: { name: '科技与社会（演示）' } }], mp: { name: '文章收藏（演示）' }, archive: [{ name: '理解系统与决策', bookIds: books.slice(0, 4).map(b => b.bookId) }, { name: '产品与创业', bookIds: books.slice(4, 12).map(b => b.bookId) }, { name: '下一本', bookIds: books.slice(20).map(b => b.bookId) }] }, notebooks, details, warnings: [], version: '1.0.5' });
  report.meta = { ...report.meta, end: END, range: `${months[0].label}-01 至 ${END}`, generatedAt: GENERATED_AT, sampleReport: true, dataCaveat: '完整合成演示：阅读事件、进度、章节、句子及解读均为演示编写，不代表真实账号；句子不是所列书籍的原文。' };
  report.series.hourlyNote = '合成示例 · 按演示阅读事件生成的24小时时段分布';
  for (const year of report.evolution || []) year.highlights = report.readerPortrait.allHighlights!.filter(q => q.createdAt.startsWith(`${year.year}-`)).slice(0, 4).map(q => q.text);
  report.readerPortrait.summary = '从系统与决策出发，逐渐走向技术、产品和人与人的关系。这份演示档案把阅读的积累与转向放在一起，也保留那些不能被效率完全解释的停顿。';
  addSampleInterpretations(report);
  return report;
}

function addSampleInterpretations(report: Report) {
  report.analysis = {
    demo: true, model: '预置演示', generatedAt: GENERATED_AT, prompt: defaultPrompts.personality,
    summary: '这份演示肖像描绘一种阅读路径：先寻找解释世界的框架，再检验框架的边界，最终给具体的人与不确定的生活留出位置。',
    yearlyPersonality: (report.evolution || []).map((year, index) => ({
      year: year.year, title: ['INTJ', 'INTP', 'INFJ'][index], visualArchetype: ['秩序寻路人', '边界勘探者', '关系织图人'][index],
      annualQuestion: ['以结构辨认方向，以怀疑保留余地', '在模型里寻找秩序，在生活里容纳意外', '让理性照亮远方，让关系安顿此刻'][index],
      description: `你在这一年的演示书页里，寻找能让复杂世界暂时清晰的坐标。《${year.books[0]}》与《${year.books[1]}》把视线引向不同的尺度：一边辨认结构，一边保留对具体处境的好奇。${year.highlights[0] ? `“${year.highlights[0].slice(0, 12)}”成为这条路径的一次停顿。` : ''}当知识不再只是答案，而开始帮助你辨认问题，阅读也显露出${['INTJ', 'INTP', 'INFJ'][index]}式的思维底色。`,
      artPersona: '伊塔洛·卡尔维诺', personaReason: '以清晰结构容纳复杂世界的轻盈',
      evidence: [`[年度路径] 演示阅读 ${year.hours} 小时，关注${year.categories.slice(0, 2).map(c => c.name).join('与')}。`, `[书目线索] 《${year.books[0]}》与《${year.books[1]}》共同构成观察的不同尺度。`, '[演示说明] 本肖像为预置内容，不是实际模型请求的结果。']
    })),
    thoughtClusters: [{ keyword: '结构与自由', books: ['系统之美', '被讨厌的勇气'], thoughtQuote: '理解约束，并不妨碍为自己的选择保留空间。' }, { keyword: '技术与人的尺度', books: ['深度学习', '用户体验要素'], thoughtQuote: '技术的精确最终要接受具体生活的检验。' }, { keyword: '行动与不确定性', books: ['精益创业', '思考，快与慢'], thoughtQuote: '可以开始行动，也可以在证据变化时重新选择。' }]
  };
  const all = report.readerPortrait.allHighlights!;
  const quote = (book: string, line: number) => all.find(q => q.bookTitle === book && q.text === sampleBooks.find(b => b.title === book)!.lines[line])!;
  const pair = (a: string, ai: number, b: string, bi: number) => [quote(a, ai), quote(b, bi)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(q => q.id);
  const result = (kind: InsightKind, sections: InsightResult['sections']): InsightResult => {
    const plan = kind === 'recommendations' ? undefined : highlightPlan(report, kind, 'selected');
    return { demo: true, kind, prompt: defaultPrompts[kind], model: '预置演示', generatedAt: GENERATED_AT, coverage: { available: kind === 'recommendations' ? report.shelf.books!.length : all.length, processed: plan?.selected ?? report.shelf.books!.filter(b => b.progress !== 100).length, batches: 0, incomplete: false, ...(plan ? { mode: 'selected' as const, unique: plan.unique, sampled: plan.sampled, books: plan.books, totalBooks: plan.totalBooks, excerptChars: plan.excerptChars } : {}) }, sections };
  };
  report.insights = {
    recommendations: result('recommendations', [
      { title: '书架内 · 未读', items: [{ heading: '把改变留在日常里', bookId: 'demo-book-21', bookTitle: '重构', status: '未读', explanation: '你已经在《程序员修炼之道》的演示笔记里关注过代码与变化的关系。此刻翻开《重构》，可以沿着这个单纯的技术兴趣继续走：关注小步修改怎样保留已有行为，而不必急着把它变成宏大的组织隐喻。', readingAnchor: '把一次小改动，看作给下一次改变留下的门。' }] },
      { title: '书架内 · 在读', items: [{ heading: '给注意力留一张椅子', bookId: 'demo-book-13', bookTitle: '纳瓦尔宝典', status: '在读', explanation: '演示书架里，这本书已读到22%。你留下的那句关于注意力的话，比追逐更多知识更接近日常生活。接着读时，不妨继续留意时间、选择与自由的联系，让这个兴趣分支自然展开，不急着和每一本技术书握手。', readingAnchor: '把时间自由读成注意力的归属。' }] },
      { title: '书架外 · 探索', items: [{ heading: '在秩序之外看见城市', bookTitle: '看不见的城市', status: '书架外 · 书目信息待核实', explanation: '《系统之美》和《规模》让你在演示材料中反复停留于结构。这次可以换一种尺度：卡尔维诺让城市成为记忆、欲望与语言的容器。它提供一种文学的观看方式，让理解世界的冲动暂时松开对解释的执着。', readingAnchor: '把每一座城市，当成一种尚未命名的心情。' }] }
    ]),
    cognition: result('cognition', [{ title: '个人认知图谱与暗线报告', items: [
      { heading: '在结构里为自由留门', explanation: '你在这些演示句子里，同时望向系统的窗口与关系的门。《系统之美》提醒观察总有边界，《被讨厌的勇气》则把边界交回具体的人。两种视角的相遇，使清醒不必通向退场：你可以理解限制，也可以保留一次主动打开的选择。', blindSpot: '如果每一次相处都先被画成边界，尚未命名的善意可能难以进入。有时，留一道缝，比再画清一条线更接近自由。', quoteIds: pair('系统之美', 0, '被讨厌的勇气', 1) },
      { heading: '让怀疑成为行动扶手', explanation: '你在《思考，快与慢》与《精益创业》的演示摘录之间，触碰到同一种张力：判断会错，事情仍要开始。这里的怀疑不必是一道刹车，也可以成为扶手，让行动保持可修正的幅度。对证据的在意与对实验的兴趣，于是能够坐在同一张桌边。', blindSpot: '如果只有可验证的事情才值得开始，关系与审美里的缓慢回报可能被遗漏。并非每一次重要尝试，都先带着清晰指标。', quoteIds: pair('思考，快与慢', 1, '精益创业', 0) },
      { heading: '在精确之外辨认温度', explanation: '你在《深度学习》中注意描述与现实的距离，又在《用户体验要素》中停留于人的阻力。两组演示摘录让技术的美感拥有另一层尺度：结构可以精确，使用它的人却有自己的节奏。智识的乐趣，也许正在这次从抽象回到具体的转身里。', blindSpot: '如果总要在知识里立即找到实际用途，暂时无用的好奇也可能失去位置。允许一些理解只是让世界变得更有趣。', quoteIds: pair('深度学习', 0, '用户体验要素', 1) }
    ] }]),
    collision: result('collision', [{ title: '跨书籍的想法大碰撞', items: [
      { heading: '当地图遇见那扇门', collisionType: '一体两面', explanation: '在这份演示时间线上，你先后留下《系统之美》的观察窗口和《被讨厌的勇气》的门。前一次停顿把世界拉远，后一次把选择拉近。两句并不争夺谁才正确：它们让你既能看见地形，也不必把地形误认成自己唯一能走的路。', dialogue: '系统的视角问：你打开门时，可曾看见门外的地形？边界的视角回应：看见地形以后，难道就要把钥匙也交出去？地图和门，在这里彼此校准。', reconciliation: '判断处境时借助系统的尺度，决定是否回应时守住自己的边界。看清约束之后，仍为选择留一点位置。', quoteIds: pair('系统之美', 0, '被讨厌的勇气', 1) },
      { heading: '怀疑与开始同桌而坐', collisionType: '暗夜回响', explanation: '你在演示材料里，先后遇到《思考，快与慢》的谨慎与《精益创业》的实验。两种温度看似不同，却都拒绝把第一个答案奉为终点。怀疑在这里不再要求你停住，行动也不再逼你假装确定；它们一起让错误变得可以被发现、被承受。', dialogue: '谨慎的视角问：如果直觉在讲故事，你准备怎样辨认？实验的视角答：先让故事接受一次小小的现实检验。两本书把怀疑从观众席请到了工作台前。', reconciliation: '代价难以回头时放慢判断，可以小步试错时尽早开始。让证据决定下一步，而不是要求第一步就永远正确。', quoteIds: pair('思考，快与慢', 1, '精益创业', 0) },
      { heading: '精密的尺与生活的缝', collisionType: '锋芒交锋', explanation: '《系统之美》对指标阴影的提醒，与《原则》对清晰规则的期待，在这份演示笔记里相遇。你能够感到一种真实的摩擦：规则让共同判断更容易，也可能让无法测量的人与处境退到边缘。这场交锋发生在清楚与周全之间，而不是理性与混乱之间。', dialogue: '规则的视角问：没有共同的起点，怎样避免每次从头争论？系统的视角反问：当尺子足够整齐，被尺子漏掉的生命由谁看见？两种目光都没有轻易让步。', reconciliation: '需要协作时先建立清晰规则，遇到具体处境时再检查规则漏掉了什么。把例外留下来，也让规则可以被修订。', quoteIds: pair('系统之美', 2, '原则', 0) }
    ] }])
  };
}
