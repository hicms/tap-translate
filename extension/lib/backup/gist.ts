import { z } from 'zod';
import { createFullBackup } from '../settings/backup';
import { canonical } from './compare';
import { checkPassword, MANIFEST_FILE, openBackup, sealBackup, type OpenedBackup } from './crypto';
import { BackupError } from './errors';
import { GitHubGists, GitHubRequestError, type GistAccount, type GistPage, type RemoteGist } from './github';
import { assertGistPermissions, requestGistPermissions } from './permissions';
import { withDataTransferLock } from './lock';

export const GIST_STATE_KEY = 'tapTranslateGist';
const pendingSchema = z.object({ accountId: z.number().int().positive(), operationId: z.string().uuid(),
  gistId: z.string().regex(/^[a-f\d]{1,64}$/i).optional(), createdAt: z.string().datetime() }).strict();
const stateSchema = z.object({
  deviceId: z.string().uuid(), label: z.string().min(1).max(100),
  account: z.object({ id: z.number().int().positive(), login: z.string() }).optional(),
  lastGist: z.object({ accountId: z.number().int().positive(), id: z.string().regex(/^[a-f\d]{1,64}$/i) }).optional(),
  pending: z.array(pendingSchema).max(100),
}).strict();
type GistState = z.infer<typeof stateSchema>;
export type PendingUpload = z.infer<typeof pendingSchema>;
export type GistProgress = 'collect' | 'encrypt' | 'upload' | 'verify' | 'download' | 'decrypt';
export interface DownloadedBackup extends OpenedBackup { id: string; revision: string; bytes: number }

async function readState(): Promise<GistState> {
  const raw = (await chrome.storage.local.get(GIST_STATE_KEY))[GIST_STATE_KEY];
  if (!raw) return { deviceId: crypto.randomUUID(), label: 'TapTranslate', pending: [] };
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError('INVALID');
  return parsed.data;
}
async function writeState(state: GistState): Promise<void> {
  await chrome.storage.local.set({ [GIST_STATE_KEY]: stateSchema.parse(state) });
}
function normalWindow(): void {
  if (chrome.extension.inIncognitoContext) throw new BackupError('PRIVATE');
}

/** One options-page session. Neither the token nor passphrase is persisted. */
export class GistSession {
  private candidates = new Map<string, RemoteGist>();
  private constructor(private api: GitHubGists | null, private password: string, readonly account: GistAccount) {}

  static async connect(token: string, password: string, fetcher: typeof fetch = fetch): Promise<GistSession> {
    normalWindow();
    checkPassword(password);
    if (!token.trim() || token.length > 2048) throw new BackupError('TOKEN');
    // This must be the first await in the click call chain.
    if (!(await requestGistPermissions())) throw new BackupError('PERMISSION');
    const api = new GitHubGists(token.trim(), fetcher, assertGistPermissions);
    const account = await api.account();
    await withDataTransferLock(async () => { await writeState({ ...await readState(), account }); });
    return new GistSession(api, password, account);
  }

  private client(): GitHubGists {
    normalWindow();
    if (!this.api) throw new BackupError('NO_CONNECTION');
    return this.api;
  }

  async list(page = 1): Promise<GistPage> {
    const result = await this.client().list(page);
    for (const item of result.items) if (item.owner.id === this.account.id && !item.public) this.candidates.set(item.id, item);
    return { ...result, items: result.items.filter(item => item.owner.id === this.account.id && !item.public) };
  }

  async pending(): Promise<PendingUpload[]> {
    return (await readState()).pending.filter(item => item.accountId === this.account.id);
  }

  async deviceLabel(): Promise<string> { return (await readState()).label; }

  confirmsPassword(value: string): boolean { return Boolean(this.api) && value === this.password; }

  async download(id: string, revision?: string, progress?: (stage: GistProgress) => void): Promise<DownloadedBackup> {
    progress?.('download');
    const result = await this.client().read(id, this.account, revision);
    progress?.('decrypt');
    const opened = await openBackup(result.files, this.password);
    return { ...opened, id, revision: result.revision,
      bytes: Object.values(result.files).reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0) };
  }

  async upload(label: string, allowNewWhilePending = false, progress?: (stage: GistProgress) => void): Promise<DownloadedBackup> {
    const api = this.client();
    return withDataTransferLock(async () => {
      let state = await readState();
      if (!allowNewWhilePending && state.pending.some(item => item.accountId === this.account.id)) throw new BackupError('PENDING');
      if (!label.trim() || label.length > 100) throw new BackupError('INVALID');
      progress?.('collect');
      const backup = await createFullBackup();
      progress?.('encrypt');
      const operationId = crypto.randomUUID();
      const files = await sealBackup(backup, { deviceId: state.deviceId, label }, this.password, operationId);
      state = { ...state, label, pending: [...state.pending, { accountId: this.account.id, operationId, createdAt: new Date().toISOString() }] };
      await writeState(state);
      try {
        progress?.('upload');
        const id = await api.create(files, operationId);
        state = { ...state, pending: state.pending.map(p => p.operationId === operationId ? { ...p, gistId: id } : p) };
        await writeState(state);
        progress?.('verify');
        const remote = await api.read(id, this.account);
        if (canonical(remote.files) !== canonical(files)) throw new BackupError('VERIFY');
        const opened = await openBackup(remote.files, this.password);
        await this.complete(operationId, id);
        return { ...opened, id, revision: remote.revision,
          bytes: Object.values(files).reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0) };
      } catch (error) {
        // Only an explicit rejection before a returned ID proves no Gist was created.
        if (!state.pending.find(p => p.operationId === operationId)?.gistId && error instanceof GitHubRequestError
          && error.status >= 400 && error.status < 500 && error.status !== 408) {
          await writeState({ ...state, pending: state.pending.filter(p => p.operationId !== operationId) });
          throw error;
        }
        throw new BackupError('PENDING');
      }
    });
  }

  private async complete(operationId: string, id: string): Promise<void> {
    const state = await readState();
    await writeState({ ...state, lastGist: { accountId: this.account.id, id }, pending: state.pending.filter(p =>
      !(p.accountId === this.account.id && p.operationId === operationId)) });
  }

  /** Uses only pages the user has checked. An absent match is never proof of failure. */
  async reconcile(progress?: (stage: GistProgress) => void): Promise<DownloadedBackup[]> {
    this.client();
    return withDataTransferLock(async () => {
      const recovered: DownloadedBackup[] = [];
      for (const pending of await this.pending()) {
        const id = pending.gistId ?? [...this.candidates.values()]
          .find(gist => gist.description === `TapTranslate encrypted backup ${pending.operationId}`)?.id;
        if (!id) continue;
        const result = await this.download(id, undefined, progress);
        if (result.operationId !== pending.operationId) throw new BackupError('VERIFY');
        await this.complete(pending.operationId, id);
        recovered.push(result);
      }
      return recovered;
    });
  }

  async disconnect(): Promise<void> {
    await withDataTransferLock(async () => {
      const state = await readState();
      delete state.account;
      delete state.lastGist;
      await writeState(state);
    });
    this.api = null;
    this.password = '';
    this.candidates.clear();
  }
}

export { MANIFEST_FILE };
