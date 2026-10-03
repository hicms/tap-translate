import type { Settings, SiteRule, TranslationMode, TargetLang, ProviderConfig } from '../types';
import {
  createDefaultSettings,
  normalizeCustomHeaders,
  normalizeTargetLang,
  parseSettings,
  validateSettings,
  providerAffectingChanged,
  SETTINGS_SCHEMA_VERSION,
} from './schema';

// Secrets never belong in chrome.storage.sync (it replicates to the signed-in
// account across devices). They live in chrome.storage.local instead.
export const SECRET_KEYS = ['apiKey'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];
/** Credentials often live in custom headers; never replicate them through sync. */
export const DEVICE_LOCAL_KEYS = ['customHeaders', 'providers', 'activeProviderId', 'modelParameters', 'siteContentRules'] as const;
type DeviceLocalKey = (typeof DEVICE_LOCAL_KEYS)[number];

const META_LOCAL_KEY = 'tapTranslateSettingsMeta';
const PROVIDER_SECRETS_KEY = 'tapTranslateProviderSecrets';
const PROVIDER_SESSION_KEYS = 'tapTranslateProviderSessionKeys';
const PROVIDER_SCHEMA_KEY = 'tapTranslateProviderSchemaVersion';

interface ProviderSecrets { apiKey: string; customHeaders: Record<string, string> }

export function publicProviders(providers: ProviderConfig[]) {
  return providers.map(({ apiKey: _apiKey, customHeaders: _headers, ...provider }) => provider);
}

async function persistProviders(settings: Settings): Promise<void> {
  const secrets: Record<string, ProviderSecrets> = {};
  const sessionKeys: Record<string, string> = {};
  for (const provider of settings.providers) {
    const persist = provider.persistApiKey || !chrome.storage.session;
    secrets[provider.id] = {
      apiKey: persist ? provider.apiKey : '', customHeaders: provider.customHeaders,
    };
    if (!persist) sessionKeys[provider.id] = provider.apiKey;
  }
  const active = settings.providers.find((provider) => provider.id === settings.activeProviderId)!;
  await chrome.storage.local.set({
    providers: publicProviders(settings.providers),
    [PROVIDER_SCHEMA_KEY]: SETTINGS_SCHEMA_VERSION,
    activeProviderId: settings.activeProviderId,
    modelParameters: settings.modelParameters,
    [PROVIDER_SECRETS_KEY]: secrets,
    apiKey: secrets[active.id]!.apiKey,
    customHeaders: active.customHeaders,
  });
  if (chrome.storage.session) await chrome.storage.session.set({
    [PROVIDER_SESSION_KEYS]: sessionKeys, apiKey: sessionKeys[active.id] || '',
  });
}

interface SettingsMeta {
  revision: number;
}

function isSecret(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

function isDeviceLocal(key: string): key is DeviceLocalKey {
  return (DEVICE_LOCAL_KEYS as readonly string[]).includes(key);
}

function splitPersistence(settings: Partial<Settings>): {
  secrets: Partial<Pick<Settings, SecretKey>>;
  deviceLocal: Partial<Pick<Settings, DeviceLocalKey>>;
  syncable: Record<string, unknown>;
} {
  const secrets: Partial<Pick<Settings, SecretKey>> = {};
  const deviceLocal: Partial<Pick<Settings, DeviceLocalKey>> = {};
  const syncable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isSecret(key)) (secrets as Record<string, unknown>)[key] = value;
    else if (isDeviceLocal(key)) (deviceLocal as Record<string, unknown>)[key] = value;
    else syncable[key] = key === 'providers' ? publicProviders(value as ProviderConfig[]) : value;
  }
  return { secrets, deviceLocal, syncable };
}

async function readMeta(): Promise<SettingsMeta> {
  try {
    const stored = await chrome.storage.local.get({ [META_LOCAL_KEY]: { revision: 0 } });
    const meta = stored[META_LOCAL_KEY] as SettingsMeta;
    return { revision: Number(meta?.revision) || 0 };
  } catch {
    return { revision: 0 };
  }
}

async function writeMeta(meta: SettingsMeta): Promise<void> {
  await chrome.storage.local.set({ [META_LOCAL_KEY]: meta });
}

