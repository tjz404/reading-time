import { withPrompt } from './aiPrompts';
import { COGNITION, COLLISION, SYNTHESIZE_COGNITION, HIGHLIGHT_OUTPUT_TOKENS } from './insightInstructions';
import type { highlightPlan } from './highlightPlan';

// Provider tokenizers differ; show a range instead of a false exact count.
export function tokenRange(text: string) {
  const ascii = (text.match(/[\x00-\x7f]/g) || []).length;
  const unicode = Array.from(text).length - ascii;
  return { low: Math.ceil(ascii / 5 + unicode * 0.6), high: Math.ceil(ascii / 2.5 + unicode * 1.5) };
}

export function estimateHighlightTokens(plan: ReturnType<typeof highlightPlan>, kind: 'cognition' | 'collision', prompt: string) {
  if (!plan.batches.length) return { inputLow: 0, inputHigh: 0, outputLimit: 0 };
  const system = withPrompt(kind === 'cognition' ? COGNITION : COLLISION, prompt);
  let low = 0, high = 0;
  for (const highlights of plan.batches) {
    const range = tokenRange(system + JSON.stringify({ highlights, selection: { mode: plan.mode, available: plan.available, unique: plan.unique, selected: plan.selected, sampled: plan.sampled, scope: '基于本次选取的材料观察，不推断全部划线中的主题频率，不保证穷尽所有关联' } }));
    low += range.low + 24; high += range.high + 64;
  }
  const synthesis = kind === 'cognition' && plan.batches.length > 1;
  if (synthesis) {
    const base = tokenRange(withPrompt(SYNTHESIZE_COGNITION, prompt));
    // Synthesis can use up to 24 candidate observations with at most 3 quotes each.
    const observations = Math.min(24, plan.batches.length * 8);
    const evidence = plan.batches.flat().map(quote => tokenRange(JSON.stringify(quote))).sort((a, b) => b.high - a.high).slice(0, observations * 3);
    low += base.low + 64;
    high += base.high + evidence.reduce((total, range) => total + range.high, 0) + observations * 1500 + 512;
  }
  return { inputLow: Math.max(1, Math.floor(low / 100) * 100), inputHigh: Math.ceil(high / 100) * 100, outputLimit: plan.batches.length * HIGHLIGHT_OUTPUT_TOKENS[kind] + (synthesis ? HIGHLIGHT_OUTPUT_TOKENS.synthesis : 0) };
}
