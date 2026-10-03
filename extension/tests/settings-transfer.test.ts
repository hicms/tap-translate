import { describe, expect, it } from 'vitest';
import type { Settings } from '../lib/types';
import { parseSettings } from '../lib/settings/schema';
import { buildSettingsExport, prepareSettingsImport } from '../lib/settings/transfer';

function settings(): Settings {
  return parseSettings({
    schemaVersion: 4,
    connectionMode: 'direct',
    apiBase: 'https://api.example.com/v1',
    apiKey: 'private-key',
    model: 'model-a',
    targetLang: 'zh-CN',
    uiLocale: 'en',
    mode: 'bilingual',
    maxConcurrent: 3,
    batchSize: 6,
    customHeaders: { 'X-Token': 'private-header' },
    siteRules: [{ host: 'example.com', auto: true }],
    revision: 2,
  });
}

describe('settings export', () => {
  it('excludes both private credential classes by default', () => {
    const output = buildSettingsExport(settings(), {
      includeApiKey: false,
      includeCustomHeaders: false,
    });
    expect(output.apiKey).toBeUndefined();
    expect(output.customHeaders).toBeUndefined();
    expect(output.providers?.[0]?.apiKey).toBeUndefined();
    expect(output.providers?.[0]?.customHeaders).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('private-key');
    expect(JSON.stringify(output)).not.toContain('private-header');
    expect(output.siteRules).toEqual([{ host: 'example.com', auto: true }]);
  });

  it('includes each private class only when explicitly requested', () => {
    const output = buildSettingsExport(settings(), {
      includeApiKey: true,
      includeCustomHeaders: true,
    });
    expect(output.apiKey).toBe('private-key');
    expect(output.customHeaders).toEqual({ 'X-Token': 'private-header' });
    expect(output.providers?.[0]?.apiKey).toBe('private-key');
  });
});

describe('settings import preview', () => {
  it('imports v5 global scheduling into models and preserves explicit model scheduling', () => {
    const before = settings();
    const provider = before.providers[0]!;
    const imported = prepareSettingsImport({
      ...before, schemaVersion: 5, maxConcurrent: 4, batchSize: 11,
      providers: [{ ...provider, models: [
        { id: 'a', name: 'old', parameters: provider.models[0]!.parameters },
        { id: 'b', name: 'new', parameters: provider.models[0]!.parameters, maxConcurrent: 1, batchSize: 2 },
      ] }],
    });
    expect(imported.providers?.[0]?.models[0]).toMatchObject({ maxConcurrent: 4, batchSize: 11 });
    expect(imported.providers?.[0]?.models[1]).toMatchObject({ maxConcurrent: 1, batchSize: 2 });
  });

  it('rejects malformed active provider IDs before import', () => {
    expect(() => prepareSettingsImport({ activeProviderId: 42 })).toThrow();
    expect(() => prepareSettingsImport({ activeProviderId: '' })).toThrow();
  });

  it('patches only fields that are explicitly in the file', () => {
    const patch = prepareSettingsImport({
      connectionMode: 'proxy',
      apiBase: 'https://api.example.com/v1',
      targetLang: 'fr',
    });
    expect(patch).toEqual({
      connectionMode: 'proxy',
      apiBase: 'https://api.example.com/v1',
      targetLang: 'fr',
    });
    expect('apiKey' in patch).toBe(false);
    expect('customHeaders' in patch).toBe(false);
  });

  it('normalizes host-only site rules and rejects non-matching rules', () => {
    const patch = prepareSettingsImport({
      siteRules: [{ host: 'https://Example.com/', auto: true }],
    });
    expect(patch.siteRules).toEqual([{ host: 'example.com', auto: true }]);
    expect(() => prepareSettingsImport({
      siteRules: [{ host: '*.example.com' }],
    })).toThrow();
  });
});
