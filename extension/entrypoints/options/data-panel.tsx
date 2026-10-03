import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Check } from '../../ui/fields';
import { Dialog } from '../../ui/dialog';
import { useLocale } from '../../ui/locale';
import { clearCache } from '../../lib/cache';
import { getSettings } from '../../lib/settings/storage';
import { buildSettingsExport, prepareSettingsImport } from '../../lib/settings/transfer';
import type { Settings } from '../../lib/types';

export function DataPanel({
  onImport,
  report,
}: {
  onImport: (patch: Partial<Settings>) => Promise<void>;
  report: (text: string, error?: boolean) => void;
}) {
  const { t } = useLocale();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [includeHeaders, setIncludeHeaders] = useState(false);
  const [preview, setPreview] = useState<Partial<Settings> | null>(null);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function exportSettings() {
    if (includeSecrets && !window.confirm(t('confirmExportSecrets'))) return;
    if (includeHeaders && !window.confirm(t('confirmExportCustomHeaders'))) return;
    try {
      const output = buildSettingsExport(await getSettings(), {
        includeApiKey: includeSecrets,
        includeCustomHeaders: includeHeaders,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download =
        includeSecrets || includeHeaders
          ? 'tap-translate-settings-with-private-data.json'
          : 'tap-translate-settings.json';
      link.click();
      URL.revokeObjectURL(url);
      report(t('exported'));
    } catch (error) {
      report(error instanceof Error ? error.message : t('errUnknown'), true);
    }
  }
  const labels: Record<string, string> = {
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
  return (
    <>
      <div className="section-head">
        <h2 id="section-data-title">{t('sectionData')}</h2>
      </div>
      <ul className="privacy-list">
        {['privacyTextDestination', 'privacySecretsLocal', 'privacyNoCloud'].map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <div className="data-block">
        <h3>{t('sectionCache')}</h3>
        <p className="hint">{t('cacheHint')}</p>
        <Button
          id="clearCacheBtn"
          label={t('clearCache')}
          onClick={() => {
            if (window.confirm(t('confirmClearCache')))
              void clearCache()
                .then(() => report(t('cacheCleared')))
                .catch((error) => report(String(error), true));
          }}
        />
      </div>
      <div className="data-block">
        <h3>{t('sectionImportExport')}</h3>
        <div className="actions-inline">
          <Button
            id="exportBtn"
            label={t('exportSettings')}
            onClick={() => {
              void exportSettings();
            }}
          />
          <Button id="importBtn" label={t('importSettings')} onClick={() => file.current?.click()} />
          <input
            id="importFile"
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              if (selected)
                void selected
                  .text()
                  .then((text) => setPreview(prepareSettingsImport(JSON.parse(text))))
                  .catch((error) =>
                    report(
                      `${t('importFailed')}: ${error instanceof Error ? error.message : String(error)}`,
                      true,
                    ),
                  );
            }}
          />
        </div>
        <Check
          id="includeSecrets"
          label={t('includeSecrets')}
          checked={includeSecrets}
          onChange={setIncludeSecrets}
        />
        <Check
          id="includeCustomHeaders"
          label={t('includeCustomHeaders')}
          checked={includeHeaders}
          onChange={setIncludeHeaders}
        />
        <p className="hint">{t('exportPrivacyHint')}</p>
      </div>
      <Dialog
        id="importPreviewDialog"
        title={t('importPreviewTitle')}
        open={preview !== null}
        onClose={() => {
          if (!importing) setPreview(null);
        }}
      >
        <p id="importPreviewSummary" className="hint">
          {t('importPreviewSummary')}
        </p>
        <ul id="importPreviewChanges">
          {Object.keys(preview ?? {}).map((field) => (
            <li key={field}>{t('importWillUpdate', [t(labels[field] || field)])}</li>
          ))}
          {['apiKey', 'customHeaders']
            .filter((field) => !(field in (preview ?? {})))
            .map((field) => (
              <li key={field}>{t('importWillKeep', [t(labels[field]!)])}</li>
            ))}
        </ul>
        <div className="actions">
          <Button
            value="cancel"
            label={t('cancel')}
            isDisabled={importing}
            onClick={() => setPreview(null)}
          />
          <Button
            value="confirm"
            variant="primary"
            label={t('confirmImport')}
            isDisabled={importing}
            onClick={() => {
              if (!preview || importing) return;
              setImporting(true);
              void onImport(preview)
                .then(() => setPreview(null))
                .catch((error) => report(String(error), true))
                .finally(() => setImporting(false));
            }}
          />
        </div>
      </Dialog>
    </>
  );
}
