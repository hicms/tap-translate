import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, saveSettings } from '../lib/settings/storage';
import { buildSettingsExport, prepareSettingsImport } from '../lib/settings/transfer';
import { createDefaultSettings, providerFingerprint, SETTINGS_SCHEMA_VERSION } from '../lib/settings/schema';
import { buildPublicSessionConfig } from '../lib/settings/session-config';
import { configForFrame, withoutContentOverride } from '../lib/settings/frame-config';

function mockChromeStorage(initial?: {
  sync?: Record<string, unknown>;
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
}) {
  const sync = new Map<string, unknown>(Object.entries(initial?.sync ?? {}));
  const local = new Map<string, unknown>(Object.entries(initial?.local ?? {}));
  const session = new Map<string, unknown>(Object.entries(initial?.session ?? {}));
  let releaseLanguageWrite: (() => void) | undefined;
  const languageWriteStarted = new Promise<void>((resolve) => {
    releaseLanguageWrite = resolve;
  });
  let signalLanguageWrite: (() => void) | undefined;
  const waitForLanguageWrite = new Promise<void>((resolve) => {
    signalLanguageWrite = resolve;
  });

  const read = (store: Map<string, unknown>, keys?: string | string[] | Record<string, unknown>) => {
    if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
    }
    return { ...(keys ?? {}), ...Object.fromEntries(store) };
  };
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(session, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => { for (const [key, value] of Object.entries(patch)) session.set(key, value); }),
        remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key); }),
      },
      sync: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(sync, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          if (patch.targetLang === 'fr') {
            signalLanguageWrite?.();
            await languageWriteStarted;
          }
          for (const [key, value] of Object.entries(patch)) sync.set(key, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) sync.delete(key);
        }),
      },
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(local, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(patch)) local.set(key, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) local.delete(key);
        }),
      },
    },
  });

  return {
    releaseLanguageWrite: () => releaseLanguageWrite?.(),
    waitForLanguageWrite,
    sync,
    local,
    session,
  };
}

