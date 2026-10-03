import { z } from 'zod';
import type { ModelParameters } from '../types';
import { thinkingOverrideSchema } from './thinking-override';

export const modelParametersSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.3),
  // Zero retains the existing automatic token estimate for each batch.
  maxTokens: z.number().int().min(0).max(1000000).default(0),
  topP: z.number().min(0).max(1).default(1),
  frequencyPenalty: z.number().min(-2).max(2).default(0),
  presencePenalty: z.number().min(-2).max(2).default(0),
  reasoningEffort: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).default('auto'),
  thinking: z.enum(['auto', 'enabled', 'disabled']).default('auto'),
  thinkingOverride: thinkingOverrideSchema.nullable().default(null),
  tokenLimitField: z.enum(['auto', 'max_tokens', 'max_completion_tokens']).default('auto'),
  systemPrompt: z.string().max(20000).default(''),
});

export function defaultModelParameters(): ModelParameters {
  return modelParametersSchema.parse({});
}
