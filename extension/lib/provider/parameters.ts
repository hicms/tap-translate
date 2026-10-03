import type { ModelParameters } from '../types';
import { defaultModelParameters } from '../settings/model-parameters';
import { isMiniMaxApiBase } from './presets';
import { applyThinkingPatch, resolveThinking, ThinkingConfigurationError } from './thinking';

export function applyModelParameters(
  body: Record<string, unknown>,
  settings: { apiBase: string; model?: string; modelParameters?: ModelParameters },
  automaticTokenLimit: number,
): Record<string, unknown> {
  const params = settings.modelParameters ?? defaultModelParameters();
  const thinking = resolveThinking(settings);
  if (thinking.issue) throw new ThinkingConfigurationError(thinking.issue);
  const tokenField = params.tokenLimitField === 'auto'
    ? (isMiniMaxApiBase(settings.apiBase) ? 'max_completion_tokens' : 'max_tokens')
    : params.tokenLimitField;
  const configured = {
    ...body,
    temperature: params.temperature,
    [tokenField]: params.maxTokens || Math.max(automaticTokenLimit, thinking.active ? 4096 : 0),
    ...(params.topP !== 1 ? { top_p: params.topP } : {}),
    ...(params.frequencyPenalty !== 0 ? { frequency_penalty: params.frequencyPenalty } : {}),
    ...(params.presencePenalty !== 0 ? { presence_penalty: params.presencePenalty } : {}),
  };
  return applyThinkingPatch(configured, thinking.patch);
}
