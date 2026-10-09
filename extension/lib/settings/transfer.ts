import { normalizeSiteContentRules } from '../sites/validation';
import type { Settings, SiteRule, TranslationMode } from '../types';
import {
  normalizeCustomHeaders,
  normalizeSiteHost,
  normalizeTargetLang,
  normalizeUiLocale,
  assertSecureApiBase,
  providerConfigSchema,
  migrateProviderScheduling,
  modelSchedulingSchema,
} from './schema';
import { siteProfilesSchema } from '../sites/snapshot';
import { modelParametersSchema } from './model-parameters';

const IMPORTABLE_FIELDS = [
  'connectionMode',
  'apiBase',
  'apiKey',
  'model',
  'targetLang',
  'uiLocale',
  'mode',
  'maxConcurrent',
  'batchSize',
  'activeProviderId',
] as const;

function normalizeImportedSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) throw new TypeError('siteRules must be an array');
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('siteRules must contain objects');
    }
    const candidate = item as Record<string, unknown>;
    const host = normalizeSiteHost(candidate.host);
    if (seen.has(host)) throw new TypeError('siteRules contains duplicate hosts');
    seen.add(host);
    const rule: SiteRule = { host };
    if (candidate.disabled === true) rule.disabled = true;
    if (candidate.auto === true) rule.auto = true;
    if (candidate.mode === 'bilingual' || candidate.mode === 'replace') {
      rule.mode = candidate.mode as TranslationMode;
    }
    if (candidate.targetLang !== undefined) rule.targetLang = normalizeTargetLang(candidate.targetLang);
    return rule;
  });
}

/**
 * Imports only fields explicitly present in the file. Omitted credentials and
 * headers therefore stay on the current device instead of being cleared.
 */
export function prepareSettingsImport(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Settings import must be a JSON object');
  }
  const data = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of IMPORTABLE_FIELDS) {
    if (data[field] !== undefined) patch[field] = data[field];
  }
  if (patch.activeProviderId !== undefined
    && (typeof patch.activeProviderId !== 'string' || !patch.activeProviderId.trim())) {
    throw new TypeError('activeProviderId must be a non-empty string');
  }
  if (patch.connectionMode !== undefined && patch.connectionMode !== 'direct' && patch.connectionMode !== 'proxy') {
    throw new TypeError('connectionMode must be direct or proxy');
  }
  if (patch.apiBase !== undefined) patch.apiBase = assertSecureApiBase(String(patch.apiBase));
  if (patch.targetLang !== undefined) patch.targetLang = normalizeTargetLang(patch.targetLang);
  if (patch.uiLocale !== undefined) patch.uiLocale = normalizeUiLocale(patch.uiLocale);
  if (patch.mode !== undefined && patch.mode !== 'bilingual' && patch.mode !== 'replace') {
    throw new TypeError('mode must be bilingual or replace');
  }
  const schedule = modelSchedulingSchema.parse({ maxConcurrent: data.maxConcurrent, batchSize: data.batchSize });
  for (const field of ['maxConcurrent', 'batchSize'] as const) {
    if (patch[field] !== undefined) patch[field] = schedule[field];
  }
  if (data.customHeaders !== undefined) patch.customHeaders = normalizeCustomHeaders(data.customHeaders);
  if (data.modelParameters !== undefined) patch.modelParameters = modelParametersSchema.parse(data.modelParameters);
  if (data.providers !== undefined) {
    if (!Array.isArray(data.providers) || !data.providers.length) throw new TypeError('providers must be a non-empty array');
    const ids = new Set<string>();
    patch.providers = data.providers.map((rawProvider) => {
      const provider = providerConfigSchema.parse(migrateProviderScheduling(rawProvider, schedule));
      if (ids.has(provider.id)) throw new TypeError('Duplicate provider IDs');
      ids.add(provider.id);
      if (!Object.hasOwn(rawProvider, 'apiKey')) Reflect.deleteProperty(provider, 'apiKey');
      if (!Object.hasOwn(rawProvider, 'customHeaders')) Reflect.deleteProperty(provider, 'customHeaders');
      return provider;
    });
  }
  if (data.builtinSiteProfiles !== undefined) patch.builtinSiteProfiles = siteProfilesSchema.nullable().parse(data.builtinSiteProfiles);
  if (data.siteContentRules !== undefined) patch.siteContentRules = normalizeSiteContentRules(data.siteContentRules);
  if (data.siteRules !== undefined) patch.siteRules = normalizeImportedSiteRules(data.siteRules);
  return patch as Partial<Settings>;
}
