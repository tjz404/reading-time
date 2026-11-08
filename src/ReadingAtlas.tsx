import { ArrowUpRight } from 'lucide-react';
import type { Report, Row } from './types';

const positions = [48, 102, 156, 210, 264];
const palette = ['var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'];

export function ReadingAtlas({ report, onExplore }: { report: Report; onExplore: () => void }) {
  const categories = report.reading.categories.filter((item: Row) => Number(item.hours) > 0).sort((a: Row, b: Row) => Number(b.hours) - Number(a.hours)).slice(0, 5);
  const top = categories[0];
  const max = Math.max(...categories.map((item: Row) => Number(item.hours)), 1);
  const format = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

  return <section className="reading-atlas" aria-labelledby="reading-atlas-title">
    <div className="atlas-story">
      <h2 id="reading-atlas-title" className="atlas-lead">{top ? <>时间在 <strong>{top.name}</strong> 停留得最久，<br />也流向更多不同的领域。</> : '阅读的领域，等待你慢慢点亮。'}</h2>
      <p className="atlas-caption">按覆盖到的自然年统计分类时长。每条路线从领域出发，终点是你实际停留的时间。</p>
      <button type="button" className="atlas-action" onClick={onExplore}>探索阅读偏好 <ArrowUpRight size={17} /></button>
    </div>
    <div className="atlas-visual">
      {categories.length ? <>
        <svg className="atlas-network" viewBox="0 0 610 310" role="img" aria-label={`阅读领域图谱：${categories.map((item: Row) => `${item.name} ${format(Number(item.hours))} 小时`).join('；')}`}>
          <path className="atlas-trunk" d="M92 156 H165" />
          <circle className="atlas-origin-ring" cx="92" cy="156" r="47" />
          <circle className="atlas-origin-core" cx="92" cy="156" r="35" />
          <text className="atlas-origin-label" x="92" y="151" textAnchor="middle">阅读</text>
          <text className="atlas-origin-sub" x="92" y="171" textAnchor="middle">领域</text>
          {categories.map((item: Row, index: number) => {
            const y = positions[index];
            const radius = 7 + Number(item.hours) / max * 9;
            const color = palette[index];
            return <g key={`${item.name}-${index}`}>
              <path className="atlas-route" d={`M165 156 C209 156 204 ${y} 267 ${y} H303`} stroke={color} />
              <circle cx="315" cy={y} r={radius + 7} fill={color} opacity=".12" />
              <circle cx="315" cy={y} r={radius} fill={color} />
              <text className="atlas-node-title" x="345" y={y - 3}>{item.name.length > 12 ? `${item.name.slice(0, 11)}…` : item.name}</text>
              <text className="atlas-node-hours" x="345" y={y + 17}>{format(Number(item.hours))} 小时</text>
            </g>;
          })}
        </svg>
        <svg className="atlas-network-mobile" viewBox="0 0 320 240" role="img" aria-label={`阅读领域图谱：${categories.map((item: Row) => `${item.name} ${format(Number(item.hours))} 小时`).join('；')}`}>
          <circle className="atlas-origin-ring" cx="47" cy="120" r="35" />
          <circle className="atlas-origin-core" cx="47" cy="120" r="29" />
          <text className="atlas-origin-label" x="47" y="116" textAnchor="middle">阅读</text>
          <text className="atlas-origin-sub" x="47" y="133" textAnchor="middle">领域</text>
          {categories.map((item: Row, index: number) => {
            const y = 28 + index * 46;
            return <g key={`${item.name}-${index}`}>
              <path className="atlas-route" d={`M82 120 C112 120 104 ${y} 143 ${y}`} stroke={palette[index]} />
              <circle cx="152" cy={y} r={7 + Number(item.hours) / max * 5} fill={palette[index]} />
              <text className="atlas-node-title" x="174" y={y - 2}>{item.name.length > 8 ? `${item.name.slice(0, 7)}…` : item.name}</text>
              <text className="atlas-node-hours" x="174" y={y + 15}>{format(Number(item.hours))} 小时</text>
            </g>;
          })}
        </svg>
        <div className="atlas-legend" aria-hidden="true">{categories.map((item: Row, i: number) => <span key={`${item.name}-${i}`}><i style={{ background: palette[i] }} />{item.name} · {format(Number(item.hours))} 小时</span>)}</div>
      </> : <p className="atlas-empty">当前报告还没有分类时长。连接数据后，这里会呈现你的阅读领域。</p>}
    </div>
  </section>;
}
