import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart, TreemapChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent, VisualMapComponent, CalendarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Row } from './types';

echarts.use([BarChart, LineChart, PieChart, RadarChart, TreemapChart, ScatterChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent, VisualMapComponent, CalendarComponent, CanvasRenderer]);
export type Option = Record<string, any>;
function colors() {
  const light = document.documentElement.dataset.theme === 'light';
  return light ? { ink: '#173630', muted: '#506a61', grid: '#cfdfd3', surface: '#fafcf8', control: '#fafcf8', border: '#c5d8cd', bar: '#27836a', area: '#27836a', scatter: '#bb4934', label: '#fff', palette: ['#247562', '#b26d20', '#bc563f', '#427db1', '#7657a0', '#536e62'] }
    : { ink: '#b5dcd5', muted: '#b9c7ca', grid: '#46515b', surface: '#2a3038', control: '#383f48', border: '#46515b', bar: '#9bd6ce', area: '#9bd6ce', scatter: '#c9afe2', label: '#202329', palette: ['#9bd6ce', '#eac77e', '#c9afe2', '#90bddd', '#bacc9a', '#a9c8e0'] };
}
function axis() { const { muted, grid } = colors(); return { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 13 }, splitLine: { lineStyle: { color: grid, type: 'dashed' } } }; }

export function Chart({ option, label, height = 280 }: { option: Option; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: 'canvas' });
    const { ink, muted, control, border, palette } = colors();
    chart.setOption({ animationDuration: 250, color: palette, backgroundColor: 'transparent', textStyle: { color: muted, fontFamily: 'system-ui, sans-serif' }, ...option, tooltip: { trigger: 'axis', confine: true, backgroundColor: control, borderColor: border, textStyle: { color: ink, fontSize: 13, lineHeight: 21 }, renderMode: 'richText', ...option.tooltip } });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div className="chart" ref={ref} role="img" aria-label={label} style={{ height }} />;
}

export function line(labels: string[], values: number[], name: string, area = false): Option {
  const { ink, muted, area: areaColor } = colors(), a = axis();
  return { grid: { left: 44, right: 16, top: 24, bottom: 28 }, xAxis: { ...a, type: 'category', boundaryGap: false, data: labels, splitLine: { show: false }, axisLabel: { ...a.axisLabel, hideOverlap: true, formatter: (s: string) => s.slice(2) } }, yAxis: { ...a, type: 'value', name, nameTextStyle: { color: muted, padding: [0, 20, 0, 0] } }, series: [{ name, type: 'line', data: values, symbolSize: 5, showSymbol: values.length < 16, smooth: 0.25, lineStyle: { width: 2, color: ink }, itemStyle: { color: ink }, ...(area ? { areaStyle: { color: areaColor, opacity: 0.1 } } : {}) }] };
}

export function bar(labels: string[], values: number[], name: string): Option {
  const { muted, bar: barColor } = colors(), a = axis();
  return { grid: { left: 40, right: 12, top: 24, bottom: 30 }, xAxis: { ...a, type: 'category', data: labels, splitLine: { show: false }, axisLabel: { ...a.axisLabel, hideOverlap: true, formatter: (s: string) => s.length > 6 ? s.slice(2) : s } }, yAxis: { ...a, type: 'value', name, nameTextStyle: { color: muted } }, series: [{ name, type: 'bar', data: values, barMaxWidth: 24, itemStyle: { color: barColor, borderRadius: [3, 3, 0, 0] } }] };
}

export function horizontal(rows: Row[], value = 'hours', name = 'name', unit = '小时', limit = 8): Option {
  const data = rows.slice(0, limit).reverse();
  const { muted, bar: barColor } = colors(), a = axis();
  return { grid: { left: 110, right: 48, top: 8, bottom: 24 }, xAxis: { ...a, type: 'value', name: unit, nameLocation: 'end', splitNumber: 2, axisLabel: { ...a.axisLabel, hideOverlap: true } }, yAxis: { ...a, type: 'category', data: data.map(r => r[name]), splitLine: { show: false }, axisLabel: { color: muted, fontSize: 13, width: 98, overflow: 'truncate' } }, series: [{ type: 'bar', name: unit, data: data.map(r => r[value]), barMaxWidth: 12, itemStyle: { color: barColor, borderRadius: [0, 2, 2, 0] }, label: { show: true, position: 'right', color: muted, fontSize: 13 } }] };
}

export function donut(rows: Row[], value = 'value'): Option {
  const { muted, ink, surface, palette } = colors();
  return { tooltip: { trigger: 'item', confine: true, renderMode: 'richText', formatter: '{b}: {c} ({d}%)' }, legend: { bottom: 4, textStyle: { color: muted, fontSize: 13 }, icon: 'circle', itemWidth: 7 }, series: [{ type: 'pie', radius: ['48%', '70%'], center: ['50%', '43%'], avoidLabelOverlap: true, itemStyle: { borderColor: surface, borderWidth: 3 }, label: { show: false }, emphasis: { label: { show: true, color: ink, fontSize: 15 } }, data: rows.filter(r => r[value] > 0).map((r, i) => ({ name: r.name, value: r[value], itemStyle: { color: palette[i % palette.length] } })) }] };
}

export function radar(rows: Row[]): Option {
  const data = rows.slice(0, 6), max = Math.max(...data.map(r => r.hours), 1);
  const { ink, muted, grid, area } = colors();
  return { tooltip: { trigger: 'item', confine: true, renderMode: 'richText' }, radar: { indicator: data.map(r => ({ name: r.name, max })), radius: '61%', axisName: { color: muted, fontSize: 13 }, splitArea: { show: false }, splitLine: { lineStyle: { color: grid } }, axisLine: { lineStyle: { color: grid } } }, series: [{ type: 'radar', data: [{ value: data.map(r => r.hours), name: '分类阅读小时' }], lineStyle: { color: ink, width: 1.5 }, itemStyle: { color: ink }, areaStyle: { color: area, opacity: 0.1 }, symbolSize: 4 }] };
}

export function treemap(rows: Row[], key = 'value'): Option {
  const { label, surface, palette } = colors();
  return { tooltip: { trigger: 'item', renderMode: 'richText', confine: true }, series: [{ type: 'treemap', left: 0, right: 0, top: 0, bottom: 0, roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, color: label, fontSize: 13, overflow: 'break', formatter: '{b}\n{c}' }, itemStyle: { borderColor: surface, borderWidth: 3, gapWidth: 3 }, levels: [{ color: palette, colorMappingBy: 'index', itemStyle: { borderWidth: 0, gapWidth: 4 } }], data: rows.filter(r => r[key] > 0).slice(0, 12).map(r => ({ name: r.name, value: r[key] })) }] };
}

export function scatter(data: any[][]): Option {
  const { scatter } = colors(), a = axis();
  return { grid: { left: 44, right: 28, top: 20, bottom: 36 }, tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: (p: any) => `${p.value[2]}\n阅读进度 ${p.value[0]}% · 笔记 ${p.value[1]} 条` }, xAxis: { ...a, min: 0, max: 100, name: '%', type: 'value' }, yAxis: { ...a, type: 'value', name: '笔记' }, series: [{ type: 'scatter', symbolSize: 10, itemStyle: { color: scatter, opacity: 0.65 }, data }] };
}
