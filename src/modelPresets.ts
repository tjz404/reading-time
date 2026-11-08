import type { AIConfig } from './types';

export interface ModelPreset {
  id: string;
  label: string;
  endpoint: string;
  protocol: AIConfig['protocol'];
  model: string;
  placeholder: string;
  note?: string;
  docs: string;
}

export const modelPresets: ModelPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', protocol: 'chat', model: 'deepseek-chat', placeholder: 'deepseek-chat', docs: 'https://api-docs.deepseek.com/' },
  { id: 'volcengine', label: '火山方舟 · 豆包', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'chat', model: '', placeholder: '控制台中的模型 ID 或 ep-… 接入点 ID', note: '填写方舟控制台中已开通的模型 ID 或接入点 ID；其他地域请修改 API 地址。', docs: 'https://www.volcengine.com/docs/82379/1399008' },
  { id: 'siliconflow', label: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1', protocol: 'chat', model: 'deepseek-ai/DeepSeek-V3', placeholder: '例如 deepseek-ai/DeepSeek-V3', note: '模型名称需包含平台提供的完整前缀，以控制台可用模型为准。', docs: 'https://docs.siliconflow.cn/cn/userguide/quickstart' },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', protocol: 'responses', model: 'gpt-5.4-mini', placeholder: '例如 gpt-5.4-mini', docs: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini' },
  { id: 'qwen', label: '阿里云百炼 · 通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'chat', model: 'qwen-plus', placeholder: '例如 qwen-plus', note: '预设为北京地域通用地址，Key 需与地域匹配；可替换为控制台中的工作空间专属地址。', docs: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope' }
];

const normalized = (endpoint: string) => endpoint.trim().replace(/\/+$/, '');
export function matchingPreset(config: AIConfig) {
  return modelPresets.find(preset => normalized(preset.endpoint) === normalized(config.endpoint) && preset.protocol === config.protocol);
}

export function applyModelPreset(config: AIConfig, id: string): AIConfig {
  const preset = modelPresets.find(item => item.id === id);
  if (!preset) return config;
  let sameOrigin = false;
  try { sameOrigin = new URL(config.endpoint).origin === new URL(preset.endpoint).origin; } catch { /* Invalid custom addresses cannot share credentials. */ }
  return { endpoint: preset.endpoint, protocol: preset.protocol, model: preset.model, apiKey: sameOrigin ? config.apiKey : '' };
}
