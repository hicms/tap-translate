import { getSettings, saveSettings } from '../../lib/settings/storage';
import { assertSecureApiBase, createDefaultSettings, validationCodeOf } from '../../lib/settings/schema';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { markOnboardingComplete } from '../../lib/settings/onboarding';
import { ensureCatalogs, getUiMessage, localizePage } from '../../lib/i18n';
import type { ConnectionMode } from '../../lib/types';
import { ensureApiHostPermission, isConnectionConfigured, testConnection } from '../../lib/provider/connection';
import { findProviderPreset, getProviderPreset, type ProviderPresetId } from '../../lib/provider/presets';
import { mountProviderPicker, type ProviderPickerController } from '../../lib/provider/picker';
import { resolveThinking } from '../../lib/provider/thinking';
import { isLocalApiBase } from '../../lib/provider/local-request';

let settings = createDefaultSettings();
let providerPicker: ProviderPickerController;
let busy = false;
const form = document.getElementById('onboardingForm') as HTMLFormElement;
const fields = document.getElementById('connectionFields') as HTMLFieldSetElement;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const status = document.getElementById('testStatus')!;
const options = document.getElementById('connectionOptions') as HTMLDetailsElement;
const t = (key: string, subs?: (string | number)[]) => getUiMessage(key, subs ?? null, settings.uiLocale);

function showStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  status.textContent = text;
  status.classList.toggle('is-ok', kind === 'ok');
  status.classList.toggle('is-error', kind === 'error');
}

function syncPreset(): void {
  syncMode();
  const preset = findProviderPreset(input('apiBase').value);
  providerPicker.setSelected(preset.id);
  const hint = document.getElementById('providerPresetHint')!;
  hint.textContent = t(preset.hintKey);
  // Only special-account presets need more explanation in the simple form.
  hint.hidden = preset.id !== 'ark-agent-plan';
}

function syncMode(): void {
  input('apiKey').required = input('connectionMode').value === 'direct'
    && !isLocalApiBase(input('apiBase').value);
}

function applyPreset(id: ProviderPresetId): void {
  const preset = getProviderPreset(id);
  if (preset.id === 'custom') {
    options.open = true;
    input('apiBase').focus();
    input('apiBase').select();
    return;
  }
  if (input('apiBase').value !== preset.apiBase) input('apiKey').value = '';
  input('apiBase').value = preset.apiBase;
  input('model').value = preset.model;
  input('connectionMode').value = preset.mode;
  syncMode(); syncPreset();
  input('apiKey').focus();
}

function readDraft() {
  const apiBase = assertSecureApiBase(input('apiBase').value.trim());
  const model = input('model').value.trim();
  const sameEndpoint = apiBase.replace(/\/$/, '') === settings.apiBase.replace(/\/$/, '');
  return {
    connectionMode: input('connectionMode').value as ConnectionMode,
    apiBase, apiKey: input('apiKey').value.trim(), model,
    customHeaders: sameEndpoint ? settings.customHeaders : {},
    modelParameters: sameEndpoint && model === settings.model ? settings.modelParameters : defaultModelParameters(),
    targetLang: settings.targetLang,
  };
}

function validationMessage(error: unknown): string {
  const code = validationCodeOf(error);
  const keys: Record<string, string> = {
    API_BASE_REQUIRED: 'errApiBaseRequired', API_BASE_INVALID: 'errApiBaseInvalid', API_BASE_INSECURE: 'connEndpointInsecure',
  };
  if (code?.startsWith('API_BASE')) { options.open = true; input('apiBase').focus(); }
  return t(code ? keys[code] || 'errUnknown' : 'errUnknown');
}

async function submit(action: 'test' | 'save'): Promise<void> {
  if (busy || !form.reportValidity()) return;
  let draft: ReturnType<typeof readDraft>;
  try { draft = readDraft(); } catch (error) { showStatus(validationMessage(error), 'error'); return; }
  if (!isConnectionConfigured(draft)) { showStatus(t('connConfigRequired'), 'error'); return; }
  const thinkingIssue = resolveThinking(draft).issue;
  if (thinkingIssue) { showStatus(t(thinkingIssue), 'error'); return; }
  const persistApiKey = input('rememberKey').checked;
  busy = true;
  fields.disabled = true;
  showStatus(action === 'test' ? t('connTesting') : '');
  try {
    if (!(await ensureApiHostPermission(draft.apiBase))) {
      showStatus(t('connPermissionRequired'), 'error');
      return;
    }
    if (action === 'test') {
      const result = await testConnection(draft);
      showStatus(result.ok
        ? result.latencyMs != null ? t('connOkMs', [String(result.latencyMs)]) : t('connOk')
        : t(result.messageKey), result.ok ? 'ok' : 'error');
      return;
    }
    const { targetLang: _testLanguage, ...connection } = draft;
    await saveSettings(connection, { persistApiKey });
    await markOnboardingComplete(draft.connectionMode);
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (error) {
    showStatus(validationMessage(error), 'error');
  } finally {
    busy = false;
    fields.disabled = false;
  }
}

form.addEventListener('submit', event => { event.preventDefault(); void submit('save'); });
form.addEventListener('invalid', event => {
  const element = event.target as HTMLElement;
  if (options.contains(element)) options.open = true;
}, true);
form.addEventListener('input', () => showStatus(''));
document.getElementById('testBtn')!.addEventListener('click', () => { void submit('test'); });
input('apiBase').addEventListener('input', syncPreset);
input('connectionMode').addEventListener('change', syncMode);

void (async () => {
  await ensureCatalogs();
  settings = await getSettings();
  await localizePage(settings.uiLocale);
  providerPicker = mountProviderPicker(document.getElementById('providerPicker')!, t, applyPreset);
  for (const id of ['connectionMode', 'apiBase', 'apiKey', 'model'] as const) input(id).value = settings[id];
  input('rememberKey').checked = settings.providers.find(provider => provider.id === settings.activeProviderId)!.persistApiKey;
  syncMode(); syncPreset();
  fields.disabled = false;
})().catch(() => showStatus(t('errUnknown'), 'error'));
