import type { ModelParameters, ReasoningEffort, ThinkingOverride, ThinkingPatch } from '../types';
import { TapTranslateError } from '../errors';

export interface ThinkingSettings {
  apiBase: string;
  model?: string;
  modelParameters?: ModelParameters;
}

interface ThinkingProfile extends ThinkingOverride {
  hintKey: string;
  automatic: 'enabled' | 'disabled' | 'omit';
  efforts: readonly ReasoningEffort[];
}

const generic: ThinkingProfile = {
  hintKey: 'thinkingGenericHint', automatic: 'omit',
  enabled: { thinking: { type: 'enabled' } }, disabled: { thinking: { type: 'disabled' } },
  efforts: ['low', 'medium', 'high'],
};
const deepseek: ThinkingProfile = { ...generic, hintKey: 'thinkingDeepSeekHint', automatic: 'disabled' };

// Exact model capabilities override provider defaults. Do not infer future models
// from a family prefix: even M3 and M3.1 have different disable semantics.
// https://platform.minimax.cn/docs/api-reference/text-chat-openai
const modelProfiles: Readonly<Record<string, ThinkingProfile>> = {
  'minimax-m3': {
    hintKey: 'thinkingM3Hint', automatic: 'disabled', efforts: [],
    enabled: { thinking: { type: 'adaptive' } }, disabled: { thinking: { type: 'disabled' } },
  },
  'minimax-m3.1-flash-preview': {
    hintKey: 'thinkingFlashHint', automatic: 'enabled', efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    enabled: { thinking: { type: 'adaptive' } }, disabled: null,
  },
};

export function resolveThinkingProfile(settings: ThinkingSettings): ThinkingProfile {
  const override = settings.modelParameters?.thinkingOverride;
  if (override) return { ...override, hintKey: 'thinkingCustomHint', automatic: 'omit', efforts: [] };
  const model = (settings.model ?? '').trim().toLowerCase();
  const profile = Object.hasOwn(modelProfiles, model) ? modelProfiles[model] : undefined;
  if (profile) return profile;
  // Preserve existing DeepSeek gateway aliases as well as direct endpoint use.
  if (settings.apiBase.toLowerCase().includes('deepseek') || model.includes('deepseek')) return deepseek;
  return generic;
}

export function resolveThinking(settings: ThinkingSettings) {
  const profile = resolveThinkingProfile(settings);
  const requested = settings.modelParameters?.thinking ?? 'auto';
  const mode = requested === 'auto' ? profile.automatic : requested;
  const effort = settings.modelParameters?.reasoningEffort ?? 'auto';
  let issue: 'thinkingCannotEnable' | 'thinkingCannotDisable' | 'thinkingEffortUnsupported' | null = null;
  if (mode === 'enabled' && profile.enabled === null) issue = 'thinkingCannotEnable';
  if (mode === 'disabled' && profile.disabled === null) issue = 'thinkingCannotDisable';
  const useEffort = profile.efforts.length > 0 && mode !== 'disabled' && effort !== 'auto';
  if (useEffort && !profile.efforts.includes(effort)) issue = 'thinkingEffortUnsupported';
  const patch: ThinkingPatch = {
    ...(mode === 'omit' ? {} : profile[mode]),
    ...(useEffort ? { reasoning_effort: effort } : {}),
  };
  return {
    profile, patch, issue,
    // Raise the automatic budget only for known/explicit thinking; user limits win.
    active: mode === 'enabled' || (mode === 'omit' && profile.disabled === null && profile.enabled !== null),
  };
}

export class ThinkingConfigurationError extends TapTranslateError {
  constructor(readonly messageKey: string) {
    super('MODEL_PARAMETERS_INVALID', { detail: messageKey });
  }
}

export function applyThinkingPatch(body: Record<string, unknown>, patch: ThinkingPatch): Record<string, unknown> {
  const result = { ...body };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}
