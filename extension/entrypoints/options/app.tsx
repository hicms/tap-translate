import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@astryxdesign/core/Button';
import { Brand, Select, FormDisabled, focusField } from '../../ui/fields';
import { LocaleProvider, languageKey, useLocale } from '../../ui/locale';
import {
  SUPPORTED_TARGET_LANGS,
  SUPPORTED_UI_LOCALES,
  activeProviderFields,
  assertSecureApiBase,
  validationCodeOf,
} from '../../lib/settings/schema';
import { getSettings, saveSettings } from '../../lib/settings/storage';
import { ensureApiHostPermission, testConnection } from '../../lib/provider/connection';
import { formatUiNumber } from '../../lib/i18n';
import type { Settings, SiteRule } from '../../lib/types';
import {
  DraftError,
  optionsDraft,
  readOptions,
  readProvider,
  settingsPatch,
  type OptionsDraft,
} from './draft';
import { ServiceWorkspace, type ServiceSelection } from './service-workspace';
import { SiteWorkspace } from './site-editor';
import { restoreFullBackup } from '../../lib/settings/backup';
import { withDataTransferLock } from '../../lib/backup/lock';
import { DataPanel } from './data-panel';

const sections = ['connection', 'reading', 'sites', 'data'] as const;
type Section = (typeof sections)[number];
const sectionLabels = {
  connection: 'navConnection',
  reading: 'navReading',
  sites: 'navSites',
  data: 'navData',
};
function currentSection(): Section {
  const value = location.hash.replace('#section-', '');
  return sections.find((section) => section === value) ?? 'connection';
}
function activeSelection(settings: Pick<Settings, 'providers' | 'activeProviderId'>): ServiceSelection {
  const provider = settings.providers.find((item) => item.id === settings.activeProviderId)!;
  return { providerId: provider.id, modelId: provider.activeModelId };
}