export async function getSettings(): Promise<Settings> {
  const defaults = createDefaultSettings();
  const syncDefaults: Record<string, unknown> = { ...defaults };
  for (const key of [...SECRET_KEYS, ...DEVICE_LOCAL_KEYS]) delete syncDefaults[key];
  // revision / schemaVersion live across sync+local meta; don't require sync defaults.
  delete syncDefaults.revision;
  syncDefaults.providers = null;

  // Also request apiKey from sync purely to detect and migrate legacy data.
  const [syncStored, legacyHeadersStored, localStored] = await Promise.all([
    chrome.storage.sync.get({ ...syncDefaults, apiKey: '' }),
    chrome.storage.sync.get('customHeaders'),
    chrome.storage.local.get([...SECRET_KEYS, ...DEVICE_LOCAL_KEYS, PROVIDER_SECRETS_KEY, PROVIDER_SCHEMA_KEY]),
  ]);
  const meta = await readMeta();

  let apiKey: string = (localStored.apiKey as string) || '';
  const legacyKey = (syncStored.apiKey as string) || '';
  if (!apiKey && legacyKey) {
    apiKey = legacyKey;
    await chrome.storage.local.set({ apiKey });
  }
  if (!apiKey && chrome.storage.session) {
    try {
      const sessionStored = await chrome.storage.session.get({ apiKey: '' });
      apiKey = (sessionStored.apiKey as string) || '';
    } catch {
      /* session storage unavailable */
    }
  }
  if (legacyKey) await chrome.storage.sync.remove('apiKey');

  const hasLocalHeaders = Object.prototype.hasOwnProperty.call(localStored, 'customHeaders');
  const localHeaders = normalizeCustomHeaders(localStored.customHeaders);
  const legacyHeaders = normalizeCustomHeaders(legacyHeadersStored.customHeaders);
  const customHeaders = hasLocalHeaders ? localHeaders : legacyHeaders;
  if (!hasLocalHeaders && Object.keys(legacyHeaders).length) {
    await chrome.storage.local.set({ customHeaders });
  }
  if (Object.prototype.hasOwnProperty.call(legacyHeadersStored, 'customHeaders')) {
    await chrome.storage.sync.remove('customHeaders');
  }

  // Provider configuration belongs to this device. A legacy client can sync an
  // older global schema version without invalidating the local provider list.
  let providers = localStored.providers ?? syncStored.providers;
  if (Array.isArray(providers)) {
    const secrets = (localStored[PROVIDER_SECRETS_KEY] ?? {}) as Record<string, ProviderSecrets>;
    const sessionStored: Record<string, unknown> = chrome.storage.session
      ? await chrome.storage.session.get(PROVIDER_SESSION_KEYS).catch(() => ({}))
      : {};
    const sessionKeys = (sessionStored[PROVIDER_SESSION_KEYS] ?? {}) as Record<string, string>;
    providers = providers.map((provider: ProviderConfig) => ({
      ...provider,
      apiKey: secrets[provider.id]?.apiKey || sessionKeys[provider.id] || '',
      customHeaders: secrets[provider.id]?.customHeaders ?? {},
    }));
  }
  const merged = {
    ...syncStored,
    ...(providers ? { providers } : {}),
    activeProviderId: localStored.activeProviderId ?? syncStored.activeProviderId ?? defaults.activeProviderId,
    apiKey,
    customHeaders,
    siteContentRules: localStored.siteContentRules ?? [],
    revision: meta.revision || Number(syncStored.revision) || 0,
  };
  const settings = parseSettings(merged);
  if (!Array.isArray(providers) && apiKey && !localStored.apiKey && !legacyKey) {
    settings.providers[0]!.persistApiKey = false;
  }

  // Persist schema migration once (idempotent). Avoid rewriting targetLang on every read.
  const needsSchemaWrite = syncStored.schemaVersion !== settings.schemaVersion
    || localStored[PROVIDER_SCHEMA_KEY] !== SETTINGS_SCHEMA_VERSION
    || syncStored.uiLocale == null || !Array.isArray(providers);
  if (needsSchemaWrite) {
    const { syncable } = splitPersistence(settings);
    await persistProviders(settings);
    await chrome.storage.local.set({ siteContentRules: settings.siteContentRules });
    await chrome.storage.sync.set(syncable);
  }
  if (meta.revision !== settings.revision) {
    await writeMeta({ revision: settings.revision });
  }

  return settings;
}

/** Whether the current API key is persisted beyond the active browser session. */
export async function isApiKeyPersisted(): Promise<boolean> {
  const stored = await chrome.storage.local.get({ apiKey: '' });
  return Boolean(String(stored.apiKey || '').trim());
}

