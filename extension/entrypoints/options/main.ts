import { siteProfiles, resolveSiteProfile } from '../../lib/sites';
import { collectContentRules, mountContentEditor, contentErrorMessage } from './site-content';
import { SiteContentValidationError } from '../../lib/sites/validation';
import { mountSiteWorkspace } from './site-workspace';
import { mountEditorTabs } from './editor-tabs';
import './site-content.css';
import './workspace.css';
import type {
  Settings, SiteRule, TargetLang, TranslationMode, UiLocale,
} from '../../lib/types';
import { getSettings, saveSettings } from '../../lib/settings/storage';
import {
  SettingsValidationError, assertSecureApiBase,
  createDefaultSettings, normalizeCustomHeaders, normalizeSiteHost, normalizeTargetLang,
  normalizeUiLocale, SUPPORTED_TARGET_LANGS, validationCodeOf,
  activeProviderFields,
} from '../../lib/settings/schema';
import { ensureCatalogs, formatUiNumber, getUiMessage, localizePage } from '../../lib/i18n';
import { clearCache } from '../../lib/cache';
import { buildSettingsExport, prepareSettingsImport } from '../../lib/settings/transfer';
import { ensureApiHostPermission, testConnection } from '../../lib/provider/connection';
import { mountServiceEditor, type ServiceEditor } from './services';
import './services.css';
import { mountSettingsNavigation, revealSettingsError, revealSettingsElement } from './navigation';

const fields = [
  'targetLang', 'uiLocale', 'mode',
] as const;
const DEFAULTS = createDefaultSettings();
let uiLocale = DEFAULTS.uiLocale;
let dirty = false;
let savedSnapshot = '';
let siteCardSequence = 0;
let loadedForm: Partial<Settings> = {};
let loadedContentRules: Settings['siteContentRules'] = [];
let statusTimer: number | undefined;
let serviceEditor: ServiceEditor;
let siteWorkspace: ReturnType<typeof mountSiteWorkspace>;
let saving = false;
let testing = false;

const customHeaderRowsEl = () => document.getElementById('customHeaderRows');
const customHeadersEmptyEl = () => document.getElementById('customHeadersEmpty');
const siteRuleRowsEl = () => document.getElementById('siteRuleRows');
const siteRulesEmptyEl = () => document.getElementById('siteRulesEmpty');

function t(key: string, subs?: (string | number)[]): string {
  return getUiMessage(key, subs ?? null, uiLocale);
}

function validationMessageKey(error: unknown): string {
  const code = validationCodeOf(error);
  const keys: Record<string, string> = {
    API_BASE_REQUIRED: 'errApiBaseRequired',
    API_BASE_INVALID: 'errApiBaseInvalid',
    API_BASE_INSECURE: 'connEndpointInsecure',
    SITE_HOST_REQUIRED: 'errSiteHostRequired',
    SITE_HOST_INVALID: 'errSiteHostInvalid',
    SITE_HOST_DUPLICATE: 'errSiteHostDuplicate',
  };
  return code ? (keys[code] || 'errUnknown') : 'errUnknown';
}

function setDirty(next: boolean): void {
  dirty = next;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
  const discardBtn = document.getElementById('discardBtn') as HTMLButtonElement | null;
  if (saveBtn) saveBtn.disabled = !dirty;
  if (discardBtn) discardBtn.disabled = !dirty;
  document.getElementById('stickyActions')?.classList.toggle('is-dirty', dirty);
}

function formSnapshot(): string {
  try {
    return JSON.stringify(readFormSettings());
  } catch {
    return '';
  }
}

function refreshDirty(): void {
  const snapshot = formSnapshot();
  setDirty(!snapshot || snapshot !== savedSnapshot);
}

function markClean(): void {
  savedSnapshot = formSnapshot();
  loadedForm = savedSnapshot ? JSON.parse(savedSnapshot) as Partial<Settings> : {};
  setDirty(false);
}

