import { z } from 'zod';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const reservedFields = new Set([
  'model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice',
  'response_format', 'max_tokens', 'max_completion_tokens',
]);
const safeKey = z.string().refine((key) => !unsafeKeys.has(key), 'Unsafe object key');
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(safeKey, jsonValue),
]));

export const thinkingPatchSchema = z.record(
  safeKey.refine((key) => !reservedFields.has(key), 'Cannot override request structure or token limits'),
  jsonValue,
).refine((patch) => JSON.stringify(patch).length <= 4096, 'Thinking parameters must fit within 4096 characters').nullable();

export const thinkingOverrideSchema = z.object({
  enabled: thinkingPatchSchema,
  disabled: thinkingPatchSchema,
}).strict();

/** UI text and imported settings share the same JSON contract. */
export function parseThinkingPatch(text: string) {
  return thinkingPatchSchema.parse(JSON.parse(text));
}
