import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFullBackup, parseFullBackup, parseImportFile, restoreFullBackup, BackupRestoreError } from '../lib/settings/backup';
import { getSettings, saveSettings } from '../lib/settings/storage';
import { buildSettingsExport } from './helpers/legacy-settings-export';
import { readOnboardingSnapshot, replaceOnboardingSnapshot } from '../lib/settings/onboarding';
import { clearMemoryCache, exportCacheSnapshot, lookup, parseCacheSnapshot, store } from '../lib/cache';
import { buildPublicSessionConfig } from '../lib/settings/session-config';
import { resolveContentPolicy } from '../lib/sites/policy';
import { optionsDraft } from '../entrypoints/options/draft';
import { mockChromeStorage } from './helpers/settings-storage';

function browser() {
  const data = mockChromeStorage();
  Object.assign(chrome, {
    extension: { inIncognitoContext: false },
    runtime: { getManifest: () => ({ version: '0.1.2' }) },
    permissions: {
      getAll: vi.fn(async () => ({ origins: ['https://example.com/*'], permissions: ['storage'] })),
      request: vi.fn(async () => true),
    },
  });
  return data;
}

async function populated() {
  browser();
  const settings = await getSettings();
  const provider = settings.providers[0]!;
  await saveSettings({
    providers: [
      { ...provider, apiKey: 'persistent', customHeaders: { 'X-Auth': 'header' } },
      { ...provider, id: 'session-provider', apiKey: 'session-key', persistApiKey: false,
        models: [{ ...provider.models[0]!, parameters: { ...provider.models[0]!.parameters, systemPrompt: 'Translate precisely.' }, maxConcurrent: 7, batchSize: 18 }] },
    ], activeProviderId: 'session-provider',
    siteContentRules: Array.from({ length: 200 }, (_, index) => ({ host: `site${index}.example`, ignore: ['.private'] })),
    siteRules: [{ host: 'example.com', auto: true, mode: 'replace' }],
  });
  await replaceOnboardingSnapshot({ completed: true, completedAt: 12345, path: 'direct' });
  await store([{ text: 'Hello', translation: '你好' }], { targetLang: 'zh-CN', providerFingerprint: 'backup-test' });
  return createFullBackup();
}