function updateCustomHeadersEmptyState(): void {
  const rows = customHeaderRowsEl()?.querySelectorAll('.header-row') ?? [];
  const emptyEl = customHeadersEmptyEl() as HTMLElement | null;
  if (!emptyEl) return;
  emptyEl.hidden = rows.length > 0;
}

function createHeaderRow(name = '', value = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'header-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.dataset.field = 'name';
  nameInput.value = name;
  nameInput.placeholder = 'X-Request-Id';
  nameInput.setAttribute('aria-label', t('headerName'));
  nameInput.setAttribute('data-i18n-aria-label', 'headerName');
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.dataset.field = 'value';
  valueInput.value = value;
  valueInput.placeholder = t('headerValuePlaceholder');
  valueInput.setAttribute('aria-label', t('headerValue'));
  valueInput.setAttribute('data-i18n-aria-label', 'headerValue');
  valueInput.setAttribute('data-i18n-placeholder', 'headerValuePlaceholder');
  valueInput.autocomplete = 'off';
  valueInput.spellcheck = false;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon';
  removeBtn.dataset.action = 'remove-header';
  removeBtn.title = t('removeHeader');
  removeBtn.setAttribute('aria-label', t('removeHeader'));
  removeBtn.setAttribute('data-i18n-title', 'removeHeader');
  removeBtn.setAttribute('data-i18n-aria-label', 'removeHeader');
  removeBtn.textContent = '×';

  row.append(nameInput, valueInput, removeBtn);
  return row;
}

function renderCustomHeaders(customHeaders: Record<string, string>): void {
  const container = customHeaderRowsEl();
  if (!container) return;
  container.replaceChildren();
  const entries = Object.entries(normalizeCustomHeaders(customHeaders));
  for (const [name, value] of entries) container.appendChild(createHeaderRow(name, value));
  updateCustomHeadersEmptyState();
  if (entries.length) {
    const details = document.getElementById('advancedConnection') as HTMLDetailsElement | null;
    if (details) details.open = true;
  }
}

function addHeaderRow(name = '', value = ''): void {
  const container = customHeaderRowsEl();
  if (!container) return;
  const row = createHeaderRow(name, value);
  container.appendChild(row);
  updateCustomHeadersEmptyState();
  (document.getElementById('advancedConnection') as HTMLDetailsElement | null)?.setAttribute('open', '');
  (row.querySelector('[data-field="name"]') as HTMLElement | null)?.focus();
  refreshDirty();
}

function clearHeaderRowErrors(): void {
  customHeaderRowsEl()?.querySelectorAll('.header-row.is-invalid').forEach((row) => row.classList.remove('is-invalid'));
}

function markInvalidRows(rows: Element[]): void {
  clearHeaderRowErrors();
  rows.forEach((row) => row.classList.add('is-invalid'));
}

function collectCustomHeaders(): Record<string, string> {
  const rows = Array.from(customHeaderRowsEl()?.querySelectorAll('.header-row') ?? []);
  const headers: Record<string, string> = {};
  const invalidRows: Element[] = [];
  const seen = new Map<string, Element>();

  rows.forEach((row) => {
    const name = (row.querySelector('[data-field="name"]') as HTMLInputElement | null)?.value.trim() || '';
    const value = (row.querySelector('[data-field="value"]') as HTMLInputElement | null)?.value.trim() || '';
    if (!name && !value) return;
    if (!name && value) {
      invalidRows.push(row);
      return;
    }
    const key = name.toLowerCase();
    const dup = seen.get(key);
    if (dup) {
      invalidRows.push(row, dup);
      return;
    }
    seen.set(key, row);
    headers[name] = value;
  });

  if (invalidRows.length) {
    markInvalidRows([...new Set(invalidRows)]);
    throw new Error(t('customHeadersInvalid'));
  }
  clearHeaderRowErrors();
  return normalizeCustomHeaders(headers);
}

