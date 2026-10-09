import { SettingsValidationError, normalizeSiteHost } from './site-host';
export { SettingsValidationError, normalizeSiteHost, validationCodeOf } from './site-host';
import { normalizeSiteContentRules } from '../sites/validation';
import { siteProfilesSchema } from '../sites/snapshot';
import { z } from 'zod';
import type {
  Settings, SiteRule, TargetLang, TranslationMode, UiLocale, ProviderConfig,
} from '../types';
import { PROMPT_VERSION } from '../provider/version';
import { defaultModelParameters, modelParametersSchema } from './model-parameters';

export const SUPPORTED_TARGET_LANGS = ['zh-CN', 'en', 'ru', 'es', 'fr'] as const;
export const SUPPORTED_UI_LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'es', 'fr'] as const;
export const SETTINGS_SCHEMA_VERSION = 7 as const;
export const MAX_CONCURRENT_BATCHES = 8;
export const MAX_BATCH_SIZE = 20;
export const DEFAULT_MODEL_SCHEDULING = { maxConcurrent: 3, batchSize: 6 } as const;
export const modelSchedulingSchema = z.object({
  maxConcurrent: z.coerce.number().int().min(1).max(MAX_CONCURRENT_BATCHES).default(DEFAULT_MODEL_SCHEDULING.maxConcurrent),
  batchSize: z.coerce.number().int().min(1).max(MAX_BATCH_SIZE).default(DEFAULT_MODEL_SCHEDULING.batchSize),
});

function legacyModelScheduling(raw: { maxConcurrent?: unknown; batchSize?: unknown }) {
  return {
    maxConcurrent: modelSchedulingSchema.shape.maxConcurrent.catch(DEFAULT_MODEL_SCHEDULING.maxConcurrent).parse(raw.maxConcurrent),
    batchSize: modelSchedulingSchema.shape.batchSize.catch(DEFAULT_MODEL_SCHEDULING.batchSize).parse(raw.batchSize),
  };
}

/** Fill only missing per-model values from a legacy global schedule. */
export function migrateProviderScheduling(raw: unknown, schedule: { maxConcurrent: number; batchSize: number }): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const provider = raw as Record<string, unknown>;
  if (!Array.isArray(provider.models)) return raw;
  return {
    ...provider,
    models: provider.models.map((model: unknown) =>
      model && typeof model === 'object' && !Array.isArray(model) ? { ...schedule, ...model } : model),
  };
}
export const DEFAULT_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-v4-flash';
export const DEFAULT_PROXY_API_BASE = 'http://127.0.0.1:8080/v1';

/** Full English names improve LLM translation quality (Prompt v2). */
export const TARGET_LANG_NAMES: Record<TargetLang, string> = {
  'zh-CN': 'Simplified Chinese',
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
};

export function getSystemUiLanguage(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

/** Map a BCP 47 / UI locale to a supported target language; unmatched → en. */
export function resolveTargetLang(locale: string | undefined | null): TargetLang {
  const raw = String(locale || '').trim().replace(/_/g, '-');
  if (!raw) return 'en';
  const lower = raw.toLowerCase();

  for (const code of SUPPORTED_TARGET_LANGS) {
    if (code.toLowerCase() === lower) return code;
  }
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';

  const primary = lower.split('-')[0] ?? '';
  const byPrimary: Record<string, TargetLang> = { en: 'en', ru: 'ru', es: 'es', fr: 'fr' };
  return byPrimary[primary] ?? 'en';
}

export function resolveUiLocale(locale: string | undefined | null): UiLocale {
  const raw = String(locale || '').trim().replace(/_/g, '-').toLowerCase();
  if (raw === 'zh-tw' || raw.startsWith('zh-tw-') || raw === 'zh-hk' || raw.startsWith('zh-hk-') || raw === 'zh-mo' || raw.startsWith('zh-mo-')) {
    return 'zh-TW';
  }
  if (raw === 'zh' || raw.startsWith('zh-')) return 'zh-CN';
  const primary = raw.split('-')[0] ?? '';
  const byPrimary: Record<string, UiLocale> = {
    en: 'en',
    ru: 'ru',
    es: 'es',
    fr: 'fr',
  };
  return byPrimary[primary] ?? 'en';
}

export function normalizeTargetLang(value: unknown): TargetLang {
  if (typeof value === 'string' && (SUPPORTED_TARGET_LANGS as readonly string[]).includes(value)) {
    return value as TargetLang;
  }
  return resolveTargetLang(typeof value === 'string' ? value : '');
}

export function normalizeUiLocale(value: unknown): UiLocale {
  if (typeof value === 'string' && (SUPPORTED_UI_LOCALES as readonly string[]).includes(value)) {
    return value as UiLocale;
  }
  return resolveUiLocale(typeof value === 'string' ? value : getSystemUiLanguage());
}

export function normalizeCustomHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(key).trim();
    if (!name || value == null || value === '') continue;
    out[name] = String(value);
  }
  return out;
}

function normalizeSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    let host: string;
    try {
      host = normalizeSiteHost(candidate.host);
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    const mode = candidate.mode === 'bilingual' || candidate.mode === 'replace'
      ? candidate.mode as TranslationMode
      : undefined;
    const targetLang = (SUPPORTED_TARGET_LANGS as readonly unknown[]).includes(candidate.targetLang)
      ? candidate.targetLang as TargetLang
      : undefined;
    out.push({
      host,
      ...(candidate.disabled === true ? { disabled: true } : {}),
      ...(candidate.auto === true ? { auto: true } : {}),
      ...(mode ? { mode } : {}),
      ...(targetLang ? { targetLang } : {}),
    });
    seen.add(host);
  }
  return out;
}

/** Remote endpoints must be HTTPS; HTTP is allowed only for loopback. */
export function assertSecureApiBase(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) throw new SettingsValidationError('API_BASE_REQUIRED');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SettingsValidationError('API_BASE_INVALID');
  }
  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const loopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1';
  if (protocol === 'https:') return value.replace(/\/$/, '');
  if (protocol === 'http:' && loopback) return value.replace(/\/$/, '');
  throw new SettingsValidationError('API_BASE_INSECURE');
}

const targetLangSchema = z.unknown().transform((v) => normalizeTargetLang(v));
const uiLocaleSchema = z.unknown().transform((v) => normalizeUiLocale(v));
const connectionModeSchema = z.enum(['direct', 'proxy']).catch('direct').default('direct');
const apiBaseSchema = z.string().transform((value, ctx) => {
  try { return assertSecureApiBase(value); } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Invalid API URL' });
    return z.NEVER;
  }
});

export const providerConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  connectionMode: connectionModeSchema,
  apiBase: apiBaseSchema,
  apiKey: z.string().default(''),
  persistApiKey: z.boolean().default(true),
  customHeaders: z.unknown().transform(normalizeCustomHeaders).default({}),
  models: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(200),
    parameters: modelParametersSchema.default({}),
    ...modelSchedulingSchema.shape,
  })).min(1).superRefine((models, ctx) => {
    if (new Set(models.map((model) => model.id)).size !== models.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate model IDs' });
    }
  }),
  activeModelId: z.string(),
}).transform((provider) => ({
  ...provider,
  activeModelId: provider.models.some((model) => model.id === provider.activeModelId)
    ? provider.activeModelId : provider.models[0]!.id,
}));

export function activeProviderFields(providers: ProviderConfig[], activeProviderId: string) {
  const provider = providers.find((item) => item.id === activeProviderId) ?? providers[0]!;
  const model = provider.models.find((item) => item.id === provider.activeModelId)!;
  return {
    activeProviderId: provider.id,
    connectionMode: provider.connectionMode,
    apiBase: provider.apiBase,
    apiKey: provider.apiKey,
    customHeaders: provider.customHeaders,
    model: model.name,
    modelParameters: model.parameters,
    maxConcurrent: model.maxConcurrent,
    batchSize: model.batchSize,
  };
}

