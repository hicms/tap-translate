import type {
  ModelParameters,
  ProviderConfig,
  ProviderModel,
  Settings,
  SiteContentRule,
  SiteRule,
} from '../../lib/types';
import {
  activeProviderFields,
  normalizeCustomHeaders,
  normalizeSiteHost,
  providerConfigSchema,
} from '../../lib/settings/schema';
import { parseThinkingPatch } from '../../lib/settings/thinking-override';
import { resolveThinking } from '../../lib/provider/thinking';
import { siteProfiles } from '../../lib/sites';
import { normalizeSiteContentRules, SiteContentValidationError } from '../../lib/sites/validation';
import type { Translate } from '../../ui/locale';

export const numericParameters = [
  'temperature',
  'maxTokens',
  'topP',
  'frequencyPenalty',
  'presencePenalty',
] as const;
type NumericParameter = (typeof numericParameters)[number];
export interface ModelDraft extends Omit<ProviderModel, 'parameters' | 'maxConcurrent' | 'batchSize'> {
  maxConcurrent: string;
  batchSize: string;
  parameters: Omit<ModelParameters, NumericParameter | 'thinkingOverride'> & Record<NumericParameter, string>;
  customThinking: boolean;
  enabledBody: string;
  disabledBody: string;
}
export interface HeaderDraft {
  id: string;
  name: string;
  value: string;
}
export interface ProviderDraft extends Omit<ProviderConfig, 'models' | 'customHeaders'> {
  models: ModelDraft[];
  headers: HeaderDraft[];
}
export interface SiteDraft {
  id: string;
  builtin: boolean;
  host: string;
  policy: 'global' | 'auto' | 'never';
  mode: Settings['mode'] | '';
  targetLang: Settings['targetLang'] | '';
  content?: string;
  ignore?: string;
}
export interface OptionsDraft
  extends Pick<Settings, 'targetLang' | 'uiLocale' | 'mode' | 'activeProviderId'> {
  providers: ProviderDraft[];
  sites: SiteDraft[];
}
export interface ErrorLocation {
  providerId?: string;
  modelId?: string;
  siteId?: string;
  field: string;
}
export class DraftError extends Error {
  constructor(
    message: string,
    readonly location: ErrorLocation,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}
export function modelDraft(model: ProviderModel): ModelDraft {
  const { thinkingOverride, ...parameters } = model.parameters;
  return {
    ...model,
    maxConcurrent: String(model.maxConcurrent),
    batchSize: String(model.batchSize),
    parameters: {
      ...parameters,
      temperature: String(parameters.temperature),
      maxTokens: parameters.maxTokens ? String(parameters.maxTokens) : '',
      topP: String(parameters.topP),
      frequencyPenalty: String(parameters.frequencyPenalty),
      presencePenalty: String(parameters.presencePenalty),
    },
    customThinking: Boolean(thinkingOverride),
    enabledBody: JSON.stringify(
      thinkingOverride?.enabled === undefined ? { enable_thinking: true } : thinkingOverride.enabled,
      null,
      2,
    ),
    disabledBody: JSON.stringify(
      thinkingOverride?.disabled === undefined ? { enable_thinking: false } : thinkingOverride.disabled,
      null,
      2,
    ),
  };
}
export function providerDraft(provider: ProviderConfig): ProviderDraft {
  const { customHeaders, ...value } = provider;
  return {
    ...value,
    models: provider.models.map(modelDraft),
    headers: Object.entries(customHeaders).map(([name, header]) => ({
      id: crypto.randomUUID(),
      name,
      value: header,
    })),
  };
}
export function newSite(host = '', builtin = false): SiteDraft {
  return {
    id: crypto.randomUUID(),
    builtin,
    host,
    policy: 'global',
    mode: '',
    targetLang: '',
  };
}
export function optionsDraft(settings: Settings): OptionsDraft {
  const hosts = new Set([
    ...siteProfiles.flatMap((profile) => [...profile.hosts]),
    ...settings.siteRules.map((rule) => rule.host),
    ...settings.siteContentRules.map((rule) => rule.host),
  ]);
  return {
    targetLang: settings.targetLang,
    uiLocale: settings.uiLocale,
    mode: settings.mode,
    activeProviderId: settings.activeProviderId,
    providers: settings.providers.map(providerDraft),
    sites: [...hosts].map((host) => {
      const rule = settings.siteRules.find((item) => item.host === host);
      const content = settings.siteContentRules.find((item) => item.host === host);
      return {
        ...newSite(
          host,
          siteProfiles.some((profile) => profile.hosts.includes(host)),
        ),
        policy: rule?.disabled ? 'never' : rule?.auto ? 'auto' : 'global',
        mode: rule?.mode ?? '',
        targetLang: rule?.targetLang ?? '',
        content: content?.content?.join('\n'),
        ignore: content?.ignore?.join('\n'),
      };
    }),
  };
}

export function readModel(
  model: ModelDraft,
  providerId: string,
  t: Translate,
  validate = true,
): ProviderModel {
  let thinkingOverride: ModelParameters['thinkingOverride'] = null;
  if (model.customThinking) {
    const read = (field: 'enabledBody' | 'disabledBody') => {
      try {
        return parseThinkingPatch(model[field]);
      } catch {
        throw new DraftError(t('thinkingJsonInvalid'), {
          providerId,
          modelId: model.id,
          field: field === 'enabledBody' ? 'thinkingEnabledBody' : 'thinkingDisabledBody',
        });
      }
    };
    thinkingOverride = {
      enabled: read('enabledBody'),
      disabled: read('disabledBody'),
    };
  }
  function number(field: NumericParameter | 'maxConcurrent' | 'batchSize'): number {
    const raw = field === 'maxConcurrent' || field === 'batchSize' ? model[field] : model.parameters[field];
    if (field === 'maxTokens' && raw === '') return 0;
    const value = Number(raw);
    const integer = field === 'maxTokens' || field === 'maxConcurrent' || field === 'batchSize';
    const scaled = value * (integer ? 1 : 100);
    // Preserve the former number input's decimal grammar and step constraints
    // for every model draft, including editors currently unmounted.
    if (
      validate &&
      (!/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ||
        !Number.isFinite(value) ||
        Math.abs(scaled - Math.round(scaled)) > 1e-8 ||
        (field === 'maxTokens' && value === 0))
    ) {
      throw new DraftError(t('errNumericDraft'), {
        providerId,
        modelId: model.id,
        field,
      });
    }
    return raw.trim() ? value : Number.NaN;
  }
  return {
    id: model.id,
    name: model.name.trim(),
    maxConcurrent: number('maxConcurrent'),
    batchSize: number('batchSize'),
    parameters: {
      ...model.parameters,
      temperature: number('temperature'),
      maxTokens: number('maxTokens'),
      topP: number('topP'),
      frequencyPenalty: number('frequencyPenalty'),
      presencePenalty: number('presencePenalty'),
      thinkingOverride,
    },
  };
}

export function readProvider(provider: ProviderDraft, t: Translate, validate = true): ProviderConfig {
  const customHeaders: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of provider.headers) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name && !value) continue;
    if (!name || seen.has(name.toLowerCase()))
      throw new DraftError(t('customHeadersInvalid'), {
        providerId: provider.id,
        field: `header-${row.id}`,
      });
    seen.add(name.toLowerCase());
    customHeaders[name] = value;
  }
  const result: ProviderConfig = {
    id: provider.id,
    name: provider.name,
    connectionMode: provider.connectionMode,
    apiBase: provider.apiBase.trim(),
    apiKey: provider.apiKey.trim(),
    persistApiKey: provider.persistApiKey,
    activeModelId: provider.activeModelId,
    customHeaders: normalizeCustomHeaders(customHeaders),
    models: provider.models.map((model) => readModel(model, provider.id, t, validate)),
  };
  if (validate) {
    for (const model of result.models) {
      const issue = resolveThinking({
        apiBase: result.apiBase,
        model: model.name,
        modelParameters: model.parameters,
      }).issue;
      if (issue)
        throw new DraftError(`${provider.name} / ${model.name}: ${t(issue)}`, {
          providerId: provider.id,
          modelId: model.id,
          field: 'thinking',
        });
    }
    const parsed = providerConfigSchema.safeParse(result);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const model = issue.path[0] === 'models' ? result.models[Number(issue.path[1])] : undefined;
      let field = String(issue.path.at(-1));
      if (field === 'name') field = model ? 'model' : 'providerName';
      throw new DraftError(`${provider.name}: ${issue.message}`, {
        providerId: provider.id,
        modelId: model?.id,
        field,
      });
    }
  }
  return result;
}

