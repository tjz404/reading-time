import { useState, type Dispatch, type SetStateAction } from 'react';
import { ExternalLink } from 'lucide-react';
import type { AIConfig } from './types';
import { applyModelPreset, matchingPreset, modelPresets } from './modelPresets';

export function ModelConfigFields({ config, setConfig }: { config: AIConfig; setConfig: Dispatch<SetStateAction<AIConfig>> }) {
  const [presetId, setPresetId] = useState(() => matchingPreset(config)?.id || 'custom');
  const preset = modelPresets.find(item => item.id === presetId);
  function update(patch: Partial<AIConfig>) {
    if (patch.endpoint !== undefined || patch.protocol !== undefined) setPresetId('custom');
    setConfig(previous => ({ ...previous, ...patch }));
  }
  return <>
    <label className="field-label" htmlFor="ai-provider">服务商预设</label>
    <select id="ai-provider" value={presetId} onChange={event => { const id = event.target.value; setPresetId(id); setConfig(previous => applyModelPreset(previous, id)); }}>
      {modelPresets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      <option value="custom">自定义</option>
    </select>
    <div className="provider-context">{preset?.note && <p>{preset.note}</p>}{preset && <a href={preset.docs} target="_blank" rel="noreferrer">服务文档 <ExternalLink size={13} /></a>}</div>
    <div className="form-grid">
      <label htmlFor="ai-protocol"><span>接口类型</span><select id="ai-protocol" aria-label="接口类型" value={config.protocol} onChange={event => update({ protocol: event.target.value as AIConfig['protocol'] })}><option value="chat">Chat Completions 兼容接口</option><option value="responses">Responses 兼容接口</option><option value="anthropic">Anthropic Messages</option></select></label>
      <label htmlFor="ai-model">模型名称<input id="ai-model" required value={config.model} placeholder={preset?.placeholder || '填写服务商提供的模型名称'} onChange={event => update({ model: event.target.value })} /></label>
    </div>
    <label className="field-label" htmlFor="ai-endpoint">API 地址</label>
    <input id="ai-endpoint" type="url" required value={config.endpoint} onChange={event => update({ endpoint: event.target.value })} placeholder="https://api.example.com/v1" />
  </>;
}