afterEach(() => { clearMemoryCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('full backup', () => {
  it('exports cached translations with local metadata without mutating storage and restores them on another device', async () => {
    const before = await populated();
    const [key, entry] = Object.entries(before.cache)[0]!;
    const stored = { ...entry, epoch: 7 };
    await chrome.storage.local.set({ [key]: stored });
    const exported = await createFullBackup();
    expect(exported.cache).toEqual(before.cache);
    expect((await chrome.storage.local.get(key))[key]).toEqual(stored);
    expect(() => parseCacheSnapshot({ [key]: stored })).toThrow();
    browser();
    clearMemoryCache();
    await restoreFullBackup(parseFullBackup(JSON.parse(JSON.stringify(exported))));
    expect(await lookup(['Hello'], { targetLang: 'zh-CN', providerFingerprint: 'backup-test' })).toEqual(['你好']);
  });

  it('restores all data to an empty device, including 200 custom hosts and session credentials', async () => {
    const backup = await populated();
    const target = browser();
    const saved = await restoreFullBackup(parseFullBackup(JSON.parse(JSON.stringify(backup))));
    expect(saved.providers).toEqual(backup.settings.providers);
    expect((await getSettings()).siteContentRules).toHaveLength(200);
    expect(saved.builtinSiteProfiles!.length).toBeGreaterThan(0);
    expect(await readOnboardingSnapshot()).toEqual(backup.onboarding);
    expect(await exportCacheSnapshot()).toEqual(backup.cache);
    expect(await lookup(['Hello'], { targetLang: 'zh-CN', providerFingerprint: 'backup-test' })).toEqual(['你好']);
    expect(JSON.stringify(Object.fromEntries(target.local))).not.toContain('session-key');
    expect(JSON.stringify(Object.fromEntries(target.session))).toContain('session-key');
    expect(JSON.stringify(Object.fromEntries(target.sync))).not.toMatch(/persistent|session-key|X-Auth|builtinSiteProfiles/);
  });

  it('uses restored built-ins for both editor and per-frame policy, and retains custom precedence', async () => {
    const backup = await populated();
    backup.settings.builtinSiteProfiles = [{ id: 'old', hosts: ['old.example'], content: ['.old-content'], ignore: ['.old-ignore'] }];
    backup.settings.siteContentRules = [{ host: 'old.example', ignore: [] }];
    const saved = await restoreFullBackup(parseFullBackup(backup));
    const draft = optionsDraft(saved);
    expect(draft.sites.find(site => site.host === 'old.example')?.builtin).toBe(true);
    expect(draft.sites.some(site => site.host === 'github.com')).toBe(false);
    const config = await buildPublicSessionConfig(saved, 'old.example');
    expect(resolveContentPolicy('old.example', config.siteContentRule, config.siteProfile)).toEqual({ content: { mode: 'selectors', selectors: ['.old-content'] }, ignore: [] });
    const github = await buildPublicSessionConfig(saved, 'github.com');
    expect(resolveContentPolicy('github.com', github.siteContentRule, github.siteProfile).content.mode).toBe('generic');
    expect(buildSettingsExport(saved, { includeApiKey: false, includeCustomHeaders: false }).builtinSiteProfiles).toEqual(saved.builtinSiteProfiles);
    const old = parseImportFile('{"mode":"replace"}');
    if (old.kind !== 'settings') throw new Error('Expected legacy settings');
    expect((await saveSettings(old.settings)).builtinSiteProfiles).toEqual(saved.builtinSiteProfiles);
    const reset = parseImportFile('{"builtinSiteProfiles":null}');
    if (reset.kind !== 'settings') throw new Error('Expected settings');
    expect((await saveSettings(reset.settings)).builtinSiteProfiles).toBeNull();
  });

  it.each(['version', 'schema', 'credentials', 'missing', 'origin', 'cache', 'model', 'mode'])('rejects damaged %s before writes', async damage => {
    const backup = await populated();
    const raw = JSON.parse(JSON.stringify(backup));
    if (damage === 'version') raw.version = 2;
    if (damage === 'schema') raw.settings.schemaVersion = 999;
    if (damage === 'credentials') delete raw.settings.providers[0].apiKey;
    if (damage === 'missing') delete raw.onboarding;
    if (damage === 'origin') raw.permissions.origins = ['file:///*'];
    if (damage === 'cache') raw.cache = { providers: { t: 'injected', at: Date.now(), b: 8 } };
    if (damage === 'model') delete raw.settings.providers[0].models[0].parameters;
    if (damage === 'mode') raw.settings.mode = 'unknown';
    vi.mocked(chrome.storage.local.set).mockClear();
    expect(() => parseImportFile(JSON.stringify(raw))).toThrow();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('requests permission in the click call stack and denial writes nothing', async () => {
    const backup = await populated();
    vi.mocked(chrome.storage.local.set).mockClear();
    Object.assign(chrome.permissions, { request: vi.fn(async () => false) });
    const restoring = restoreFullBackup(backup);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: backup.permissions.origins });
    await expect(restoring).rejects.toThrow('no data changed');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it.each(['session', 'meta', 'onboarding'])('propagates %s read failure instead of producing an incomplete backup or restore', async area => {
    const backup = await populated();
    const original = vi.mocked(chrome.storage.local.get).getMockImplementation()! as unknown as (keys: unknown) => Promise<Record<string, unknown>>;
    if (area === 'session') vi.mocked(chrome.storage.session.get).mockRejectedValue(new Error('Session unavailable'));
    else vi.mocked(chrome.storage.local.get).mockImplementation((async (keys: unknown) => {
      if (JSON.stringify(keys).includes(area === 'meta' ? 'tapTranslateSettingsMeta' : 'tapTranslateOnboarding')) throw new Error('Local unavailable');
      return original(keys);
    }) as unknown as typeof chrome.storage.local.get);
    vi.mocked(chrome.storage.local.set).mockClear();
    await expect(createFullBackup()).rejects.toThrow('unavailable');
    await expect(restoreFullBackup(backup)).rejects.toThrow('unavailable');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('rolls back settings, onboarding and cache after a cache write failure', async () => {
    const backup = await populated();
    const before = await getSettings();
    const previousCache = await exportCacheSnapshot();
    backup.cache = { [`dr:c3:${'b'.repeat(64)}`]: { t: 'replacement', at: Date.now(), b: 11 } };
    backup.settings.uiLocale = 'fr';
    backup.onboarding = { completed: false };
    const set = vi.mocked(chrome.storage.local.set).getMockImplementation()! as unknown as (patch: object) => Promise<void>;
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(set);
    let failed = false;
    vi.mocked(chrome.storage.local.set).mockImplementation((async patch => {
      if (!failed && Object.keys(patch).some(key => key.startsWith('dr:c3:'))) { failed = true; throw new Error('Disk full'); }
      return set(patch);
    }) as typeof chrome.storage.local.set);
    await expect(restoreFullBackup(backup)).rejects.toThrow('previous data restored');
    const after = await getSettings();
    expect({ ...after, revision: before.revision }).toEqual(before);
    expect(await readOnboardingSnapshot()).toEqual({ completed: true, completedAt: 12345, path: 'direct' });
    expect(await exportCacheSnapshot()).toEqual(previousCache);
  });

  it('reports both the original error and failed compensation', async () => {
    const backup = await populated();
    vi.mocked(chrome.storage.local.set).mockRejectedValue(new Error('Disk offline'));
    const error = await restoreFullBackup(backup).catch(error => error);
    expect(error).toBeInstanceOf(BackupRestoreError);
    expect(error.rollbackFailures.length).toBeGreaterThan(0);
    expect(error.message).toContain('rollback incomplete');
  });

  it('waits for outstanding settings writes before rolling back', async () => {
    const backup = await populated();
    const before = await getSettings();
    backup.settings.providers[0]!.name = 'Imported';
    const set = vi.mocked(chrome.storage.local.set).getMockImplementation()! as unknown as (patch: Record<string, unknown>) => Promise<void>;
    let release!: () => void;
    let signal!: () => void;
    const started = new Promise<void>(resolve => { signal = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let blockedOnce = false;
    vi.mocked(chrome.storage.local.set).mockImplementation((async patch => {
      if (patch.providers && !blockedOnce) { blockedOnce = true; signal(); await delayed; }
      return set(patch);
    }) as typeof chrome.storage.local.set);
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('Sync unavailable'));
    let settled = false;
    const result = restoreFullBackup(backup).catch(error => { settled = true; return error; });
    await started;
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await result).message).toContain('previous data restored');
    expect((await getSettings()).providers).toEqual(before.providers);
  });

  it('never exports or restores private-window cache to disk', async () => {
    const backup = await populated();
    Object.assign(chrome.extension, { inIncognitoContext: true });
    expect((await createFullBackup()).cache).toEqual({});
    await expect(restoreFullBackup(backup)).rejects.toThrow('private window');
  });

  it('drops expired cache without renewing timestamps and refuses oversized payloads', () => {
    const key = `dr:c3:${'a'.repeat(64)}`;
    expect(parseCacheSnapshot({ [key]: { t: 'old', at: 1, b: 3 } })).toEqual({});
    expect(() => parseCacheSnapshot({ [key]: { t: 'x'.repeat(4 * 1024 * 1024 + 1), at: Date.now(), b: 1 } })).toThrow('limits');
    expect(() => parseImportFile(' '.repeat(20 * 1024 * 1024 + 1))).toThrow('20 MiB');
  });
});
