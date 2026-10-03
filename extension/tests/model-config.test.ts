import { describe, expect, it } from 'vitest';
import { parseSettings, providerAffectingChanged, providerFingerprint } from '../lib/settings/schema';
import { defaultModelParameters } from '../lib/settings/model-parameters';
import { applyModelParameters } from '../lib/provider/parameters';

describe('provider/model settings', () => {
  it('migrates global scheduling to old models while preserving model-specific values', () => {
    const initial = parseSettings({});
    const provider = initial.providers[0]!;
    const migrated = parseSettings({
      ...initial, schemaVersion: 5, maxConcurrent: 5, batchSize: 12,
      providers: [{ ...provider, models: [
        { id: 'old', name: 'old-model', parameters: defaultModelParameters() },
        { id: 'new', name: 'new-model', parameters: defaultModelParameters(), maxConcurrent: 1, batchSize: 2 },
      ], activeModelId: 'new' }],
    });
    expect(migrated.providers[0]!.models[0]).toMatchObject({ maxConcurrent: 5, batchSize: 12 });
    expect(migrated.providers[0]!.models[1]).toMatchObject({ maxConcurrent: 1, batchSize: 2 });
    expect(migrated).toMatchObject({ maxConcurrent: 1, batchSize: 2 });
  });

  it('migrates a v4 connection without losing its key, headers or model', () => {
    const settings = parseSettings({ schemaVersion: 4, apiBase: 'https://example.com/v1', apiKey: 'secret', model: 'my-model', customHeaders: { 'X-Key': 'value' }, maxConcurrent: 2, batchSize: 9 });
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0]).toMatchObject({ apiKey: 'secret', customHeaders: { 'X-Key': 'value' }, activeModelId: 'legacy-model' });
    expect(settings.providers[0]!.models[0]!.name).toBe('my-model');
    expect(settings.providers[0]!.models[0]).toMatchObject({ maxConcurrent: 2, batchSize: 9 });
    expect(settings.modelParameters.temperature).toBe(0.3);
  });

  it('resolves the active provider and model over stale legacy fields', () => {
    const initial = parseSettings({ apiKey: 'original' });
    const second = {
      ...initial.providers[0]!, id: 'second', apiBase: 'https://other.example/v1', apiKey: 'second-key',
      models: [{ id: 'a', name: 'one', parameters: defaultModelParameters() }, { id: 'b', name: 'two', parameters: { ...defaultModelParameters(), temperature: 0.8 } }],
      activeModelId: 'b',
    };
    const selected = parseSettings({ ...initial, providers: [...initial.providers, second], activeProviderId: 'second' });
    expect(selected).toMatchObject({ apiBase: second.apiBase, apiKey: 'second-key', model: 'two', modelParameters: { temperature: 0.8 } });
    expect(selected.providers[0]!.apiKey).toBe('original');
  });

  it('invalidates cache identity when model instructions or parameters change', async () => {
    const before = parseSettings({});
    const after = { ...before, modelParameters: { ...before.modelParameters, systemPrompt: 'Use formal language.' } };
    expect(providerAffectingChanged(before, after)).toBe(true);
    expect(await providerFingerprint(before)).not.toBe(await providerFingerprint(after));
  });

  it('handles invalid imported provider URLs without throwing out of parseSettings', () => {
    const settings = parseSettings({});
    settings.providers[0]!.apiBase = 'http://remote.example/v1';
    expect(parseSettings(settings).apiBase).toBe('https://api.deepseek.com');
  });
});

describe('model request parameters', () => {
  it('sends explicit model controls and lets enabled thinking override DeepSeek defaults', () => {
    const body = applyModelParameters({ model: 'deepseek', messages: [] }, {
      apiBase: 'https://api.deepseek.com', model: 'deepseek',
      modelParameters: { ...defaultModelParameters(), temperature: 0.7, topP: 0.9, maxTokens: 4096, frequencyPenalty: 0.2, presencePenalty: -0.5, reasoningEffort: 'high', thinking: 'enabled', tokenLimitField: 'max_completion_tokens' },
    }, 1024);
    expect(body).toMatchObject({ temperature: 0.7, top_p: 0.9, max_completion_tokens: 4096, frequency_penalty: 0.2, presence_penalty: -0.5, reasoning_effort: 'high', thinking: { type: 'enabled' } });
    expect(body.max_tokens).toBeUndefined();
  });
});
