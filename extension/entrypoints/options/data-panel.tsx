import { useContext, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { FormDisabled } from '../../ui/fields';
import { Dialog } from '../../ui/dialog';
import { useLocale } from '../../ui/locale';
import { clearCache } from '../../lib/cache';
import { createFullBackup, MAX_BACKUP_BYTES, parseImportFile, restoreFingerprint,
  type LocalRestoreSnapshot, type PreparedImport, type RestoreOptions } from '../../lib/settings/backup';
import { withDataTransferLock } from '../../lib/backup/lock';
import type { DownloadedBackup } from '../../lib/backup/gist';
import { backupErrorText } from './backup-ui';
import { ImportPreview } from './import-preview';
import { GistPanel } from './gist-panel';

interface Preview { value: PreparedImport; fingerprint: string; source?: string; expired?: number; undo?: boolean }

export function DataPanel({ onImport, report, dirty, settingsVersion }: {
  onImport: (value: PreparedImport, options?: RestoreOptions) => Promise<void>;
  dirty: boolean; settingsVersion: number; report: (text: string, error?: boolean) => void;
}) {
  const { t } = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [undo, setUndo] = useState<LocalRestoreSnapshot | null>(null);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<'export' | 'cache' | null>(null);
  const locked = useContext(FormDisabled);
  const blocked = locked || working || cloudBusy;

  async function prepare(value: PreparedImport, details?: Partial<Preview>) {
    setPreview({ ...details, value, fingerprint: await restoreFingerprint() });
  }
  function run(action: () => Promise<void>, importing = false) {
    if (blocked || workingRef.current) return;
    workingRef.current = true; setWorking(true);
    void action().catch(error => report(`${importing ? `${t('importFailed')}: ` : ''}${backupErrorText(error, t)}`, true))
      .finally(() => { workingRef.current = false; setWorking(false); });
  }
  function exportSettings() {
    if (dirty) return;
    run(() => withDataTransferLock(async () => {
      const output = await createFullBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(output)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `tap-translate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(t('exported'));
    }));
  }
  function confirmImport() {
    if (!preview || dirty) return;
    const current = preview;
    let before: LocalRestoreSnapshot | null = null;
    run(async () => {
      // No await before onImport: permissions.request stays in this click stack.
      await onImport(current.value, { expectedFingerprint: current.fingerprint, onSnapshot: snapshot => { before = snapshot; } });
      setUndo(current.undo ? null : before);
      setPreview(null); setDataVersion(version => version + 1);
    }, true);
  }
  async function fromGist(remote: DownloadedBackup) {
    await prepare({ kind: 'backup', backup: remote.backup }, {
      source: `Gist · ${remote.source.label} · ${remote.id.slice(0, 8)}`, expired: remote.expiredCacheCount,
    });
  }

  return <>
    <div className="section-head"><h2 id="section-data-title">{t('sectionData')}</h2></div>
    <div className="data-block">
      <h3>{t('sectionImportExport')}</h3>
      <p className="hint">{t('backupScope')}</p><p className="hint">{t('backupSavedOnly')}</p>
      {dirty ? <p role="status">{t('backupUnsaved')}</p> : null}
      <div className="actions-inline">
        <Button id="exportBtn" label={t('exportSettings')} isDisabled={blocked || dirty} onClick={() => setConfirmation('export')} />
        <Button id="importBtn" label={t('importSettings')} isDisabled={blocked || dirty} onClick={() => fileInput.current?.click()} />
        <div id="importFile" hidden><input ref={fileInput} type="file" accept="application/json,.json" disabled={blocked || dirty}
          onChange={event => {
            const selected = event.currentTarget.files?.[0]; event.currentTarget.value = '';
            if (selected && selected.size > MAX_BACKUP_BYTES) { report(t('backupTooLarge'), true); return; }
            if (selected) run(async () => { await prepare(parseImportFile(await selected.text())); }, true);
          }} /></div>
      </div>
    </div>
    <GistPanel dirty={dirty} disabled={blocked || preview !== null} onBusy={setCloudBusy}
      onPreview={fromGist} dataVersion={dataVersion + settingsVersion} report={report} />
    {undo ? <div className="data-block" role="status">
      <p>{t('gistUndoHint')}</p>
      <Button id="undoRestoreBtn" label={t('gistUndo')} isDisabled={blocked || dirty}
        onClick={() => run(() => prepare({ kind: 'backup', backup: { ...undo.backup, settings: undo.settings } }, { undo: true }))} />
    </div> : null}
    <div className="data-block">
      <h3>{t('sectionCache')}</h3><p className="hint">{t('cacheHint')}</p>
      <Button id="clearCacheBtn" isDisabled={blocked} label={t('clearCache')} onClick={() => setConfirmation('cache')} />
    </div>
    <ul className="privacy-list">{['privacyTextDestination', 'privacySecretsLocal', 'privacyNoCloud'].map(key => <li key={key}>{t(key)}</li>)}</ul>
    <ImportPreview value={preview?.value ?? null} source={preview?.source} expiredCacheCount={preview?.expired} undo={preview?.undo}
      blocked={blocked} onCancel={() => setPreview(null)} onConfirm={confirmImport} />
    <Dialog id="dataConfirmDialog" title={t(confirmation === 'cache' ? 'clearCache' : 'exportSettings')}
      open={confirmation !== null} onClose={() => setConfirmation(null)}>
      <p>{t(confirmation === 'cache' ? 'confirmClearCache' : 'backupPrivateWarning')}</p>
      <div className="actions">
        <Button value="cancel" label={t('cancel')} onClick={() => setConfirmation(null)} />
        <Button value="confirm" variant="primary" label={t(confirmation === 'cache' ? 'clearCache' : 'exportSettings')}
          onClick={() => {
            if (confirmation === 'cache') run(() => withDataTransferLock(async () => { await clearCache(); report(t('cacheCleared')); setDataVersion(v => v + 1); }));
            else exportSettings();
            setConfirmation(null);
          }} />
      </div>
    </Dialog>
  </>;
}