export function legacyProvider(raw: Pick<Settings, 'connectionMode' | 'apiBase' | 'apiKey' | 'model' | 'customHeaders'> & Partial<Pick<Settings, 'modelParameters' | 'maxConcurrent' | 'batchSize'>>): ProviderConfig {
  let name = 'API';
  try { name = new URL(raw.apiBase).hostname; } catch { /* parseSettings validates URL */ }
  return {
    id: 'legacy-provider', name, connectionMode: raw.connectionMode, apiBase: raw.apiBase,
    apiKey: raw.apiKey, persistApiKey: true, customHeaders: raw.customHeaders,
    models: [{ id: 'legacy-model', name: raw.model, parameters: raw.modelParameters ?? defaultModelParameters(), ...legacyModelScheduling(raw) }],
    activeModelId: 'legacy-model',
  };
}

export const settingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION).default(SETTINGS_SCHEMA_VERSION),
  connectionMode: connectionModeSchema,
  apiBase: z
    .string()
    .default(DEFAULT_API_BASE)
    .transform((v, ctx) => {
      if (!String(v).trim()) return DEFAULT_API_BASE;
      try {
        return assertSecureApiBase(v);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : 'Invalid API base URL',
        });
        return z.NEVER;
      }
    }),
  apiKey: z.string().default(''),
  model: z.string().default(DEFAULT_MODEL),
  targetLang: targetLangSchema,
  uiLocale: uiLocaleSchema,
  mode: z.enum(['bilingual', 'replace']).catch('bilingual').default('bilingual'),
  ...modelSchedulingSchema.shape,
  customHeaders: z.unknown().transform(normalizeCustomHeaders).default({}),
  providers: z.array(providerConfigSchema).min(1).superRefine((providers, ctx) => {
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate provider IDs' });
    }
  }),
  activeProviderId: z.string(),
  modelParameters: modelParametersSchema.default({}),
  builtinSiteProfiles: siteProfilesSchema.nullable().default(null),
  siteContentRules: z.unknown().transform((v) => normalizeSiteContentRules(v)).default([]),
  siteRules: z.unknown().transform(normalizeSiteRules).default([]),
  revision: z.coerce.number().int().min(0).catch(0).default(0),
});

export function createDefaultSettings(): Settings {
  const systemLang = getSystemUiLanguage();
  const provider = legacyProvider({
    connectionMode: 'direct', apiBase: DEFAULT_API_BASE, apiKey: '',
    model: DEFAULT_MODEL, customHeaders: {},
  });
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    connectionMode: 'direct',
    apiBase: DEFAULT_API_BASE,
    apiKey: '',
    model: DEFAULT_MODEL,
    targetLang: resolveTargetLang(systemLang),
    uiLocale: resolveUiLocale(systemLang),
    mode: 'bilingual',
    ...DEFAULT_MODEL_SCHEDULING,
    customHeaders: {},
    providers: [provider],
    activeProviderId: provider.id,
    modelParameters: defaultModelParameters(),
    siteRules: [],
    siteContentRules: [],
    builtinSiteProfiles: null,
    revision: 0,
  };
}