function updateSiteRulesEmptyState(): void {
  const rows = siteRuleRowsEl()?.querySelectorAll('.site-card') ?? [];
  const emptyEl = siteRulesEmptyEl() as HTMLElement | null;
  if (emptyEl) emptyEl.hidden = rows.length > 0;
}

function policyFromRule(rule: Partial<SiteRule>): 'global' | 'auto' | 'never' {
  if (rule.disabled) return 'never';
  if (rule.auto) return 'auto';
  return 'global';
}

function targetLanguageKey(code: TargetLang): string {
  const compact = code.replace('-', '');
  return `targetLanguage${compact[0]!.toUpperCase()}${compact.slice(1)}`;
}

function setSiteCardPolicyState(card: HTMLElement): void {
  const policy = card.querySelector<HTMLSelectElement>('[data-field="policy"]');
  const mode = card.querySelector<HTMLSelectElement>('[data-field="mode"]');
  const lang = card.querySelector<HTMLSelectElement>('[data-field="targetLang"]');
  const disabled = policy?.value === 'never';
  for (const control of [mode, lang]) {
    if (!control) continue;
    control.disabled = disabled;
    control.setAttribute('aria-disabled', String(disabled));
  }
  card.classList.toggle('is-disabled-policy', disabled);
}

function createSiteCard(rule: Partial<SiteRule> = {}): HTMLElement {
  const card = document.createElement('article');
  card.className = 'site-card';
  const cardId = `site-rule-${siteCardSequence += 1}`;

  const hostField = document.createElement('div');
  hostField.className = 'field';
  const hostLabel = document.createElement('label');
  hostLabel.textContent = t('siteHost');
  hostLabel.htmlFor = `${cardId}-host`;
  hostLabel.setAttribute('data-i18n', 'siteHost');
  const host = document.createElement('input');
  host.type = 'text';
  host.id = `${cardId}-host`;
  host.dataset.field = 'host';
  host.value = rule.host ?? '';
  host.placeholder = 'example.com';
  host.setAttribute('aria-describedby', `${cardId}-host-hint`);
  host.autocomplete = 'off';
  host.spellcheck = false;
  const hostHint = document.createElement('p');
  hostHint.id = `${cardId}-host-hint`;
  hostHint.className = 'hint';
  hostHint.textContent = t('siteHostHint');
  hostHint.setAttribute('data-i18n', 'siteHostHint');
  hostField.append(hostLabel, host, hostHint);

  const policyField = document.createElement('div');
  policyField.className = 'field';
  const policyLabel = document.createElement('label');
  policyLabel.textContent = t('sitePolicy');
  policyLabel.htmlFor = `${cardId}-policy`;
  policyLabel.setAttribute('data-i18n', 'sitePolicy');
  const policy = document.createElement('select');
  policy.id = `${cardId}-policy`;
  policy.dataset.field = 'policy';
  for (const [value, key] of [
    ['global', 'sitePolicyGlobal'],
    ['auto', 'sitePolicyAuto'],
    ['never', 'sitePolicyNever'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = t(key);
    opt.setAttribute('data-i18n', key);
    policy.appendChild(opt);
  }
  policy.value = policyFromRule(rule);
  policyField.append(policyLabel, policy);

  const modeField = document.createElement('div');
  modeField.className = 'field';
  const modeLabel = document.createElement('label');
  modeLabel.textContent = t('translationMode');
  modeLabel.htmlFor = `${cardId}-mode`;
  modeLabel.setAttribute('data-i18n', 'translationMode');
  const mode = document.createElement('select');
  mode.id = `${cardId}-mode`;
  mode.dataset.field = 'mode';
  for (const [value, key] of [
    ['', 'siteUseGlobal'],
    ['bilingual', 'modeBilingual'],
    ['replace', 'modeReplace'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = t(key);
    opt.setAttribute('data-i18n', key);
    mode.appendChild(opt);
  }
  mode.value = rule.mode ?? '';
  modeField.append(modeLabel, mode);

  const langField = document.createElement('div');
  langField.className = 'field';
  const langLabel = document.createElement('label');
  langLabel.textContent = t('targetLanguage');
  langLabel.htmlFor = `${cardId}-target-lang`;
  langLabel.setAttribute('data-i18n', 'targetLanguage');
  const lang = document.createElement('select');
  lang.id = `${cardId}-target-lang`;
  lang.dataset.field = 'targetLang';
  const globalOpt = document.createElement('option');
  globalOpt.value = '';
  globalOpt.textContent = t('siteUseGlobal');
  globalOpt.setAttribute('data-i18n', 'siteUseGlobal');
  lang.appendChild(globalOpt);
  for (const code of SUPPORTED_TARGET_LANGS) {
    const opt = document.createElement('option');
    opt.value = code;
    const key = targetLanguageKey(code);
    opt.textContent = t(key);
    opt.setAttribute('data-i18n', key);
    lang.appendChild(opt);
  }
  lang.value = rule.targetLang ?? '';
  langField.append(langLabel, lang);

  const grid = document.createElement('div');
  grid.className = 'field-grid';
  grid.dataset.editorPanel = 'preferences';
  grid.append(policyField, modeField, langField);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-secondary btn-sm site-remove';
  removeBtn.dataset.action = 'remove-site';
  removeBtn.textContent = t('removeSite');
  removeBtn.setAttribute('data-i18n', 'removeSite');

  const head = document.createElement('div');
  head.className = 'site-card-head';
  head.append(hostField, removeBtn);

  if (rule.host && resolveSiteProfile(rule.host)) { card.dataset.builtin = 'true'; host.readOnly = true; removeBtn.hidden = true; }
  const body = document.createElement('div'); body.className = 'workspace-editor-body';
  card.append(head, body);
  body.append(grid);
  mountContentEditor(card, loadedContentRules.find(item => item.host === rule.host), t, refreshDirty);
  body.append(card.querySelector('.content-editor')!);
  const tabs = mountEditorTabs(card, [
    { id: 'preferences', label: t('workspacePreferences'), key: 'workspacePreferences' },
    { id: 'content', label: t('contentRules'), key: 'contentRules' },
  ]);
  head.after(tabs);
  setSiteCardPolicyState(card);
  return card;
}

function renderSiteRules(rules: SiteRule[]): void {
  const container = siteRuleRowsEl();
  if (!container) return;
  const previousHost = siteWorkspace.selectedHost();
  const previousTab = siteWorkspace.activeTab();
  container.replaceChildren();
  for (const profile of siteProfiles) for (const host of profile.hosts) {
    container.append(createSiteCard(rules.find(rule => rule.host === host) ?? { host }));
  }
  const hosts = new Set([...rules, ...loadedContentRules].map(rule => rule.host));
  for (const host of hosts) if (!resolveSiteProfile(host)) container.append(createSiteCard(rules.find(rule => rule.host === host) ?? { host }));
  const previous = [...container.querySelectorAll<HTMLElement>('.site-card')].find(card => card.querySelector<HTMLInputElement>('[data-field="host"]')!.value === previousHost);
  siteWorkspace.refresh(previous);
  previous?.querySelector<HTMLButtonElement>(`[data-editor-tab="${previousTab}"]`)?.click();
  updateSiteRulesEmptyState();
}

function collectSiteRules(): SiteRule[] {
  const rows = Array.from(siteRuleRowsEl()?.querySelectorAll('.site-card') ?? []);
  const out: SiteRule[] = [];
  const seen = new Set<string>();
  const rowByHost = new Map<string, Element>();
  const invalidRows: Element[] = [];
  let validationError: 'SITE_HOST_INVALID' | 'SITE_HOST_DUPLICATE' | null = null;
  for (const row of rows) {
    const hostInput = row.querySelector('[data-field="host"]') as HTMLInputElement | null;
    let host: string;
    try {
      host = normalizeSiteHost(hostInput?.value);
    } catch (_error) {
      invalidRows.push(row);
      validationError ??= 'SITE_HOST_INVALID';
      continue;
    }
    if (seen.has(host)) {
      invalidRows.push(row);
      const existing = rowByHost.get(host);
      if (existing) invalidRows.push(existing);
      validationError = 'SITE_HOST_DUPLICATE';
      continue;
    }
    seen.add(host);
    rowByHost.set(host, row);
    if (hostInput) hostInput.value = host;
    const policy = (row.querySelector('[data-field="policy"]') as HTMLSelectElement).value;
    const modeRaw = (row.querySelector('[data-field="mode"]') as HTMLSelectElement).value;
    const langRaw = (row.querySelector('[data-field="targetLang"]') as HTMLSelectElement).value;
    const rule: SiteRule = { host };
    if (policy === 'never') rule.disabled = true;
    if (policy === 'auto') rule.auto = true;
    {
      if (modeRaw === 'bilingual' || modeRaw === 'replace') rule.mode = modeRaw as TranslationMode;
      if (langRaw) rule.targetLang = normalizeTargetLang(langRaw);
    }
    if (rule.auto || rule.disabled || rule.mode || rule.targetLang) out.push(rule);
  }
  rows.forEach((row) => {
    row.classList.remove('is-invalid');
    (row.querySelector('[data-field="host"]') as HTMLInputElement | null)?.removeAttribute('aria-invalid');
  });
  if (invalidRows.length) {
    for (const row of new Set(invalidRows)) {
      row.classList.add('is-invalid');
      (row.querySelector('[data-field="host"]') as HTMLInputElement | null)?.setAttribute('aria-invalid', 'true');
    }
    throw new SettingsValidationError(validationError ?? 'SITE_HOST_INVALID');
  }
  return out;
}

async function loadSettings(settings: Settings): Promise<void> {
  for (const field of fields) {
    const el = document.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    el.value = String(settings[field as keyof Settings] ?? '');
    if (field === 'targetLang' && !el.value) el.value = 'en';
    if (field === 'uiLocale' && !el.value) el.value = 'en';
  }
  serviceEditor.load(settings);
  loadedContentRules = settings.siteContentRules;
  renderSiteRules(settings.siteRules);
}

function readFormSettings(): Partial<Settings> {
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    const el = document.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    settings[field] = el.value;
  }
  settings.targetLang = normalizeTargetLang(settings.targetLang);
  settings.uiLocale = normalizeUiLocale(settings.uiLocale);
  const services = serviceEditor.read();
  Object.assign(settings, services, activeProviderFields(services.providers, services.activeProviderId));
  settings.siteRules = collectSiteRules();
  settings.siteContentRules = collectContentRules(siteRuleRowsEl()!, t);
  return settings as Partial<Settings>;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function siteOriginPattern(host: string): string {
  return isLoopbackHost(host) ? `http://${host}/*` : `https://${host}/*`;
}

async function ensureAutoSiteRulePermissions(rules: SiteRule[]): Promise<boolean> {
  const origins = [...new Set(
    rules
      .filter((rule) => rule.auto && !rule.disabled)
      .map((rule) => siteOriginPattern(rule.host)),
  )];
  if (!origins.length) return true;
  // Request directly from the Save click so the browser retains its user
  // activation. Chrome resolves true without another prompt for existing grants.
  const granted = await chrome.permissions.request({ origins }).catch(() => false);
  if (!granted) showStatus(t('sitePermissionDenied'), true);
  return granted;
}

function showStatus(message: string, isError = false): void {
  const status = document.getElementById('saveStatus') as HTMLElement;
  const actions = document.getElementById('stickyActions');
  if (statusTimer != null) window.clearTimeout(statusTimer);
  status.textContent = message;
  status.classList.toggle('is-error', isError);
  actions?.classList.toggle('has-status', Boolean(message));
  if (!message || isError) return;
  statusTimer = window.setTimeout(() => {
    status.textContent = '';
    status.classList.remove('is-error');
    actions?.classList.remove('has-status');
    statusTimer = undefined;
  }, 2500);
}

function showTestStatus(message: string, isError = false): void {
  const status = document.getElementById('testConnectionStatus') as HTMLElement | null;
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function requestHostPermission(apiBase: string): Promise<void> {
  try {
    const url = new URL(apiBase);
    const origin = `${url.protocol}//${url.host}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) console.warn('[TapTranslate] host permission not granted for', origin);
  } catch (err) {
    console.error('[TapTranslate] invalid apiBase:', err);
  }
}

async function runConnectionTest(): Promise<void> {
  if (saving || testing) return;
  testing = true;
  const form = document.getElementById('optionsForm') as HTMLFormElement;
  const testBtn = document.getElementById('testConnectionBtn') as HTMLButtonElement | null;
  showTestStatus(t('connTesting'), false);
  if (testBtn) testBtn.disabled = true;
  try {
    let settings: Partial<Settings>;
    let selected: ReturnType<ServiceEditor['selectedConnection']>;
    try {
      selected = serviceEditor.selectedConnection();
      settings = { ...readFormSettings(), ...selected };
      settings.apiBase = assertSecureApiBase(String(settings.apiBase || ''));
      selected.apiBase = settings.apiBase;
      (document.getElementById('apiBase') as HTMLInputElement).value = String(settings.apiBase);
    } catch (err) {
      revealSettingsError();
      if (validationCodeOf(err)?.startsWith('API_BASE')) revealSettingsElement(document.getElementById('apiBase')!);
      showTestStatus(validationCodeOf(err) ? t(validationMessageKey(err)) : t('serviceConfigurationInvalid', [err instanceof Error ? err.message : String(err)]), true);
      return;
    }

    form.inert = true;
    form.setAttribute('aria-busy', 'true');
    const permitted = await ensureApiHostPermission(String(settings.apiBase));
    if (!permitted) {
      showTestStatus(t('connPermissionRequired'), true);
      return;
    }

    const result = await testConnection({
      ...selected,
      targetLang: settings.targetLang || DEFAULTS.targetLang,
    });

    if (!result.ok && result.detail) {
      console.info('[TapTranslate] connection test detail:', result.code, result.detail);
    }
    showTestStatus(
      result.ok
        ? (result.latencyMs != null ? t('connOkMs', [formatUiNumber(result.latencyMs, uiLocale)]) : t('connOk'))
        : t(result.messageKey),
      !result.ok,
    );
  } finally {
    testing = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
    if (testBtn) testBtn.disabled = false;
  }
}

async function onSubmitOptions(event: Event): Promise<void> {
  event.preventDefault();
  if (saving || testing) return;
  const form = event.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  let settings: Partial<Settings>;
  try {
    serviceEditor.validate();
    collectContentRules(siteRuleRowsEl()!, t, true);
    settings = readFormSettings();
    settings.apiBase = assertSecureApiBase(String(settings.apiBase || ''));
  } catch (err) {
    const message = validationCodeOf(err)
      ? t(validationMessageKey(err))
      : err instanceof SiteContentValidationError ? contentErrorMessage(err, t) : t('serviceConfigurationInvalid', [err instanceof Error ? err.message : String(err)]);
    revealSettingsError();
    if (validationCodeOf(err)?.startsWith('API_BASE')) revealSettingsElement(document.getElementById('apiBase')!);
    showStatus(message, true);
    return;
  }
  saving = true;
  form.inert = true;
  form.setAttribute('aria-busy', 'true');
  try {
    const patch = Object.fromEntries(Object.entries(settings).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(loadedForm[key as keyof Settings]))) as Partial<Settings>;
    if (patch.siteRules && !(await ensureAutoSiteRulePermissions(patch.siteRules.filter(rule => rule.auto && !loadedForm.siteRules?.some(previous => previous.host === rule.host && previous.auto && !previous.disabled))))) return;
    const saved = await saveSettings(patch);
    uiLocale = normalizeUiLocale(settings.uiLocale as UiLocale);
    await localizePage(uiLocale);
    await loadSettings(saved);
    if (patch.apiBase) await requestHostPermission(patch.apiBase);
    markClean();
    showStatus(t('saved'));
  } catch (error) {
    showStatus(t('contentSaveError', [error instanceof Error ? error.message : String(error)]), true);
  } finally {
    saving = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
    refreshDirty();
  }
}

async function discardChanges(): Promise<void> {
  if (!dirty) return;
  const settings = await getSettings();
  uiLocale = settings.uiLocale || DEFAULTS.uiLocale;
  await localizePage(uiLocale);
  await loadSettings(settings);
  markClean();
  showStatus(t('discarded'));
}

async function exportSettings(): Promise<void> {
  const includeSecrets = (document.getElementById('includeSecrets') as HTMLInputElement | null)?.checked ?? false;
  const includeCustomHeaders = (document.getElementById('includeCustomHeaders') as HTMLInputElement | null)?.checked ?? false;
  if (includeSecrets && !window.confirm(t('confirmExportSecrets'))) return;
  if (includeCustomHeaders && !window.confirm(t('confirmExportCustomHeaders'))) return;

  const settings = await getSettings();
  const output = buildSettingsExport(settings, {
    includeApiKey: includeSecrets,
    includeCustomHeaders,
  });
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = includeSecrets || includeCustomHeaders
    ? 'tap-translate-settings-with-private-data.json'
    : 'tap-translate-settings.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus(t('exported'));
}

function importFieldLabel(field: string): string {
  const keys: Record<string, string> = {
    apiBase: 'apiBaseUrl',
    connectionMode: 'connectionMode',
    apiKey: 'apiKey',
    model: 'model',
    targetLang: 'targetLanguage',
    uiLocale: 'uiLocale',
    siteContentRules: 'contentRules',
    mode: 'translationMode',
    maxConcurrent: 'maxConcurrent',
    batchSize: 'batchSize',
    customHeaders: 'customHeaders',
    siteRules: 'sectionSites',
    providers: 'translationServices',
    activeProviderId: 'defaultModel',
    modelParameters: 'modelParameters',
  };
  return t(keys[field] || field);
}

async function confirmImport(patch: Partial<Settings>): Promise<boolean> {
  const dialog = document.getElementById('importPreviewDialog') as HTMLDialogElement | null;
  if (!dialog) return window.confirm(t('confirmImportOverwrite'));
  const summary = document.getElementById('importPreviewSummary');
  const list = document.getElementById('importPreviewChanges');
  if (summary) summary.textContent = t('importPreviewSummary');
  if (list) {
    list.replaceChildren();
    for (const field of Object.keys(patch)) {
      const item = document.createElement('li');
      item.textContent = t('importWillUpdate', [importFieldLabel(field)]);
      list.appendChild(item);
    }
    for (const field of ['apiKey', 'customHeaders']) {
      if (field in patch) continue;
      const item = document.createElement('li');
      item.textContent = t('importWillKeep', [importFieldLabel(field)]);
      list.appendChild(item);
    }
  }
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

async function importSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const next = await saveSettings(patch);
  uiLocale = next.uiLocale || DEFAULTS.uiLocale;
  await localizePage(uiLocale);
  await loadSettings(next);
  if (patch.apiBase && next.apiBase !== current.apiBase) await requestHostPermission(next.apiBase);

  markClean();
  showStatus(t('imported'));
}

document.addEventListener('DOMContentLoaded', () => {
  siteWorkspace = mountSiteWorkspace(t);
  serviceEditor = mountServiceEditor(t, refreshDirty, renderCustomHeaders, collectCustomHeaders);
  void (async () => {
    await ensureCatalogs();
    const settings = await getSettings();
    uiLocale = settings.uiLocale || DEFAULTS.uiLocale;
    await localizePage(uiLocale);
    await loadSettings(settings);
    markClean();
  })();

  const form = document.getElementById('optionsForm') as HTMLFormElement;
  form.addEventListener('submit', onSubmitOptions);
  const onEdit = () => { showStatus(''); showTestStatus(''); refreshDirty(); };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  (document.getElementById('discardBtn') as HTMLButtonElement).addEventListener('click', () => {
    void discardChanges();
  });

  (document.getElementById('addHeaderBtn') as HTMLButtonElement).addEventListener('click', () => addHeaderRow());
  (document.getElementById('testConnectionBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
    void runConnectionTest();
  });

  (document.getElementById('uiLocale') as HTMLSelectElement | null)?.addEventListener('change', async (e) => {
    uiLocale = normalizeUiLocale((e.target as HTMLSelectElement).value);
    await localizePage(uiLocale);
    serviceEditor.refreshLabels();
    siteRuleRowsEl()?.querySelectorAll('.site-card').forEach(card => card.dispatchEvent(new Event('content-locale')));
    siteWorkspace.refresh();
    showStatus('');
    showTestStatus('');
    refreshDirty();
  });

  customHeaderRowsEl()?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('[data-action="remove-header"]');
    if (!btn) return;
    btn.closest('.header-row')?.remove();
    updateCustomHeadersEmptyState();
    refreshDirty();
  });
  customHeaderRowsEl()?.addEventListener('input', (event) => {
    (event.target as HTMLElement).closest('.header-row')?.classList.remove('is-invalid');
  });

  (document.getElementById('exportBtn') as HTMLButtonElement).addEventListener('click', () => {
    void exportSettings();
  });
  (document.getElementById('importBtn') as HTMLButtonElement).addEventListener('click', () => {
    (document.getElementById('importFile') as HTMLInputElement).click();
  });
  (document.getElementById('importFile') as HTMLInputElement).addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const patch = prepareSettingsImport(data);
      if (await confirmImport(patch)) await importSettings(patch);
    } catch (err) {
      showStatus(validationCodeOf(err) ? t(validationMessageKey(err)) : t('importFailed'), true);
      console.error('[TapTranslate] import failed:', err);
    }
    (e.target as HTMLInputElement).value = '';
  });

  (document.getElementById('clearCacheBtn') as HTMLButtonElement).addEventListener('click', async () => {
    if (!window.confirm(t('confirmClearCache'))) return;
    await clearCache();
    showStatus(t('cacheCleared'));
  });

  (document.getElementById('addSiteRuleBtn') as HTMLButtonElement).addEventListener('click', () => {
    const container = siteRuleRowsEl();
    if (!container) return;
    const card = createSiteCard({});
    container.appendChild(card);
    siteWorkspace.refresh(card);
    updateSiteRulesEmptyState();
    (card.querySelector('[data-field="host"]') as HTMLElement | null)?.focus();
    refreshDirty();
  });

  siteRuleRowsEl()?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('[data-action="remove-site"]');
    if (!btn) return;
    btn.closest('.site-card')?.remove();
    siteWorkspace.refresh();
    updateSiteRulesEmptyState();
    refreshDirty();
  });
  siteRuleRowsEl()?.addEventListener('change', (event) => {
    const policy = (event.target as HTMLElement).closest('[data-field="policy"]');
    if (!policy) return;
    const card = policy.closest('.site-card') as HTMLElement | null;
    if (card) setSiteCardPolicyState(card);
  });
  siteRuleRowsEl()?.addEventListener('input', (event) => {
    const card = (event.target as HTMLElement).closest('.site-card');
    if (!card) return;
    card.classList.remove('is-invalid');
    (card.querySelector('[data-field="host"]') as HTMLInputElement | null)?.removeAttribute('aria-invalid');
  });

  mountSettingsNavigation();

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
});
