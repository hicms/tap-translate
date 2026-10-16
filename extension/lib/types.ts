import type { SiteProfile } from './sites/types';

export type TranslationMode = 'bilingual' | 'replace';
export type ConnectionMode = 'direct' | 'proxy';

export type TargetLang = 'zh-CN' | 'en' | 'ru' | 'es' | 'fr';

export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Vendor JSON is validated at the settings boundary and otherwise opaque. */
export type ThinkingPatch = Record<string, unknown>;

/** null action means unsupported; null field values remove top-level fields. */
export interface ThinkingOverride {
  enabled: ThinkingPatch | null;
  disabled: ThinkingPatch | null;
}

/** Common OpenAI-compatible generation controls stored per model. */
export interface ModelParameters {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  reasoningEffort: ReasoningEffort;
  thinking: 'auto' | 'enabled' | 'disabled';
  thinkingOverride: ThinkingOverride | null;
  tokenLimitField: 'auto' | 'max_tokens' | 'max_completion_tokens';
  systemPrompt: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  parameters: ModelParameters;
  maxConcurrent: number;
  batchSize: number;
}

/** Trusted-context provider configuration; credentials are stored separately. */
export interface ProviderConfig {
  id: string;
  name: string;
  connectionMode: ConnectionMode;
  apiBase: string;
  apiKey: string;
  persistApiKey: boolean;
  customHeaders: Record<string, string>;
  models: ProviderModel[];
  activeModelId: string;
}

/** Languages available for extension UI chrome (independent of translation target). */
export type UiLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ru' | 'es' | 'fr';

export interface SiteRule {
  /** Hostname (lowercased, no port). */
  host: string;
  /** When true, never translate this site (blacklist). */
  disabled?: boolean;
  /** When true, translate automatically on page load. */
  auto?: boolean;
  mode?: TranslationMode;
  targetLang?: TargetLang;
}

export interface SiteContentRule {
  host: string;
  /** Missing inherits; unmatched pages use generic collection; [] disables it. */
  content?: string[];
  /** Missing inherits; [] removes only site-specific exclusions. */
  ignore?: string[];
}

/** Full settings — trusted contexts only (background / options / popup). */
export interface Settings {
  /** Schema version; older storage is migrated before use. */
  schemaVersion: 7;
  /**
   * Direct requests use the extension's API key. Proxy requests use the
   * user-configured OpenAI-compatible proxy and may omit that key.
   */
  connectionMode: ConnectionMode;
  apiBase: string;
  apiKey: string;
  model: string;
  targetLang: TargetLang;
  /** Interface language; independent of translation target. */
  uiLocale: UiLocale;
  mode: TranslationMode;
  /** Compatibility projection of the active model's scheduling settings. */
  maxConcurrent: number;
  batchSize: number;
  customHeaders: Record<string, string>;
  /** Provider/model workbench. The active item mirrors the legacy fields above. */
  providers: ProviderConfig[];
  activeProviderId: string;
  modelParameters: ModelParameters;
  siteRules: SiteRule[];
  siteContentRules: SiteContentRule[];
  /** null follows bundled defaults; a restored snapshot supplies all built-in rules. */
  builtinSiteProfiles: SiteProfile[] | null;
  /**
   * Monotonic revision bumped on every save that affects translation or
   * provider identity. Content sessions compare this instead of deep equality.
   */
  revision: number;
}

/**
 * Public session config sent to content scripts. Never includes API keys,
 * custom secret headers, or raw endpoint credentials.
 */
export interface PublicSessionConfig {
  sessionId: string;
  revision: number;
  targetLang: TargetLang;
  uiLocale: UiLocale;
  mode: TranslationMode;
  maxConcurrent: number;
  batchSize: number;
  /** Irreversible provider identity for cache keys. */
  providerFingerprint: string;
  disabled: boolean;
  /** Only this frame hostname and its override, never the full settings. */
  siteContentRule?: SiteContentRule;
  siteProfile?: SiteProfile | null;
}

/** Kind determines how a translation is mounted next to the original. */
export type UnitKind = 'block' | 'inner' | 'inline' | 'nav';

/**
 * Rich (structured) bilingual unit: keep a *safe* inline skeleton
 * (links, code, emphasis) and only translate the text-node slots.
 * Renderer rebuilds allowlisted markup — never cloneNode identity attrs.
 */
export interface RichMeta {
  /** Translatable text-node values in document order (NO_TEXT parents skipped). */
  slots: string[];
}

export interface TranslationUnit {
  el: HTMLElement;
  /** Joined plain text (cache key / skip detection / logging). */
  text: string;
  kind: UnitKind;
  /** Source nodes for mixed-content segments or labelled animation text. */
  nodes?: Text[];
  segment?: boolean;
  /** Visible split-text fragments repeat the semantic host's aria-label. */
  splitText?: boolean;
  /** When set, render via safe rich skeleton + filled slots. */
  rich?: RichMeta;
}


/** Payload handed from scheduler → renderer. */
export type TranslationPayload = string | string[];

export interface TranslateStatus {
  translating: boolean;
  count: number;
  failed: number;
  total: number;
  watching: boolean;
  sessionId?: string;
  revision?: number;
  /** Open / feature-detected shadow roots currently watched in this frame. */
  shadowRoots?: number;
  /** iframe barriers visible from this frame (same-origin handled via allFrames). */
  frames?: {
    sameOrigin: number;
    crossOrigin: number;
    opaque: number;
  };
  /**
   * Lightweight wall-clock timings for the perf lab.
   * Optional — absent on older builds / empty status.
   */
  perf?: {
    /** Last full-document index active CPU ms (excludes cooperative yield waits). */
    lastIndexMs?: number;
    /** Last MutationObserver incremental index, ms. */
    lastMutationIndexMs?: number;
  };
}

