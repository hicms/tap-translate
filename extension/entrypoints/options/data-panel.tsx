import { useContext, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Check, FormDisabled } from '../../ui/fields';
import { Dialog } from '../../ui/dialog';
import { useLocale } from '../../ui/locale';
import { clearCache } from '../../lib/cache';
import { getSettings } from '../../lib/settings/storage';
import { createFullBackup, MAX_BACKUP_BYTES, parseImportFile, type PreparedImport } from '../../lib/settings/backup';
import { buildSettingsExport } from '../../lib/settings/transfer';

export function DataPanel({
  onImport,
  report,
  dirty,
}: {
  onImport: (value: PreparedImport) => Promise<void>;
  dirty: boolean;
  report: (text: string, error?: boolean) => void;
}) {
  const { t } = useLocale();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [includeHeaders, setIncludeHeaders] = useState(false);
  const [preview, setPreview] = useState<PreparedImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmation, setConfirmation] = useState<'export' | 'backup' | 'cache' | null>(null);
  const locked = useContext(FormDisabled);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const blocked = locked || importing || exporting;
  const previewSettings = preview?.kind === 'settings' ? preview.settings : preview?.backup.settings;
  async function exportSettings(full = false) {
    if (dirty || blocked || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const output = full ? await createFullBackup() : buildSettingsExport(await getSettings(), {
        includeApiKey: includeSecrets,
        includeCustomHeaders: includeHeaders,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(output, null, 2)], {
          type: 'application/json',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download =
        full ? `tap-translate-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json` : includeSecrets || includeHeaders
          ? 'tap-translate-settings-with-private-data.json'
          : 'tap-translate-settings.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(t('exported'));
    } catch (error) {
      report(error instanceof Error ? error.message : t('errUnknown'), true);
    } finally {
      exportingRef.current = false;
      setExporting(false);
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
    builtinSiteProfiles: 'backupBuiltinRules',
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
        <Button id="clearCacheBtn" isDisabled={blocked} label={t('clearCache')} onClick={() => setConfirmation('cache')} />
      </div>
      <div className="data-block">
        <h3>{t('sectionImportExport')}</h3>
        <p className="hint">{t('backupSavedOnly')}</p>
        {dirty ? <p role="status">{t('backupUnsaved')}</p> : null}
        <div className="actions-inline">
          <Button
            id="exportBtn"
            label={t('exportSettings')}
            isDisabled={blocked || dirty}
            onClick={() => {
              if (includeSecrets || includeHeaders) setConfirmation('export');
              else void exportSettings();
            }}
          />
          <div id="importFile" className="import-file">
            <FileInput
              label={t('importSettings')}
              isLabelHidden
              placeholder={t('importSettings')}
              value={null}
              isDisabled={blocked || dirty}
              width="100%"
              accept="application/json,.json"
              onChange={(files) => {
                const selected = Array.isArray(files) ? files[0] : files;
                if (selected && selected.size > MAX_BACKUP_BYTES) { report(t('backupTooLarge'), true); return; }
                if (selected)
                  void selected
                    .text()
                    .then((text) => setPreview(parseImportFile(text)))
                    .catch((error) =>
                      report(
                        `${t('importFailed')}: ${error instanceof Error ? error.message : String(error)}`,
                        true,
                      ),
                    );
              }}
            />
          </div>
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
      <div className="data-block">
        <h3>{t('backupTitle')}</h3>
        <p className="hint">{t('backupScope')}</p>
        <Button id="fullBackupBtn" label={t('backupExport')} isDisabled={blocked || dirty} onClick={() => setConfirmation('backup')} />
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
          {t(preview?.kind === 'backup' ? 'backupRestoreWarning' : 'importPreviewSummary')}
        </p>
        {preview?.kind === 'backup' ? (
          <div id="backupPreview">
            <p>{t('backupCounts', [preview.backup.settings.providers.length, preview.backup.settings.siteRules.length, preview.backup.settings.siteContentRules.length, preview.backup.settings.builtinSiteProfiles!.length, Object.keys(preview.backup.cache).length])}</p>
            <p>{t('backupCreated', [preview.backup.createdAt, preview.backup.extensionVersion])}</p>
            <p>{t('backupPermissionHint')}</p>
            <ul>{preview.backup.permissions.origins.map(origin => <li key={origin}>{origin}</li>)}</ul>
          </div>
        ) : null}
        <ul id="importPreviewChanges">
          {Object.keys(previewSettings ?? {}).filter(field => !['schemaVersion', 'revision'].includes(field)).map((field) => (
            <li key={field}>{t('importWillUpdate', [t(labels[field] || field)])}</li>
          ))}
          {['apiKey', 'customHeaders']
            .filter((field) => !(field in (previewSettings ?? {})))
            .map((field) => (
              <li key={field}>{t('importWillKeep', [t(labels[field]!)])}</li>
            ))}
        </ul>
        <div className="actions">
          <Button
            value="cancel"
            label={t('cancel')}
            isDisabled={blocked}
            onClick={() => setPreview(null)}
          />
          <Button
            value="confirm"
            variant="primary"
            label={t('confirmImport')}
            isDisabled={blocked}
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
      <Dialog
        id="dataConfirmDialog"
        title={t(confirmation === 'cache' ? 'clearCache' : confirmation === 'backup' ? 'backupExport' : 'exportSettings')}
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
      >
        {confirmation === 'cache' ? (
          <p>{t('confirmClearCache')}</p>
        ) : confirmation === 'backup' ? <p>{t('backupPrivateWarning')}</p> : (
          <>
            {includeSecrets ? <p>{t('confirmExportSecrets')}</p> : null}
            {includeHeaders ? <p>{t('confirmExportCustomHeaders')}</p> : null}
          </>
        )}
        <div className="actions">
          <Button value="cancel" label={t('cancel')} onClick={() => setConfirmation(null)} />
          <Button
            value="confirm"
            variant="primary"
            label={t(confirmation === 'cache' ? 'clearCache' : confirmation === 'backup' ? 'backupExport' : 'exportSettings')}
            onClick={() => {
              if (confirmation === 'cache')
                void clearCache()
                  .then(() => report(t('cacheCleared')))
                  .catch((error) => report(String(error), true));
              else void exportSettings(confirmation === 'backup');
              setConfirmation(null);
            }}
          />
        </div>
      </Dialog>
    </>
  );
}
