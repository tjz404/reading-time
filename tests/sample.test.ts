import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampleReport } from '../lib/sample';
import { validateAnalysis } from '../lib/ai';
import { validateInsightItems } from '../lib/insights';
import { highlightPlan } from '../src/highlightPlan';
import { shelfReadingStates } from '../src/readingDetails';
import { normalizeSample } from '../src/api';

test('sample covers the current report contract and keeps chart totals consistent', () => {
  const report = normalizeSample(createSampleReport());
  assert.equal(report.meta.sampleReport, true);
  assert.equal(report.meta.schemaVersion, 2);
  assert.match(report.meta.dataCaveat, /不是.*原文/);
  assert.equal(report.series.months.length, 24);
  assert.equal(report.series.months[0], '2024-12');
  assert.equal(report.series.months.at(-1), '2026-11');
  assert.equal(report.shelf.books?.length, report.kpis.ebookCount);
  assert.deepEqual(shelfReadingStates(report).map(row => row.value), [12, 8, 4]);
  assert.equal(report.shelf.composition.reduce((sum, row) => sum + row.value, 0), report.kpis.shelfTotal);
  assert.equal(report.notes.typeTotals.reduce((sum, row) => sum + row.value, 0), report.kpis.noteTotal);
  assert.equal(report.readerPortrait.allHighlights?.length, report.kpis.highlightsFetchedInRange);
  assert.ok(Math.abs(report.series.dailyHeat.reduce((sum, row) => sum + row[1] / 60, 0) - report.kpis.totalReadHours) < 0.01);
  assert.equal(report.series.dailyHeat.filter(row => row[1] >= 1).length, report.kpis.readDays);
  assert.equal(report.coverage.monthsWithBookRanking, 24);
  assert.equal(report.coverage.monthsWithNotes, 24);
  assert.equal(report.series.hourly?.length, 24);
  assert.ok(report.series.hourly!.some(value => value > 0));
  assert.ok(report.reading.publishers.length > 0);
  assert.ok(report.readerPortrait.quotes.every(q => q.createdAt && q.bookId));
  assert.equal(report.readerPortrait.quotes.length, 10);
  for (const year of report.evolution!) {
    assert.ok(year.books.length > 0 && year.highlights.length > 0 && year.categories.length > 0);
    assert.ok(year.categories.every(c => c.books.length > 0));
  }
  for (const [month, rows] of Object.entries(report.series.monthlyBooks!)) {
    const seconds = rows.reduce((sum, row) => sum + row.seconds!, 0);
    assert.ok(Math.abs(seconds / 3600 - report.series.monthlyReadHours[report.series.months.indexOf(month)]) < 0.01);
  }
  assert.ok(report.shelf.books!.filter(b => b.progress === 0).every(b => b.readingTime === 0 && !b.lastReadAt));
});

test('all four prewritten interpretations have valid evidence and are explicitly demonstrations', () => {
  const report = createSampleReport();
  assert.equal(report.analysis?.demo, true);
  assert.equal(validateAnalysis(report.analysis!, report).yearlyPersonality.length, 3);
  const quotes = new Map(report.readerPortrait.allHighlights!.map(q => [q.id, q]));
  const shelf = new Map(report.shelf.books!.map(b => [b.bookId!, b]));
  const titles = new Set(report.shelf.books!.map(b => b.title));
  for (const kind of ['recommendations', 'cognition', 'collision'] as const) {
    const result = report.insights![kind]!;
    assert.equal(result.demo, true);
    assert.equal(result.coverage.batches, 0, 'prewritten results never claim paid requests');
    assert.ok(result.prompt);
    for (const section of result.sections) {
      assert.ok(section.items.length > 0);
      assert.equal(validateInsightItems(kind, { items: section.items.map(item => ({ ...item, status: item.status?.startsWith('书架外') ? '书架外' : item.status })) }, quotes, shelf, titles).length, section.items.length);
    }
    if (kind !== 'recommendations') {
      const plan = highlightPlan(report, kind, 'selected');
      assert.ok(plan.selected > 0 && plan.requests <= 5);
    }
  }
});
