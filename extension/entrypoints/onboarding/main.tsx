import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { mountPage } from '../../ui/mount';
import { Brand, Check, Input, Select } from '../../ui/fields';
import { ProviderPicker } from '../../ui/provider-picker';
import { LocaleProvider, useLocale } from '../../ui/locale';
import { saveSettings } from '../../lib/settings/storage';
import { assertSecureApiBase, validationCodeOf } from '../../lib/settings/schema';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { markOnboardingComplete } from '../../lib/settings/onboarding';
import {
  ensureApiHostPermission,
  isConnectionConfigured,
  testConnection,
} from '../../lib/provider/connection';
import { findProviderPreset, getProviderPreset, type ProviderPresetId } from '../../lib/provider/presets';
import { resolveThinking } from '../../lib/provider/thinking';
import { isLocalApiBase } from '../../lib/provider/local-request';
import type { ConnectionMode, Settings } from '../../lib/types';
import './style.css';

function Onboarding({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState({
    connectionMode: settings.connectionMode,
    apiBase: settings.apiBase,
    apiKey: settings.apiKey,
    model: settings.model,
  });
  const [remember, setRemember] = useState(
    settings.providers.find((provider) => provider.id === settings.activeProviderId)!.persistApiKey,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const form = useRef<HTMLFormElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const preset = findProviderPreset(draft.apiBase);
  function update(patch: Partial<typeof draft>) {
    setDraft((value) => ({ ...value, ...patch }));
    setStatus({ text: '', error: false });
  }
  function applyPreset(id: ProviderPresetId) {
    const next = getProviderPreset(id);
    if (id === 'custom') {
      options.current!.open = true;
      document.getElementById('apiBase')?.focus();
      return;
    }
    update({
      apiBase: next.apiBase,
      model: next.model,
      connectionMode: next.mode,
      apiKey: next.apiBase === draft.apiBase ? draft.apiKey : '',
    });
    document.getElementById('apiKey')?.focus();
  }
  async function submit(action: 'test' | 'save') {
    if (busy || !form.current!.reportValidity()) return;
    try {
      const apiBase = assertSecureApiBase(draft.apiBase.trim());
      const sameEndpoint = apiBase.replace(/\/$/, '') === settings.apiBase.replace(/\/$/, '');
      const connection = {
        ...draft,
        apiBase,
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
        customHeaders: sameEndpoint ? settings.customHeaders : {},
        modelParameters:
          sameEndpoint && draft.model.trim() === settings.model
            ? settings.modelParameters
            : defaultModelParameters(),
      };
      if (!isConnectionConfigured(connection)) {
        setStatus({ text: t('connConfigRequired'), error: true });
        return;
      }
      const issue = resolveThinking(connection).issue;
      if (issue) {
        setStatus({ text: t(issue), error: true });
        return;
      }
      setBusy(true);
      setStatus({ text: action === 'test' ? t('connTesting') : '', error: false });
      if (!(await ensureApiHostPermission(apiBase))) {
        setStatus({ text: t('connPermissionRequired'), error: true });
        return;
      }
      if (action === 'test') {
        const result = await testConnection({ ...connection, targetLang: settings.targetLang });
        setStatus({
          text: result.ok
            ? result.latencyMs != null
              ? t('connOkMs', [String(result.latencyMs)])
              : t('connOk')
            : t(result.messageKey),
          error: !result.ok,
        });
      } else {
        await saveSettings(connection, { persistApiKey: remember });
        await markOnboardingComplete(connection.connectionMode);
        await chrome.runtime.openOptionsPage();
        window.close();
      }
    } catch (error) {
      const code = validationCodeOf(error);
      const keys: Record<string, string> = {
        API_BASE_REQUIRED: 'errApiBaseRequired',
        API_BASE_INVALID: 'errApiBaseInvalid',
        API_BASE_INSECURE: 'connEndpointInsecure',
      };
      if (code?.startsWith('API_BASE')) {
        options.current!.open = true;
        document.getElementById('apiBase')?.focus();
      }
      setStatus({
        text: code ? t(keys[code] || 'errUnknown') : error instanceof Error ? error.message : t('errUnknown'),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding">
      <Brand />
      <h1>{t('onboardingSimpleTitle')}</h1>
      <p className="intro hint">{t('onboardingSimpleHint')}</p>
      <form
        id="onboardingForm"
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit('save');
        }}
        onInvalidCapture={(event) => {
          if (options.current?.contains(event.target as Node)) options.current.open = true;
        }}
      >
        <fieldset id="connectionFields" disabled={busy}>
          <legend className="sr-only">{t('onboardingSimpleTitle')}</legend>
          <div className="field">
            <p id="providerPresetLabel">{t('simpleService')}</p>
            <ProviderPicker selected={preset.id} onSelect={applyPreset} />
            <p id="providerPresetHint" className="hint" hidden={preset.id !== 'ark-agent-plan'}>
              {t(preset.hintKey)}
            </p>
          </div>
          <Input
            id="apiKey"
            label={t('apiKey')}
            type="password"
            value={draft.apiKey}
            autoComplete="off"
            placeholder="sk-..."
            required={draft.connectionMode === 'direct' && !isLocalApiBase(draft.apiBase)}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
          <Input
            id="model"
            label={t('model')}
            value={draft.model}
            required
            maxLength={200}
            onChange={(event) => update({ model: event.target.value })}
          />
          <details id="connectionOptions" ref={options}>
            <summary>{t('connectionOptions')}</summary>
            <Select
              id="connectionMode"
              label={t('connectionMode')}
              value={draft.connectionMode}
              onChange={(event) => update({ connectionMode: event.target.value as ConnectionMode })}
            >
              <option value="direct">{t('directApi')}</option>
              <option value="proxy">{t('connectionModeProxy')}</option>
            </Select>
            <Input
              id="apiBase"
              label={t('apiBaseUrl')}
              type="url"
              required
              value={draft.apiBase}
              onChange={(event) => update({ apiBase: event.target.value })}
            />
          </details>
          <Check
            id="rememberKey"
            label={t('rememberApiKey')}
            checked={remember}
            onChange={setRemember}
            hint={t('rememberApiKeyHint')}
          />
          <p className="hint privacy">{t('privacyTextDestination')}</p>
          <div className="actions">
            <Button
              id="testBtn"
              label={t('testConnection')}
              isDisabled={busy}
              onClick={() => {
                void submit('test');
              }}
            />
            <Button
              id="finishBtn"
              type="submit"
              variant="primary"
              label={t('onboardingSaveStart')}
              isDisabled={busy}
            />
          </div>
        </fieldset>
        <p id="testStatus" className={`test-status ${status.error ? 'is-error' : 'is-ok'}`} role="status">
          {status.text}
        </p>
      </form>
      <a id="openSettings" href="options.html">
        {t('openSettings')}
      </a>
    </main>
  );
}
void mountPage((settings) => (
  <LocaleProvider locale={settings.uiLocale} title="onboardingTitle">
    <Onboarding settings={settings} />
  </LocaleProvider>
));