describe('settings storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('migrates content defaults, persists overrides locally and changes only the requested fields', async () => {
    const storage = mockChromeStorage({ sync: { schemaVersion: 6, siteRules: [{ host: 'example.com', auto: true, mode: 'replace' }] } });
    const before = await getSettings();
    expect(before.siteContentRules).toEqual([]);
    expect(storage.local.get('siteContentRules')).toEqual([]);
    const rules = [{ host: 'example.com', content: [], ignore: ['.skip'] }];
    const saved = await saveSettings({ siteContentRules: rules });
    expect(saved.revision).toBe(before.revision + 1);
    expect(storage.local.get('siteContentRules')).toEqual(rules);
    expect(storage.sync.has('siteContentRules')).toBe(false);
    expect(saved.providers).toEqual(before.providers);
    expect(saved.siteRules).toEqual(before.siteRules);
    expect((await getSettings()).siteContentRules).toEqual(rules);
    expect((await saveSettings({ siteContentRules: rules })).revision).toBe(saved.revision);
    expect((await saveSettings({ siteContentRules: [] })).siteRules).toEqual(before.siteRules);
  });

  it('exports only overrides and an old import preserves existing content rules', async () => {
    mockChromeStorage();
    const rules = [{ host: 'github.com', ignore: [] }];
    const saved = await saveSettings({ siteContentRules: rules });
    const exported = buildSettingsExport(saved, { includeApiKey: false, includeCustomHeaders: false });
    expect(exported.siteContentRules).toEqual(rules);
    expect(prepareSettingsImport(exported).siteContentRules).toEqual(rules);
    const old = prepareSettingsImport({ mode: 'replace' });
    expect(old).not.toHaveProperty('siteContentRules');
    expect((await saveSettings(old)).siteContentRules).toEqual(rules);
  });

  it('rejects invalid shapes and surfaces failed local writes', async () => {
    mockChromeStorage();
    await getSettings();
    await expect(saveSettings({ siteContentRules: [{ host: 'example.com', content: [4] as unknown as string[] }] })).rejects.toThrow();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Local storage full'));
    await expect(saveSettings({ siteContentRules: [{ host: 'example.com', content: [] }] })).rejects.toThrow('Local storage full');
  });

  it('sends only a frame override, strips it before broadcast, and rejects forged frame host selection', async () => {
    const settings = createDefaultSettings();
    settings.apiKey = 'TOP-SECRET'; settings.customHeaders = { Secret: 'SECRET-HEADER' };
    settings.siteContentRules = [{ host: 'example.com', content: ['.top'] }, { host: 'frame.test', ignore: ['.private'] }];
    settings.siteRules = [{ host: 'frame.test', disabled: true }];
    const top = await buildPublicSessionConfig(settings, 'example.com');
    expect(top.siteContentRule).toEqual(settings.siteContentRules[0]);
    expect(JSON.stringify(top)).not.toMatch(/TOP-SECRET|SECRET-HEADER|frame.test|apiKey|customHeaders/);
    expect(withoutContentOverride(top).siteContentRule).toEqual({ host: 'example.com' });
    const child = await configForFrame(settings, 'https://frame.test/path', { action: 'getFrameSessionConfig', host: 'example.com', sessionId: 'frame', mode: 'replace', targetLang: 'fr' });
    expect(child.siteContentRule).toEqual(settings.siteContentRules[1]);
    expect(child.disabled).toBe(true);
    expect(child.mode).toBe(settings.mode);
    await expect(configForFrame(settings, 'chrome://settings', { action: 'getFrameSessionConfig', sessionId: 'frame', mode: 'replace', targetLang: 'fr' })).rejects.toThrow();
  });

  it('migrates local model scheduling even when sync already has the current schema', async () => {
    const provider = createDefaultSettings().providers[0]!;
    const storage = mockChromeStorage({
      sync: { schemaVersion: SETTINGS_SCHEMA_VERSION, maxConcurrent: 4, batchSize: 10 },
      local: { providers: [{ ...provider, models: [{ id: 'legacy-model', name: 'old', parameters: provider.models[0]!.parameters }] }] },
    });
    const settings = await getSettings();
    expect(settings.providers[0]!.models[0]).toMatchObject({ maxConcurrent: 4, batchSize: 10 });
    expect(storage.local.get('providers')).toMatchObject([{ models: [{ maxConcurrent: 4, batchSize: 10 }] }]);
    storage.sync.set('maxConcurrent', 8);
    storage.sync.set('batchSize', 20);
    expect(await getSettings()).toMatchObject({ maxConcurrent: 4, batchSize: 10 });
  });

  it('uses the active model schedule for real sessions and legacy patches affect only that model', async () => {
    mockChromeStorage();
    const initial = await getSettings();
    const provider = initial.providers[0]!;
    provider.models = [
      { ...provider.models[0]!, id: 'fast', maxConcurrent: 5, batchSize: 12 },
      { ...provider.models[0]!, id: 'slow', maxConcurrent: 1, batchSize: 2 },
    ];
    provider.activeModelId = 'slow';
    await saveSettings({ providers: [provider] });
    const selected = await getSettings();
    expect(await buildPublicSessionConfig(selected, 'example.com')).toMatchObject({ maxConcurrent: 1, batchSize: 2 });
    await saveSettings({ maxConcurrent: 2, batchSize: 4 });
    const patched = await getSettings();
    expect(patched.providers[0]!.models[0]).toMatchObject({ maxConcurrent: 5, batchSize: 12 });
    expect(patched.providers[0]!.models[1]).toMatchObject({ maxConcurrent: 2, batchSize: 4 });
    expect(patched.revision).toBeGreaterThan(selected.revision);
    expect(await providerFingerprint(patched)).toBe(await providerFingerprint(selected));
    await expect(saveSettings({ batchSize: 21 })).rejects.toThrow();
    expect((await getSettings()).batchSize).toBe(4);
    patched.providers[0]!.activeModelId = 'fast';
    await saveSettings({ providers: patched.providers });
    expect(await buildPublicSessionConfig(await getSettings(), 'example.com')).toMatchObject({ maxConcurrent: 5, batchSize: 12 });
    const exported = buildSettingsExport(await getSettings(), { includeApiKey: false, includeCustomHeaders: false });
    await saveSettings(prepareSettingsImport(exported));
    expect((await getSettings()).providers[0]!.models).toMatchObject([
      { maxConcurrent: 5, batchSize: 12 }, { maxConcurrent: 2, batchSize: 4 },
    ]);
  });

  it('preserves a site rule when an unrelated save completes later', async () => {
    const storage = mockChromeStorage();

    const languageSave = saveSettings({ targetLang: 'fr' });
    await storage.waitForLanguageWrite;
    await saveSettings({ siteRules: [{ host: 'example.com', auto: true }] });
    storage.releaseLanguageWrite();
    await languageSave;

    const settings = await getSettings();
    expect(settings.targetLang).toBe('fr');
    expect(settings.siteRules).toEqual([{ host: 'example.com', auto: true }]);
  });

  it('migrates legacy synced custom headers to local storage once', async () => {
    const storage = mockChromeStorage({
      sync: { customHeaders: { 'X-Token': 'secret' } },
    });

    const settings = await getSettings();

    expect(settings.customHeaders).toEqual({ 'X-Token': 'secret' });
    expect(storage.local.get('customHeaders')).toEqual({ 'X-Token': 'secret' });
    expect(storage.sync.has('customHeaders')).toBe(false);
  });

  it('keeps local custom headers authoritative and never syncs a new value', async () => {
    const storage = mockChromeStorage({
      sync: { customHeaders: { 'X-Old': 'legacy' } },
      local: { customHeaders: { 'X-Local': 'device-only' } },
    });

    await saveSettings({ customHeaders: { 'X-New': 'private' } });
    const settings = await getSettings();

    expect(settings.customHeaders).toEqual({ 'X-New': 'private' });
    expect(storage.local.get('customHeaders')).toEqual({ 'X-New': 'private' });
    expect(storage.sync.has('customHeaders')).toBe(false);
  });

  it('isolates multiple provider credentials, preserves session-only keys and switches the real model', async () => {
    const storage = mockChromeStorage();
    const initial = await getSettings();
    const first = { ...initial.providers[0]!, apiKey: 'persistent-key', customHeaders: { 'X-Secret': 'header-secret' } };
    const second = { ...first, id: 'session-provider', name: 'Session', apiKey: 'session-secret', persistApiKey: false, apiBase: 'https://other.example/v1' };
    await saveSettings({ providers: [first, second], activeProviderId: second.id });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('session-secret');
    expect(settings.apiBase).toBe('https://other.example/v1');
    expect(JSON.stringify(Object.fromEntries(storage.sync))).not.toMatch(/persistent-key|session-secret|header-secret/);
    expect(JSON.stringify(Object.fromEntries(storage.local))).not.toContain('session-secret');
    expect(storage.sync.has('providers')).toBe(false);
    await saveSettings({ activeProviderId: first.id });
    expect((await getSettings()).apiKey).toBe('persistent-key');
    storage.session.clear();
    await saveSettings({ activeProviderId: second.id });
    expect((await getSettings()).apiKey).toBe('');
  });

  it('keeps all provider credentials when importing a public export on the same device', async () => {
    mockChromeStorage();
    await saveSettings({ apiKey: 'keep-key', customHeaders: { 'X-Key': 'keep-header' } });
    const settings = await getSettings();
    const imported = prepareSettingsImport(buildSettingsExport(settings, { includeApiKey: false, includeCustomHeaders: false }));
    await saveSettings(imported);
    expect((await getSettings()).apiKey).toBe('keep-key');
    expect((await getSettings()).customHeaders).toEqual({ 'X-Key': 'keep-header' });
  });

  it('preserves local providers when another device syncs legacy settings', async () => {
    const storage = mockChromeStorage();
    const initial = await getSettings();
    const first = { ...initial.providers[0]!, apiKey: 'first-key' };
    const second = { ...first, id: 'second-provider', name: 'Second', apiBase: 'https://other.example/v1', apiKey: 'second-key' };
    await saveSettings({ providers: [first, second], activeProviderId: second.id });
    storage.sync.set('schemaVersion', 4);
    storage.sync.set('apiBase', 'https://api.deepseek.com/v1');
    storage.sync.set('model', 'deepseek-chat');

    const settings = await getSettings();
    expect(settings.providers.map((provider) => provider.id)).toEqual([first.id, second.id]);
    expect(settings.activeProviderId).toBe(second.id);
    expect(settings.apiBase).toBe(second.apiBase);
    expect(settings.apiKey).toBe('second-key');
    expect(settings.providers[0]!.apiKey).toBe('first-key');
    expect((await getSettings()).providers).toEqual(settings.providers);
  });

  it('rejects an invalid save without replacing providers or credentials', async () => {
    const storage = mockChromeStorage();
    await saveSettings({ apiKey: 'keep-key' });
    const before = await getSettings();
    const persistedBefore = JSON.stringify(Object.fromEntries(storage.local));
    await expect(saveSettings({ activeProviderId: 42 } as never)).rejects.toThrow();
    await expect(saveSettings({ providers: [{ ...before.providers[0]!, apiBase: 'http://unsafe.example/v1' }] })).rejects.toThrow();
    expect(JSON.stringify(Object.fromEntries(storage.local))).toBe(persistedBefore);
    expect(await getSettings()).toEqual(before);
  });
});