export async function saveSettings(
  patch: Partial<Settings>,
  opts?: { persistApiKey?: boolean },
): Promise<Settings> {
  const current = await getSettings();
  let providers = patch.providers ?? current.providers;
  if (patch.providers) providers = providers.map((provider) => {
    const previous = current.providers.find((item) => item.id === provider.id);
    return {
      ...provider,
      apiKey: provider.apiKey ?? previous?.apiKey ?? '',
      customHeaders: provider.customHeaders ?? previous?.customHeaders ?? {},
    };
  });
  const activeId = patch.activeProviderId ?? current.activeProviderId;
  // Onboarding and legacy consumers still save the active connection fields.
  const connectionFields = ['apiBase', 'apiKey', 'connectionMode', 'customHeaders', 'model', 'modelParameters', 'maxConcurrent', 'batchSize'] as const;
  const connectionChanged = connectionFields.some((key) => key in patch);
  if (!patch.providers && connectionChanged) {
    providers = providers.map((provider) => {
      if (provider.id !== activeId) return provider;
      return {
        ...provider,
        ...('apiBase' in patch ? { apiBase: patch.apiBase! } : {}),
        ...('apiKey' in patch ? { apiKey: patch.apiKey! } : {}),
        ...('connectionMode' in patch ? { connectionMode: patch.connectionMode! } : {}),
        ...('customHeaders' in patch ? { customHeaders: patch.customHeaders! } : {}),
        models: provider.models.map((model) => model.id === provider.activeModelId ? {
          ...model,
          ...('model' in patch ? { name: patch.model! } : {}),
          ...('modelParameters' in patch ? { parameters: patch.modelParameters! } : {}),
          ...('maxConcurrent' in patch ? { maxConcurrent: patch.maxConcurrent! } : {}),
          ...('batchSize' in patch ? { batchSize: patch.batchSize! } : {}),
        } : model),
      };
    });
  }
  if (opts?.persistApiKey !== undefined) providers = providers.map((provider) =>
    provider.id === activeId ? { ...provider, persistApiKey: opts.persistApiKey! } : provider);
  const merged = validateSettings({ ...current, ...patch, providers, activeProviderId: activeId, schemaVersion: SETTINGS_SCHEMA_VERSION });
  const bump = Object.keys(patch).some((k) => {
    if (k === 'revision' || k === 'schemaVersion') return false;
    return true;
  }) && (
    providerAffectingChanged(current, merged)
    || current.connectionMode !== merged.connectionMode
    || current.maxConcurrent !== merged.maxConcurrent
    || current.batchSize !== merged.batchSize
    || current.uiLocale !== merged.uiLocale
    || JSON.stringify(current.siteContentRules) !== JSON.stringify(merged.siteContentRules)
    || JSON.stringify(current.siteRules) !== JSON.stringify(merged.siteRules)
  );

  const next: Settings = {
    ...merged,
    revision: bump ? current.revision + 1 : current.revision,
  };

  // Write only fields the caller changed. Extension pages and the background
  // run in separate contexts, so a full settings snapshot can overwrite a
  // newer, unrelated change (for example, a site auto-translation rule).
  const syncPatch: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (!isSecret(key) && !isDeviceLocal(key) && key !== 'revision') {
      syncPatch[key] = next[key as keyof Settings];
    }
  }
  // All writes keep persisted settings on the current schema. The revision is
  // deliberately local: its source of truth is the local metadata record.
  syncPatch.schemaVersion = next.schemaVersion;
  if (patch.providers || patch.activeProviderId || connectionChanged) {
    syncPatch.apiBase = next.apiBase;
    syncPatch.connectionMode = next.connectionMode;
    syncPatch.model = next.model;
    syncPatch.maxConcurrent = next.maxConcurrent;
    syncPatch.batchSize = next.batchSize;
  }

  if ('siteContentRules' in patch) {
    await chrome.storage.local.set({ siteContentRules: next.siteContentRules });
  }
  const ops: Promise<void>[] = [
    chrome.storage.sync.set(syncPatch),
    writeMeta({ revision: next.revision }),
  ];
  if (patch.providers || patch.activeProviderId || connectionChanged) {
    ops.push(persistProviders(next));
  }
  if ('customHeaders' in patch) {
    // Defensive cleanup prevents a concurrently running old extension page
    // from leaving credentials in sync after this version has saved.
    ops.push(chrome.storage.sync.remove('customHeaders'));
  }
  await Promise.all(ops);
  return next;
}

export function hostOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function findSiteRule(settings: Settings, host: string): SiteRule | undefined {
  if (!host) return undefined;
  return settings.siteRules.find((r) => r.host === host);
}

/** Effective per-site settings, folding a matching site rule over globals. */
export function effectiveForHost(
  settings: Settings,
  host: string,
): { disabled: boolean; auto: boolean; mode: TranslationMode; targetLang: TargetLang } {
  const rule = findSiteRule(settings, host);
  return {
    disabled: rule?.disabled ?? false,
    auto: rule?.auto ?? false,
    mode: rule?.mode ?? settings.mode,
    targetLang: normalizeTargetLang(rule?.targetLang ?? settings.targetLang),
  };
}

export async function upsertSiteRule(host: string, patch: Partial<SiteRule>): Promise<Settings> {
  if (!host) return getSettings();
  const settings = await getSettings();
  const rules = settings.siteRules.slice();
  const idx = rules.findIndex((r) => r.host === host);
  if (idx >= 0) {
    rules[idx] = { ...rules[idx], ...patch, host };
  } else {
    rules.push({ host, ...patch });
  }
  const pruned = rules.filter(
    (r) => r.disabled || r.auto || r.mode != null || r.targetLang != null,
  );
  return saveSettings({ siteRules: pruned });
}
