import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Input } from '../../ui/fields';
import { Dialog } from '../../ui/dialog';
import { useLocale } from '../../ui/locale';
import { createFullBackup, type FullBackup } from '../../lib/settings/backup';
import { changedGroups } from '../../lib/backup/compare';
import { BackupError } from '../../lib/backup/errors';
import { gistId, gistUrl, type GistAccount, type RemoteGist } from '../../lib/backup/github';
import { GistSession, type DownloadedBackup, type GistProgress, type PendingUpload } from '../../lib/backup/gist';
import { backupErrorText } from './backup-ui';
import { backupLabels } from './import-preview';
import './gist.css';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=TapTranslate%20backup';

export function GistPanel({ dirty, disabled, onBusy, onPreview, dataVersion, report }: {
  dirty: boolean; disabled: boolean; onBusy: (busy: boolean) => void;
  onPreview: (backup: DownloadedBackup) => Promise<void>; dataVersion: number;
  report: (text: string, error?: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const session = useRef<GistSession | null>(null);
  const running = useRef(false);
  const [account, setAccount] = useState<GistAccount | null>(null);
  const [form, setForm] = useState(false);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordConfirmed, setPasswordConfirmed] = useState(false);
  const [label, setLabel] = useState('TapTranslate');
  const [link, setLink] = useState('');
  const [items, setItems] = useState<RemoteGist[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<DownloadedBackup | null>(null);
  const [local, setLocal] = useState<FullBackup | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [stage, setStage] = useState<GistProgress | 'check' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'upload' | 'disconnect' | null>(null);
  const [summaries, setSummaries] = useState<Record<string, { label: string; version: string; bytes: number }>>({});
  const blocked = disabled || stage !== null;
  const privateWindow = chrome.extension.inIncognitoContext;

  useEffect(() => {
    if (privateWindow) return;
    let alive = true;
    running.current = true; setStage('check'); onBusy(true);
    void (async () => {
      const connection = await GistSession.resume();
      if (!alive || !connection) return;
      session.current = connection; setAccount(connection.account);
      const [deviceLabel, result, backup, uploads] = await Promise.all([
        connection.deviceLabel(), connection.list(), createFullBackup(), connection.pending(),
      ]);
      if (!alive) return;
      setLabel(deviceLabel); setItems(result.items); setNextPage(result.nextPage); setLocal(backup); setPending(uploads);
      if (result.items[0]) {
        const value = await connection.download(result.items[0].id, undefined, stage => { if (alive) setStage(stage); });
        if (alive) select(value);
      }
    })().catch(error => { if (alive) setError(error); }).finally(() => {
      if (alive) { running.current = false; setStage(null); onBusy(false); }
    });
    return () => { alive = false; running.current = false; onBusy(false); };
  }, [onBusy, privateWindow]);

  useEffect(() => {
    if (!session.current) return;
    let alive = true;
    void createFullBackup().then(value => { if (alive) setLocal(value); }).catch(error => { if (alive) setError(error); });
    return () => { alive = false; };
  }, [dataVersion]);

  function run(action: () => Promise<void>) {
    if (running.current || disabled) return;
    running.current = true; onBusy(true); setStage('check'); setError(null);
    void action().catch(error => {
      setError(error);
      if (error instanceof BackupError && error.code === 'NOT_FOUND') setSelected(null);
    }).finally(async () => {
      try { if (session.current) setPending(await session.current.pending()); }
      catch (error) { setError(error); }
      running.current = false; setStage(null); onBusy(false);
    });
  }
  function select(value: DownloadedBackup) {
    setSelected(value);
    setSummaries(current => ({ ...current, [value.id]: { label: value.source.label, version: value.backup.extensionVersion, bytes: value.bytes } }));
  }
  async function load(id: string, preview = false) {
    const value = await session.current!.download(id, undefined, setStage);
    select(value); setLocal(await createFullBackup());
    if (preview) { setHistory(false); await onPreview(value); }
  }
  async function check(page = 1, choose = false) {
    const result = await session.current!.list(page);
    setItems(current => page === 1 ? result.items : [...current, ...result.items.filter(item => !current.some(old => old.id === item.id))]);
    setNextPage(result.nextPage); setLocal(await createFullBackup());
    if (choose && result.items[0]) await load(result.items[0].id);
  }
  function connect() {
    run(async () => {
      const connection = await GistSession.connect(token, password);
      session.current = connection;
      setAccount(connection.account); setToken(''); setPassword(''); setForm(false);
      setPasswordConfirmed(false); setSelected(null); setSummaries({});
      setLabel(await connection.deviceLabel());
      await check(1, !link.trim());
      if (link.trim()) await load(gistId(link));
    });
  }
  const changes = local && selected ? changedGroups(local, selected.backup) : [];
  const statusKey = !account ? 'gistDisconnected' : selected ? (changes.length ? 'gistDifferent' : 'gistSame')
    : items.length || nextPage ? 'gistChooseBackup' : 'gistNoBackup';
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const size = (bytes: number) => `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB`;

  return <div className="data-block gist-panel" id="gistPanel" aria-busy={stage !== null}>
    <div className="gist-heading"><h3>Gist</h3>{account ? <span className="hint">{account.login}</span> : null}</div>
    <p className="hint">{t('gistLead')}</p>
    <p className="hint gist-experimental">{t('gistExperimental')}</p>
    {privateWindow ? <p role="status">{t('gistErrorPRIVATE')}</p> : null}
    <div role="status" aria-live="polite" id="gistStatus"><strong>{stage ? t(`gistStage${stage}`) : t(statusKey)}</strong></div>
    {error ? <p className="gist-error" role="alert" id="gistError">{backupErrorText(error, t)}</p> : null}
    {form ? <div className="gist-form">
      <Input id="gistToken" type="password" label={t('gistToken')} value={token} onChange={setToken} autoComplete="off" disabled={blocked} />
      <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener">{t('gistCreateToken')}</a>
      <Input id="gistPassword" type="password" label={t('gistPassword')} hint={t('gistPasswordHint')}
        value={password} onChange={setPassword} autoComplete="off" disabled={blocked} />
      <details><summary>{t('gistExistingLink')}</summary><Input id="gistLink" label={t('gistExistingLink')}
        value={link} onChange={setLink} disabled={blocked} /></details>
      <p className="hint">{t('gistConsent')}</p><p className="hint">{t(chrome.storage.session ? 'gistBrowserSession' : 'gistSessionOnly')}</p>
      <div className="actions-inline">
        <Button id="gistConnectConfirm" variant="primary" label={t('gistConnect')} isDisabled={blocked || !token || !password || privateWindow} onClick={connect} />
        <Button label={t('cancel')} isDisabled={blocked} onClick={() => { setForm(false); setToken(''); setPassword(''); }} />
      </div>
    </div> : !account ? <Button id="gistConnectBtn" label={t('gistConnect')} isDisabled={blocked || privateWindow} onClick={() => setForm(true)} /> : <>
      {selected ? <>
        <p className="hint" id="gistSelected">{date(selected.backup.createdAt)} · {selected.source.label} · v{selected.backup.extensionVersion} · {size(selected.bytes)}</p>
        {local ? <div className="gist-comparison">
          <div><h4>{t('gistLocal')}</h4><p>{t('gistCounts', [local.settings.providers.length,
            local.settings.siteRules.length + local.settings.siteContentRules.length, Object.keys(local.cache).length])}</p></div>
          <div><h4>{t('gistSelectedBackup')}</h4><p>{t('gistCounts', [selected.backup.settings.providers.length,
            selected.backup.settings.siteRules.length + selected.backup.settings.siteContentRules.length, Object.keys(selected.backup.cache).length])}</p></div>
        </div> : null}
        {changes.length ? <details id="gistDifferences"><summary>{t('gistDifferences')}</summary>
          <p className="hint">{t('gistSecretDifference')}</p><ul>{changes.map(key => <li key={key}>{t(backupLabels[key] ?? key)}</li>)}</ul>
        </details> : null}
      </> : null}
      {selected && items[0] && items[0].id !== selected.id ? <p className="hint">{t('gistOtherVersion')}</p> : null}
      {pending.length ? <div className="gist-pending" role="status">
        <p>{t('gistPendingHint')}</p>
        <ul>{pending.map(item => <li key={item.operationId}>{date(item.createdAt)} · {item.operationId.slice(0, 8)}{' '}
          {item.gistId ? <a href={gistUrl(item.gistId)} target="_blank" rel="noreferrer noopener">{t('gistOpen')}</a> : null}</li>)}</ul>
        <Button id="gistReconcileBtn" label={t('gistReconcile')} isDisabled={blocked}
          onClick={() => run(async () => {
            await check();
            const recovered = await session.current!.reconcile(setStage);
            if (recovered.at(-1)) { select(recovered.at(-1)!); report(t('gistUploaded')); }
            else setError(new BackupError('PENDING'));
          })} />
      </div> : null}
      <div className="actions-inline">
        <Button id="gistBackupBtn" variant="primary" label={t('gistBackup')} isDisabled={blocked || dirty || privateWindow}
          onClick={() => { setRepeatPassword(''); setDialog('upload'); }} />
        <Button id="gistRestoreBtn" label={t('gistRestore')} isDisabled={blocked || dirty || !selected || privateWindow}
          onClick={() => run(async () => { if (selected) await onPreview(selected); })} />
        <Button id="gistHistoryBtn" variant="ghost" label={t('gistHistory')} isDisabled={blocked} onClick={() => setHistory(!history)} />
      </div>
      {history ? <div id="gistHistory" className="gist-history">
        {!items.length ? <p>{t(nextPage ? 'gistMoreResults' : 'gistNoBackup')}</p> : null}
        <ul>{items.map(item => <li key={item.id}>
          <div><strong>{date(item.created_at)}</strong><p className="hint">{summaries[item.id]
            ? `${summaries[item.id]!.label} · v${summaries[item.id]!.version} · ${size(summaries[item.id]!.bytes)}` : t('gistEncryptedDetails')}</p></div>
          <div className="actions-inline">
            <Button label={t('gistPreviewRestore')} isDisabled={blocked || dirty} onClick={() => run(() => load(item.id, true))} />
            <a href={gistUrl(item.id)} target="_blank" rel="noreferrer noopener">{t('gistOpen')}</a>
          </div>
        </li>)}</ul>
      </div> : null}
      {nextPage ? <Button id="gistMoreBtn" label={t('gistMoreResults')} isDisabled={blocked}
        onClick={() => run(async () => { await check(nextPage); setHistory(true); })} /> : null}
      <div className="gist-footer">
        <Button id="gistCheckBtn" variant="ghost" label={t('gistCheck')} isDisabled={blocked} onClick={() => run(async () => {
          await check(1, !selected);
          if (selected) await load(selected.id);
        })} />
        {selected ? <a href={gistUrl(selected.id)} target="_blank" rel="noreferrer noopener">{t('gistOpen')}</a> : null}
        <Button variant="ghost" label={t('gistReconnect')} isDisabled={blocked} onClick={() => { setForm(true); setLink(''); }} />
        <Button id="gistDisconnectBtn" variant="ghost" label={t('gistDisconnect')} isDisabled={blocked} onClick={() => setDialog('disconnect')} />
      </div>
    </>}
    <Dialog id="gistConfirmDialog" title={t(dialog === 'disconnect' ? 'gistDisconnect' : 'gistBackup')}
      open={dialog !== null} onClose={() => { if (!stage) { setDialog(null); setRepeatPassword(''); } }}>
      <p>{t(dialog === 'disconnect' ? 'gistDisconnectHint' : 'gistConsent')}</p>
      {dialog === 'upload' ? <>
        <Input id="gistDeviceLabel" label={t('gistDeviceLabel')} value={label} onChange={setLabel} maxLength={100} disabled={blocked} />
        {!passwordConfirmed ? <Input id="gistPasswordConfirm" type="password" label={t('gistPasswordConfirm')}
          value={repeatPassword} onChange={setRepeatPassword} autoComplete="off" disabled={blocked} /> : null}
        {pending.length ? <p>{t('gistNewDespitePending')}</p> : null}
      </> : null}
      <div className="actions">
        <Button value="cancel" label={t('cancel')} isDisabled={stage !== null} onClick={() => { setDialog(null); setRepeatPassword(''); }} />
        <Button value="confirm" variant="primary" label={t(dialog === 'disconnect' ? 'gistDisconnect' : 'gistBackup')}
          isDisabled={blocked || (dialog === 'upload' && !passwordConfirmed && !repeatPassword)} onClick={() => {
            if (dialog === 'disconnect') run(async () => {
              await session.current!.disconnect(); session.current = null; setAccount(null); setSelected(null);
              setItems([]); setPending([]); setSummaries({}); setDialog(null);
            });
            else {
              if (dirty) return;
              if (!passwordConfirmed && !session.current!.confirmsPassword(repeatPassword)) { setError(new BackupError('PASSWORD')); setRepeatPassword(''); setDialog(null); return; }
              setPasswordConfirmed(true); setRepeatPassword(''); setDialog(null);
              run(async () => {
                select(await session.current!.upload(label, pending.length > 0, setStage));
                report(t('gistUploaded')); await check();
              });
            }
          }} />
      </div>
    </Dialog>
  </div>;
}