export function OptionsApp({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState(() => optionsDraft(settings));
  return (
    <LocaleProvider locale={draft.uiLocale} title="optionsTitle">
      <OptionsContent settings={settings} draft={draft} setDraft={setDraft} />
    </LocaleProvider>
  );
}

function OptionsContent({
  settings,
  draft,
  setDraft,
}: {
  settings: Settings;
  draft: OptionsDraft;
  setDraft: React.Dispatch<React.SetStateAction<OptionsDraft>>;
}) {
  const { t, locale } = useLocale();
  const baseline = useRef(settings);
  // Compare the same form representation on both sides: the site workspace
  // orders built-ins before custom hosts, unlike storage/import ordering.
  const [savedValues, setSavedValues] = useState(() => readOptions(draft, t, false));
  const clean = useRef(JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== clean.current;
  const [section, setSection] = useState<Section>(currentSection);
  const [selection, setSelection] = useState(() => activeSelection(settings));
  const [serviceTab, setServiceTab] = useState('basic');
  const [serviceEditing, setServiceEditing] = useState(true);
  const [siteId, setSiteId] = useState(draft.sites[0]?.id ?? '');
  const [siteTabs, setSiteTabs] = useState<Record<string, string>>({});
  const [siteEditing, setSiteEditing] = useState(true);
  const [error, setError] = useState<DraftError | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const busyRef = useRef(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const [testStatus, setTestStatus] = useState({ text: '', error: false });
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function report(text: string, isError = false) {
    clearTimeout(statusTimer.current);
    setStatus({ text, error: isError });
    if (!isError) statusTimer.current = setTimeout(() => setStatus({ text: '', error: false }), 2500);
  }
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  useEffect(() => {
    const sync = () => setSection(currentSection());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function navigate(next: Section) {
    setSection(next);
    if (location.hash !== `#section-${next}`) history.pushState(null, '', `#section-${next}`);
  }
  function edit(patch: Partial<OptionsDraft>) {
    setError(null);
    setDraft((value) => ({ ...value, ...patch }));
  }
  function selectService(next: ServiceSelection, activate = true) {
    setSelection(next);
    setTestStatus({ text: '', error: false });
    if (activate)
      setDraft((value) => ({
        ...value,
        activeProviderId: next.providerId,
        providers: value.providers.map((provider) =>
          provider.id === next.providerId ? { ...provider, activeModelId: next.modelId } : provider,
        ),
      }));
  }
  function replace(saved: Settings) {
    setSettingsVersion(version => version + 1);
    const next = optionsDraft(saved);
    // Keep editor identity/navigation while replacing its saved data.
    next.sites = next.sites.map((site) => ({
      ...site,
      id: draft.sites.find((previous) => previous.host === site.host)?.id ?? site.id,
    }));
    const host = draft.sites.find((site) => site.id === siteId)?.host;
    const preferred = next.sites.find((site) => site.host === host) ?? next.sites[0];
    baseline.current = saved;
    setSavedValues(readOptions(next, t, false));
    clean.current = JSON.stringify(next);
    setDraft(next);
    setSelection(activeSelection(saved));
    setSiteId(preferred?.id ?? '');
    setError(null);
  }
  function reveal(element: HTMLElement) {
    const targetSection = element.closest<HTMLElement>('[id^="section-"]')?.id.replace('section-', '') as
      | Section
      | undefined;
    const panel = element.closest<HTMLElement>('[data-editor-panel]')?.dataset.editorPanel;
    const card = element.closest<HTMLElement>('[data-site-id]');
    flushSync(() => {
      if (targetSection) navigate(targetSection);
      if (targetSection === 'connection') {
        setServiceEditing(true);
        if (panel) setServiceTab(panel);
      }
      if (card) {
        setSiteEditing(true);
        setSiteId(card.dataset.siteId!);
        if (panel) setSiteTabs((value) => ({ ...value, [card.dataset.siteId!]: panel }));
      }
    });
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (element.id) focusField(element.id);
    else element.focus();
    element.scrollIntoView({ block: 'center' });
  }
  function handleError(failure: unknown) {
    if (failure instanceof DraftError) {
      const location = failure.location;
      flushSync(() => {
        setError(failure);
        if (location.siteId) {
          navigate('sites');
          setSiteEditing(true);
          setSiteId(location.siteId);
          setSiteTabs((value) => ({
            ...value,
            [location.siteId!]: location.field === 'host' ? 'preferences' : 'content',
          }));
        }
        if (location.providerId) {
          navigate('connection');
          setServiceEditing(true);
          setSelection({
            providerId: location.providerId,
            modelId:
              location.modelId ??
              draft.providers.find((provider) => provider.id === location.providerId)!.activeModelId,
          });
          setServiceTab(['model', 'apiKey'].includes(location.field) ? 'basic' : 'advanced');
        }
      });
      const element = document.getElementById(
        location.siteId ? `site-${location.siteId}-${location.field}` : location.field,
      );
      if (element) reveal(element);
    }
    const code = validationCodeOf(failure);
    const messages: Record<string, string> = {
      API_BASE_REQUIRED: 'errApiBaseRequired',
      API_BASE_INVALID: 'errApiBaseInvalid',
      API_BASE_INSECURE: 'connEndpointInsecure',
    };
    return code
      ? t(messages[code] ?? 'errUnknown')
      : failure instanceof Error
        ? failure.message
        : String(failure);
  }
  async function ensureSitePermissions(rules: SiteRule[]) {
    const origins = [
      ...new Set(
        rules
          .filter(
            (rule) =>
              rule.auto &&
              !rule.disabled &&
              !baseline.current.siteRules.some((old) => old.host === rule.host && old.auto && !old.disabled),
          )
          .map(
            (rule) =>
              `${['localhost', '127.0.0.1', '[::1]', '::1'].includes(rule.host) ? 'http' : 'https'}://${rule.host}/*`,
          ),
      ),
    ];
    if (origins.length && !(await chrome.permissions.request({ origins }).catch(() => false)))
      throw new Error(t('sitePermissionDenied'));
  }
  async function persist(patch: Partial<Settings>, permissionRequested = false) {
    if (patch.siteRules && !permissionRequested) await ensureSitePermissions(patch.siteRules);
    const saved = await saveSettings(patch);
    if (patch.apiBase && saved.apiBase !== baseline.current.apiBase)
      await ensureApiHostPermission(saved.apiBase);
    replace(saved);
  }
  async function save() {
    if (busyRef.current) return;
    try {
      const value = readOptions(draft, t);
      value.apiBase = assertSecureApiBase(String(value.apiBase));
      if (!(document.getElementById('optionsForm') as HTMLFormElement).reportValidity()) return;
      const patch = settingsPatch(value, savedValues);
      busyRef.current = true;
      setBusy(true);
      await persist(patch);
      report(t('saved'));
    } catch (failure) {
      report(handleError(failure), true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function test() {
    if (busyRef.current) return;
    try {
      const provider = readProvider(draft.providers.find((item) => item.id === selection.providerId)!, t);
      const connection = activeProviderFields(
        [{ ...provider, activeModelId: selection.modelId }],
        provider.id,
      );
      connection.apiBase = assertSecureApiBase(connection.apiBase);
      busyRef.current = true;
      setBusy(true);
      setTesting(true);
      setTestStatus({ text: t('connTesting'), error: false });
      if (!(await ensureApiHostPermission(connection.apiBase))) {
        setTestStatus({ text: t('connPermissionRequired'), error: true });
        return;
      }
      const result = await testConnection({
        ...connection,
        targetLang: draft.targetLang,
      });
      setTestStatus({
        text: result.ok
          ? result.latencyMs != null
            ? t('connOkMs', [formatUiNumber(result.latencyMs, locale)])
            : t('connOk')
          : t(result.messageKey),
        error: !result.ok,
      });
    } catch (failure) {
      setTestStatus({ text: handleError(failure), error: true });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTesting(false);
    }
  }
  return (
    <FormDisabled value={busy}>
      <div className="page">
        <header className="page-header">
          <Brand />
        </header>
        <div className="settings-layout">
          <nav
            className="section-nav"
            aria-label={t('optionsNavLabel')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const index = sections.indexOf(section);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? sections.length - 1
                    : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + sections.length) %
                      sections.length;
              navigate(sections[next]!);
              event.currentTarget.querySelectorAll<HTMLAnchorElement>('a')[next]?.focus();
            }}
          >
            {sections.map((value) => (
              <a
                key={value}
                href={`#section-${value}`}
                data-section-nav={`section-${value}`}
                className={section === value ? 'is-active' : ''}
                aria-current={section === value ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(value);
                }}
              >
                {t(sectionLabels[value])}
              </a>
            ))}
          </nav>
          <main>
            <form
              id="optionsForm"
              className="page-body"
              noValidate
              inert={busy}
              aria-busy={busy || undefined}
              onSubmit={(event) => {
                event.preventDefault();
                if (busyRef.current) return;
                // Validate all saved drafts first; native validity covers the visible
                // editor without losing errors from a different provider/site.
                void save();
              }}
              onInvalidCapture={(event) => reveal(event.target as HTMLElement)}
            >
              <section
                id="section-connection"
                className="settings-section"
                hidden={section !== 'connection'}
                aria-labelledby="section-connection-title"
              >
                <ServiceWorkspace
                  draft={draft}
                  selection={selection}
                  onChange={(providers, activeProviderId) => edit({ providers, activeProviderId })}
                  onSelect={selectService}
                  tab={serviceTab}
                  setTab={setServiceTab}
                  editing={serviceEditing}
                  setEditing={setServiceEditing}
                  onTest={() => {
                    void test();
                  }}
                  testStatus={testStatus}
                  testing={testing}
                />
              </section>
              <section
                id="section-reading"
                className="settings-section"
                hidden={section !== 'reading'}
                aria-labelledby="section-reading-title"
              >
                <div className="section-head">
                  <h2 id="section-reading-title">{t('sectionReading')}</h2>
                  <p className="hint">{t('minimalReadingHint')}</p>
                </div>
                <Select
                  id="uiLocale"
                  label={t('uiLocale')}
                  value={draft.uiLocale}
                  onChange={(value) => edit({ uiLocale: value as Settings['uiLocale'] })}
                  options={[
                    ...SUPPORTED_UI_LOCALES.map((code) => ({
                      value: code,
                      label: t(languageKey(code, 'ui')),
                    })),
                  ]}
                />
                <Select
                  id="targetLang"
                  label={t('targetLanguage')}
                  value={draft.targetLang}
                  onChange={(value) => edit({ targetLang: value as Settings['targetLang'] })}
                  options={[
                    ...SUPPORTED_TARGET_LANGS.map((code) => ({
                      value: code,
                      label: t(languageKey(code)),
                    })),
                  ]}
                />
                <Select
                  id="mode"
                  label={t('translationMode')}
                  hint={t('translationModeHint')}
                  value={draft.mode}
                  onChange={(value) => edit({ mode: value as Settings['mode'] })}
                  options={[
                    { value: 'bilingual', label: t('modeBilingual') },
                    { value: 'replace', label: t('modeReplace') },
                  ]}
                />
              </section>
              <section
                id="section-sites"
                className="settings-section"
                hidden={section !== 'sites'}
                aria-labelledby="section-sites-title"
              >
                <SiteWorkspace
                  profiles={draft.builtinSiteProfiles ?? undefined}
                  sites={draft.sites}
                  onChange={(sites) => edit({ sites })}
                  selectedId={siteId}
                  onSelect={setSiteId}
                  tabs={siteTabs}
                  onTab={(id, tab) => setSiteTabs((value) => ({ ...value, [id]: tab }))}
                  editing={siteEditing}
                  setEditing={setSiteEditing}
                  error={error}
                />
              </section>
              <section
                id="section-data"
                className="settings-section"
                hidden={section !== 'data'}
                aria-labelledby="section-data-title"
              >
                <DataPanel
                  settingsVersion={settingsVersion}
                  dirty={dirty}
                  report={report}
                  onImport={async (value, options) => {
                    if (busyRef.current) return;
                    busyRef.current = true;
                    setBusy(true);
                    try {
                      if (value.kind === 'backup') {
                        replace(await restoreFullBackup(value.backup, options));
                        report(t('backupRestored'));
                      } else {
                        if (value.settings.siteRules) await ensureSitePermissions(value.settings.siteRules);
                        await withDataTransferLock(() => persist(value.settings, true));
                        report(t('imported'));
                      }
                    } finally {
                      busyRef.current = false;
                      setBusy(false);
                    }
                  }}
                />
              </section>
              <footer id="stickyActions" className="sticky-actions">
                <div className="save-messages">
                  <span
                    id="saveStatus"
                    className={`save-status ${status.error ? 'is-error' : ''}`}
                    role="status"
                  >
                    {status.text}
                  </span>
                  <p id="saveTiming" className="hint" hidden={section !== 'sites'}>
                    {t('workspaceSaveHint')}
                  </p>
                </div>
                <Button
                  id="discardBtn"
                  variant="ghost"
                  label={t('discardChanges')}
                  isDisabled={!dirty || busy}
                  onClick={() => {
                    void getSettings()
                      .then((saved) => {
                        replace(saved);
                        report(t('discarded'));
                      })
                      .catch((failure) => report(handleError(failure), true));
                  }}
                />
                <Button
                  id="saveBtn"
                  type="submit"
                  variant="primary"
                  label={t('save')}
                  isDisabled={!dirty || busy}
                />
              </footer>
            </form>
          </main>
        </div>
      </div>
    </FormDisabled>
  );
}