/** Migrate v1/v2 (or unknown) blobs into the current settings shape before parse. */
export function migrateSettingsRaw(raw: unknown): Record<string, unknown> {
  const base = createDefaultSettings();
  const incoming = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};

  const version = Number(incoming.schemaVersion ?? 1);
  if (incoming.connectionMode !== 'direct' && incoming.connectionMode !== 'proxy') {
    try {
      const legacyUrl = new URL(String(incoming.apiBase || ''));
      const legacyHost = legacyUrl.hostname.toLowerCase();
      incoming.connectionMode = (
        legacyHost === 'localhost'
        || legacyHost === '127.0.0.1'
        || legacyHost === '[::1]'
        || legacyHost === '::1'
      ) ? 'proxy' : 'direct';
    } catch {
      incoming.connectionMode = 'direct';
    }
  }
  if (!incoming.uiLocale) {
    // v1 coupled UI language to targetLang; seed uiLocale from browser, not target.
    incoming.uiLocale = resolveUiLocale(getSystemUiLanguage());
  } else if (incoming.uiLocale === 'zh') {
    // v2 used a generic Chinese locale. Preserve a Traditional-Chinese browser
    // preference when upgrading; otherwise retain the historical Simplified UI.
    incoming.uiLocale = resolveUiLocale(getSystemUiLanguage()) === 'zh-TW' ? 'zh-TW' : 'zh-CN';
  }
  if (incoming.revision == null || Number.isNaN(Number(incoming.revision))) {
    incoming.revision = 0;
  }
  if (!String(incoming.apiBase ?? '').trim()) {
    incoming.apiBase = base.apiBase;
  }
  if (!String(incoming.model ?? '').trim()) {
    incoming.model = base.model;
  }
  incoming.schemaVersion = SETTINGS_SCHEMA_VERSION;
  if (!Array.isArray(incoming.providers) || !incoming.providers.length) {
    const provider = legacyProvider({ ...base, ...incoming } as Settings);
    incoming.providers = [provider];
    incoming.activeProviderId = provider.id;
  } else {
    incoming.providers = incoming.providers.map((provider) => migrateProviderScheduling(provider, legacyModelScheduling(incoming)));
  }
  Object.assign(incoming, legacyModelScheduling(incoming));

  // Preserve intentional v1 targetLang; only fill missing fields from defaults.
  return { ...base, ...incoming, schemaVersion: SETTINGS_SCHEMA_VERSION, _migratedFrom: version };
}

/** Validate a complete settings snapshot before writing; invalid saves must fail. */
export function validateSettings(raw: unknown): Settings {
  const settings = settingsSchema.parse(raw);
  return {
    ...settings,
    ...activeProviderFields(settings.providers, settings.activeProviderId),
  } as Settings;
}

/** Read legacy or malformed stored settings with a safe runtime fallback. */
export function parseSettings(raw: unknown): Settings {
  try { return validateSettings(migrateSettingsRaw(raw)); }
  catch { return createDefaultSettings(); }
}

export function buildRequestHeaders(settings: Pick<Settings, 'apiKey' | 'customHeaders'>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [name, value] of Object.entries(normalizeCustomHeaders(settings.customHeaders))) {
    headers[name] = value;
  }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  return headers;
}

function stableHeadersFingerprint(headers: Record<string, string>): string {
  return Object.keys(headers)
    .sort()
    .map((k) => `${k.toLowerCase()}=${headers[k]}`)
    .join('\n');
}

async function sha256Hex(material: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Irreversible provider identity used by content-side caches.
 * Includes endpoint, model, prompt version, and normalized custom headers.
 */
export async function providerFingerprint(
  settings: Pick<Settings, 'apiBase' | 'model' | 'customHeaders'> & Partial<Pick<Settings, 'modelParameters'>>,
): Promise<string> {
  const material = [
    'v1',
    assertSecureApiBase(settings.apiBase),
    settings.model || '',
    PROMPT_VERSION,
    stableHeadersFingerprint(normalizeCustomHeaders(settings.customHeaders)),
    JSON.stringify(settings.modelParameters ?? defaultModelParameters()),
  ].join('\u0000');
  return sha256Hex(material);
}

/** Fields that invalidate translation results / cache namespaces when changed. */
export function providerAffectingChanged(
  before: Pick<Settings, 'apiBase' | 'model' | 'customHeaders' | 'targetLang' | 'mode'> & Partial<Pick<Settings, 'modelParameters'>>,
  after: Pick<Settings, 'apiBase' | 'model' | 'customHeaders' | 'targetLang' | 'mode'> & Partial<Pick<Settings, 'modelParameters'>>,
): boolean {
  if (before.apiBase !== after.apiBase) return true;
  if (before.model !== after.model) return true;
  if (before.targetLang !== after.targetLang) return true;
  if (before.mode !== after.mode) return true;
  if (JSON.stringify(before.modelParameters) !== JSON.stringify(after.modelParameters)) return true;
  return (
    stableHeadersFingerprint(normalizeCustomHeaders(before.customHeaders)) !==
    stableHeadersFingerprint(normalizeCustomHeaders(after.customHeaders))
  );
}