export function contentErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof SiteContentValidationError)
    return t(error.code === 'syntax' ? 'contentSyntaxError' : 'contentLimitError', [
      error.field ? t(error.field === 'content' ? 'contentSelectors' : 'ignoreSelectors') : t('contentRules'),
      error.line ?? 1,
    ]);
  return error instanceof Error ? error.message : String(error);
}
export function readSiteContent(site: SiteDraft, t: Translate, validate = true): SiteContentRule {
  try {
    const host = normalizeSiteHost(site.host);
    const rule = {
      host,
      ...(site.content !== undefined ? { content: site.content.split('\n') } : {}),
      ...(site.ignore !== undefined ? { ignore: site.ignore.split('\n') } : {}),
    };
    return (
      normalizeSiteContentRules([rule], validate ? document : null)[0] ?? {
        host,
      }
    );
  } catch (error) {
    throw new DraftError(contentErrorMessage(error, t), {
      siteId: site.id,
      field: error instanceof SiteContentValidationError ? (error.field ?? 'content') : 'host',
    });
  }
}
export function readOptions(draft: OptionsDraft, t: Translate, validate = true): Partial<Settings> {
  const providers = draft.providers.map((provider) => readProvider(provider, t, validate));
  const siteRules: SiteRule[] = [];
  const contentRules: SiteContentRule[] = [];
  const hosts = new Set<string>();
  for (const site of draft.sites) {
    let host: string;
    try {
      host = normalizeSiteHost(site.host);
    } catch {
      throw new DraftError(t('errSiteHostInvalid'), {
        siteId: site.id,
        field: 'host',
      });
    }
    if (hosts.has(host))
      throw new DraftError(t('errSiteHostDuplicate'), {
        siteId: site.id,
        field: 'host',
      });
    hosts.add(host);
    const rule: SiteRule = {
      host,
      ...(site.policy === 'auto' ? { auto: true } : {}),
      ...(site.policy === 'never' ? { disabled: true } : {}),
      ...(site.mode ? { mode: site.mode } : {}),
      ...(site.targetLang ? { targetLang: site.targetLang } : {}),
    };
    if (Object.keys(rule).length > 1) siteRules.push(rule);
    const content = readSiteContent(site, t, validate);
    if (content.content !== undefined || content.ignore !== undefined) contentRules.push(content);
  }
  return {
    providers,
    ...activeProviderFields(providers, draft.activeProviderId),
    uiLocale: draft.uiLocale,
    targetLang: draft.targetLang,
    mode: draft.mode,
    siteRules,
    siteContentRules: normalizeSiteContentRules(contentRules),
  };
}

export function settingsPatch(current: Partial<Settings>, baseline: Partial<Settings>): Partial<Settings> {
  // Draft readers and storage schemas construct keys in different orders.
  // Compare values independently of key order so an untouched provider is not
  // written back over a concurrent edit from another options window.
  const fingerprint = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
    );
  return Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) => fingerprint(value) !== fingerprint(baseline[key as keyof Settings]),
    ),
  ) as Partial<Settings>;
}
