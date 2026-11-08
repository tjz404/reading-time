import { FEATURED_HIGHLIGHT_LIMIT, type AIConfig, type Analysis, type Report } from './types';

export async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => { throw new Error('服务响应异常，请检查本地服务是否运行。'); });
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

export function post<T>(url: string, value: unknown, signal?: AbortSignal) { return jsonRequest<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal }); }
export const analyzeReport = (report: Report, config: AIConfig, signal?: AbortSignal, prompt?: string) => post<Analysis>('/api/analyze', { report, config, prompt }, signal);

export function normalizeSample(report: Report): Report {
  report.meta.sampleReport = true;
  report.warnings ||= [];
  report.readerPortrait.quotes = report.readerPortrait.quotes.slice(0, FEATURED_HIGHLIGHT_LIMIT);
  return report;
}

export function downloadReport(report: Report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `reading-time-${report.meta.end}${report.meta.sampleReport ? '-sample' : ''}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
