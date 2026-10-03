import type { ConnectionMode } from '../types';
import { DEFAULT_API_BASE, DEFAULT_MODEL, DEFAULT_PROXY_API_BASE } from '../settings/schema';

export type ProviderPresetId = 'local-api' | 'deepseek' | 'minimax' | 'siliconflow' | 'ark-agent-plan' | 'openai' | 'ollama' | 'custom';

export interface ProviderPreset {
  id: ProviderPresetId;
  labelKey: string;
  hintKey: string;
  groupKey: string;
  mode: ConnectionMode;
  apiBase: string;
  model: string;
  iconPath: string;
}

/**
 * Direct/local provider defaults live in one catalog so adding a provider is a
 * data change plus one static logo, rather than another UI branch.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'local-api',
    labelKey: 'presetLocalApi',
    hintKey: 'presetLocalApiHint',
    groupKey: 'presetGroupLocal',
    mode: 'proxy',
    apiBase: DEFAULT_PROXY_API_BASE,
    model: DEFAULT_MODEL,
    iconPath: 'icons/icon128.png',
  },
  {
    id: 'deepseek',
    labelKey: 'presetDeepSeek',
    hintKey: 'presetDeepSeekHint',
    groupKey: 'presetGroupCloud',
    mode: 'direct',
    apiBase: DEFAULT_API_BASE,
    model: DEFAULT_MODEL,
    iconPath: 'icons/providers/deepseek.svg',
  },
  {
    id: 'minimax',
    labelKey: 'presetMiniMax',
    hintKey: 'presetMiniMaxHint',
    groupKey: 'presetGroupCloud',
    mode: 'direct',
    apiBase: 'https://api.minimax.cn/v1',
    model: 'MiniMax-M3',
    iconPath: 'icons/providers/minimax.svg',
  },
  {
    id: 'siliconflow',
    labelKey: 'presetSiliconFlow',
    hintKey: 'presetSiliconFlowHint',
    groupKey: 'presetGroupCloud',
    mode: 'direct',
    apiBase: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    iconPath: 'icons/providers/siliconflow.svg',
  },
  {
    id: 'ark-agent-plan',
    labelKey: 'presetArkAgentPlan',
    hintKey: 'presetArkAgentPlanHint',
    groupKey: 'presetGroupCloud',
    mode: 'direct',
    apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'ark-code-latest',
    iconPath: 'icons/providers/volcengine.svg',
  },
  {
    id: 'openai',
    labelKey: 'presetOpenAI',
    hintKey: 'presetOpenAIHint',
    groupKey: 'presetGroupCloud',
    mode: 'direct',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    iconPath: 'icons/providers/openai.svg',
  },
  {
    id: 'ollama',
    labelKey: 'presetOllama',
    hintKey: 'presetOllamaHint',
    groupKey: 'presetGroupLocal',
    mode: 'direct',
    apiBase: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    iconPath: 'icons/providers/ollama.svg',
  },
  {
    id: 'custom',
    labelKey: 'presetCustom',
    hintKey: 'presetCustomHint',
    groupKey: 'presetGroupCompatible',
    mode: 'direct',
    apiBase: '',
    model: '',
    iconPath: 'icons/providers/custom.svg',
  },
] as const;

export function getProviderPreset(id: string | null | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!;
}

function normalizeApiBase(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return String(value || '').trim().replace(/\/$/, '').toLowerCase();
  }
}

export function findProviderPreset(apiBase: string): ProviderPreset {
  const normalized = normalizeApiBase(apiBase);
  return PROVIDER_PRESETS.find((preset) => preset.id !== 'custom' && normalizeApiBase(preset.apiBase) === normalized)
    ?? getProviderPreset('custom');
}

export function isMiniMaxApiBase(apiBase: string): boolean {
  try {
    return new URL(apiBase).hostname.toLowerCase() === 'api.minimax.cn';
  } catch {
    return apiBase.toLowerCase().includes('api.minimax.cn');
  }
}
