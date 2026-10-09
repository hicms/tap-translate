import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '../../ui/dialog';
import { useLocale } from '../../ui/locale';
import type { PreparedImport } from '../../lib/settings/backup';
import { siteProfiles } from '../../lib/sites';

export const backupLabels: Record<string, string> = {
  apiBase: 'apiBaseUrl', connectionMode: 'connectionMode', apiKey: 'apiKey', model: 'model',
  targetLang: 'targetLanguage', uiLocale: 'uiLocale', siteContentRules: 'contentRules',
  builtinSiteProfiles: 'backupBuiltinRules', mode: 'translationMode', maxConcurrent: 'maxConcurrent',
  batchSize: 'batchSize', customHeaders: 'customHeaders', siteRules: 'sectionSites',
  providers: 'translationServices', activeProviderId: 'defaultModel', modelParameters: 'modelParameters',
  onboarding: 'gistOnboarding', permissions: 'gistPermissions',
};

export function ImportPreview({ value, source, expiredCacheCount = 0, undo, blocked, onCancel, onConfirm }: {
  value: PreparedImport | null; source?: string; expiredCacheCount?: number; undo?: boolean;
  blocked: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useLocale();
  const settings = value?.kind === 'backup' ? value.backup.settings : value?.settings;
  return <Dialog id="importPreviewDialog" title={t(undo ? 'gistUndo' : 'importPreviewTitle')}
    open={value !== null} onClose={() => { if (!blocked) onCancel(); }}>
    {source ? <p className="hint">{source}</p> : null}
    <p id="importPreviewSummary" className="hint">{t(value?.kind === 'backup' ? 'backupRestoreWarning' : 'importPreviewSummary')}</p>
    {undo ? <p>{t('gistUndoWarning')}</p> : null}
    {value?.kind === 'backup' ? <div id="backupPreview">
      <p>{t('backupCounts', [value.backup.settings.providers.length, value.backup.settings.siteRules.length,
        value.backup.settings.siteContentRules.length, (value.backup.settings.builtinSiteProfiles ?? siteProfiles).length,
        Object.keys(value.backup.cache).length])}</p>
      <p>{t('backupCreated', [value.backup.createdAt, value.backup.extensionVersion])}</p>
      {expiredCacheCount > 0 ? <p>{t('gistExpiredCache', [expiredCacheCount])}</p> : null}
      <p>{t('backupPermissionHint')}</p>
      <ul>{value.backup.permissions.origins.map(origin => <li key={origin}>{origin}</li>)}</ul>
    </div> : null}
    <ul id="importPreviewChanges">
      {Object.keys(settings ?? {}).filter(field => !['schemaVersion', 'revision'].includes(field)).map(field =>
        <li key={field}>{t('importWillUpdate', [t(backupLabels[field] || field)])}</li>)}
      {['apiKey', 'customHeaders'].filter(field => !(field in (settings ?? {}))).map(field =>
        <li key={field}>{t('importWillKeep', [t(backupLabels[field]!)])}</li>)}
    </ul>
    <div className="actions">
      <Button value="cancel" label={t('cancel')} isDisabled={blocked} onClick={onCancel} />
      <Button value="confirm" variant="primary" label={t(undo ? 'gistUndo' : 'confirmImport')}
        isDisabled={blocked} onClick={onConfirm} />
    </div>
  </Dialog>;
}
