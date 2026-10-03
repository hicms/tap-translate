import { Button } from '@astryxdesign/core/Button';
import { mountPage } from '../../ui/mount';
import { Brand, Select } from '../../ui/fields';
import { LocaleProvider, languageKey, useLocale } from '../../ui/locale';
import { SUPPORTED_TARGET_LANGS } from '../../lib/settings/schema';
import { formatUiNumber, getUiPluralMessage } from '../../lib/i18n';
import type { Settings, TargetLang, TranslationMode } from '../../lib/types';
import { usePopup } from './use-popup';
import './style.css';

function Popup({ settings }: { settings: Settings }) {
  const { t, locale } = useLocale();
  const popup = usePopup(settings);
  const { view } = popup;
  let detail = view.detailText ?? '';
  if (!detail && view.detailKey) {
    const count = Number(view.detailSubs?.[0] ?? 0);
    detail =
      view.detailKey === 'statusTranslated'
        ? getUiPluralMessage('statusTranslatedItems', count, [formatUiNumber(count, locale)], locale)
        : t(view.detailKey, view.detailSubs);
    if (view.actionKey) detail += ` — ${t(view.actionKey)}`;
  }
  const progress = view.progress
    ? Math.min(100, Math.round((view.progress.count / view.progress.total) * 100))
    : 0;
  return (
    <div className="popup">
      <header className="popup-header">
        <Brand />
        <Button
          id="optionsLink"
          variant="ghost"
          label={t('openSettings')}
          onClick={() => {
            void chrome.runtime.openOptionsPage();
          }}
        />
      </header>
      <main className="popup-body" aria-label="TapTranslate">
        <div className="status-row" role="status">
          <span id="statusText">
            {t(popup.restored ? 'statusRestored' : view.statusKey, view.statusSubs)}
          </span>
          <span id="countText">{popup.restored ? '' : detail}</span>
        </div>
        <div
          id="progressWrap"
          className="progress"
          hidden={!view.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('progressLabel')}
        >
          <div id="progressBar" style={{ width: `${progress}%` }} />
        </div>
        <Select
          id="targetLang"
          label={t('translateTo')}
          value={popup.preferences.targetLang}
          disabled={!view.controlsEnabled}
          onChange={(value) => {
            void popup.changePreferences({
              ...popup.preferences,
              targetLang: value as TargetLang,
            });
          }}
          options={[
            ...SUPPORTED_TARGET_LANGS.map((code) => ({
              value: code,
              label: t(languageKey(code)),
            })),
          ]}
        />
        <Select
          id="mode"
          label={t('displayStyle')}
          value={popup.preferences.mode}
          disabled={!view.controlsEnabled}
          onChange={(value) => {
            void popup.changePreferences({
              ...popup.preferences,
              mode: value as TranslationMode,
            });
          }}
          options={[
            { value: 'bilingual', label: t('modeBilingual') },
            { value: 'replace', label: t('modeReplace') },
          ]}
        />
        <Button
          id="primaryBtn"
          width="100%"
          size="lg"
          variant="primary"
          label={t(view.primaryKey)}
          hidden={view.primary === 'none'}
          isDisabled={view.primaryDisabled}
          onClick={() => {
            void popup.act(view.primary);
          }}
        />
        <div id="secondaryRow" hidden={!view.showSecondaryRestore}>
          <Button
            id="secondaryBtn"
            width="100%"
            variant="ghost"
            label={t('restoreOriginal')}
            onClick={() => {
              void popup.act('restore');
            }}
          />
        </div>
        <details id="sitePreferences">
          <summary>
            {t('popupSitePreferences')}
            <span id="sitePolicySummary">
              {popup.policy === 'global'
                ? ''
                : t(popup.policy === 'never' ? 'sitePolicyNever' : 'sitePolicyAuto')}
            </span>
          </summary>
          <Select
            id="sitePolicy"
            label={t('sitePolicy')}
            hint={t('sitePolicyPopupHint')}
            value={popup.policy}
            disabled={!view.controlsEnabled || !popup.snapshot.configured || popup.policySaving}
            onChange={(value) => {
              void popup.changePolicy(value as 'global' | 'auto' | 'never');
            }}
            options={[
              { value: 'global', label: t('sitePolicyGlobal') },
              { value: 'auto', label: t('sitePolicyAuto') },
              { value: 'never', label: t('sitePolicyNever') },
            ]}
          />
        </details>
      </main>
    </div>
  );
}
void mountPage((settings) => (
  <LocaleProvider locale={settings.uiLocale} title="extName">
    <Popup settings={settings} />
  </LocaleProvider>
));
