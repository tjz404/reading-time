import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyModelPreset, matchingPreset, modelPresets } from '../src/modelPresets';
import { endpointFor } from '../lib/ai';
import type { AIConfig } from '../src/types';

const config: AIConfig = { apiKey: 'test-private-key', endpoint: 'https://api.deepseek.com/v1', protocol: 'chat', model: 'deepseek-chat' };

test('switching providers never carries a key to another origin, and custom selection preserves edits', () => {
  for (const preset of modelPresets) {
    const next = applyModelPreset(config, preset.id);
    assert.equal(next.apiKey, preset.id === 'deepseek' ? config.apiKey : '');
    assert.equal(next.endpoint, preset.endpoint);
    assert.equal(next.protocol, preset.protocol);
  }
  assert.equal(applyModelPreset(config, 'custom'), config);
  assert.equal(config.apiKey, 'test-private-key');
});

test('presets normalize to the right API path and remain recognizable after model edits', () => {
  for (const preset of modelPresets) {
    const next = applyModelPreset(config, preset.id);
    const url = endpointFor(next);
    assert.equal(url.protocol, 'https:');
    assert.ok(url.pathname.endsWith(preset.protocol === 'responses' ? '/responses' : '/chat/completions'));
    assert.equal(matchingPreset({ ...next, model: 'another-model', endpoint: `${next.endpoint}/` })?.id, preset.id);
  }
  assert.equal(matchingPreset({ ...config, endpoint: 'https://example.com/v1' }), undefined);
  assert.equal(applyModelPreset(config, 'volcengine').model, '');
});
