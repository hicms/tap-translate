import { z } from 'zod';
import { MANIFEST_FILE, MAX_ENCODED_BYTES, MAX_MANIFEST_BYTES, parseManifest, type GistFiles } from './crypto';
import { BackupError } from './errors';

const API = 'https://api.github.com';
const idSchema = z.string().regex(/^[a-f0-9]{1,64}$/i);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/i);
const accountSchema = z.object({ id: z.number().int().positive(), login: z.string().regex(/^[a-z\d-]{1,100}$/i) });
const fileSchema = z.object({
  size: z.number().int().nonnegative(), truncated: z.boolean().optional(),
  content: z.string().optional(), raw_url: z.string().optional(),
});
const gistSchema = z.object({
  id: idSchema, owner: accountSchema, public: z.boolean(), created_at: z.string().datetime(),
  description: z.string().nullable(), files: z.record(fileSchema), truncated: z.boolean().optional(),
  history: z.array(z.object({ version: revisionSchema })).optional(),
});
export type GistAccount = z.infer<typeof accountSchema>;
export type RemoteGist = z.infer<typeof gistSchema>;
export interface GistPage { items: RemoteGist[]; nextPage: number | null }

export function gistId(input: string): string {
  const value = input.trim();
  if (idSchema.safeParse(value).success) return value;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://gist.github.com' || url.username || url.password || url.search || url.hash) throw new Error();
    const path = url.pathname.split('/').filter(Boolean);
    if (path.length < 1 || path.length > 2) throw new Error();
    return idSchema.parse(path.at(-1));
  } catch { throw new BackupError('INVALID'); }
}
export function gistUrl(id: string): string { return `https://gist.github.com/${idSchema.parse(id)}`; }

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new BackupError('TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) throw new BackupError('TOO_LARGE');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new BackupError('INVALID'); }
}

export class GitHubRequestError extends BackupError {
  constructor(readonly status: number, error: BackupError) { super(error.code, error.retryAt); }
}

function responseError(response: Response): BackupError {
  if (response.status === 401) return new BackupError('TOKEN');
  if (response.status === 404) return new BackupError('NOT_FOUND');
  if (response.status === 413) return new BackupError('TOO_LARGE');
  if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
    || (response.status === 403 && response.headers.has('retry-after'))) {
    const retry = response.headers.get('retry-after');
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    const at = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : reset;
    return new BackupError('RATE_LIMITED', Number.isFinite(at) && at > 0 ? at : undefined);
  }
  return new BackupError(response.status === 403 ? 'FORBIDDEN' : 'REMOTE');
}

/** Only this transport may attach the GitHub credential. It never follows redirects. */
export class GitHubGists {
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch,
    private readonly authorize?: () => Promise<void>) {}

  private async request(path: string, body?: object, limit = 2 * 1024 * 1024): Promise<{ data: unknown; headers: Headers }> {
    await this.authorize?.();
    let response: Response;
    try {
      const fetcher = this.fetcher;
      response = await fetcher(`${API}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new BackupError('NETWORK'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GitHubRequestError(response.status, responseError(response));
    }
    try { return { data: JSON.parse(await boundedText(response, limit)), headers: response.headers }; }
    catch (error) { if (error instanceof BackupError) throw error; throw new BackupError('NETWORK'); }
  }

  async account(): Promise<GistAccount> {
    const { data, headers } = await this.request('/user');
    const scopes = headers.get('x-oauth-scopes');
    if (scopes !== null && !scopes.split(',').map(s => s.trim()).includes('gist')) throw new BackupError('FORBIDDEN');
    const parsed = accountSchema.safeParse(data);
    if (!parsed.success) throw new BackupError('INVALID');
    return parsed.data;
  }

  async list(page: number): Promise<GistPage> {
    if (!Number.isSafeInteger(page) || page < 1) throw new BackupError('INVALID');
    const { data, headers } = await this.request(`/gists?per_page=20&page=${page}`);
    const parsed = z.array(gistSchema).max(20).safeParse(data);
    if (!parsed.success) throw new BackupError('INVALID');
    // Never request a URL taken from Link. Advance only the fixed API endpoint.
    const next = /rel="next"/.test(headers.get('link') ?? '');
    return { items: parsed.data.filter(gist => Object.hasOwn(gist.files, MANIFEST_FILE)), nextPage: next ? page + 1 : null };
  }

  async get(id: string, account: GistAccount, revision?: string): Promise<RemoteGist> {
    const path = `/gists/${idSchema.parse(id)}${revision ? `/${revisionSchema.parse(revision)}` : ''}`;
    const { data } = await this.request(path, undefined, MAX_ENCODED_BYTES + 1024 * 1024);
    const parsed = gistSchema.safeParse(data);
    if (!parsed.success || parsed.data.id !== id || parsed.data.truncated) throw new BackupError('INVALID');
    if (parsed.data.owner.id !== account.id) throw new BackupError('OWNER');
    if (parsed.data.public) throw new BackupError('PUBLIC');
    return parsed.data;
  }

  async create(files: GistFiles, operationId: string): Promise<string> {
    const body = { public: false, description: `TapTranslate encrypted backup ${operationId}`, files };
    const { data } = await this.request('/gists', body, MAX_ENCODED_BYTES + 1024 * 1024);
    const result = z.object({ id: idSchema }).safeParse(data);
    if (!result.success) throw new BackupError('INVALID');
    return result.data.id;
  }

  async read(id: string, account: GistAccount, revision?: string): Promise<{ gist: RemoteGist; revision: string; files: GistFiles }> {
    const latest = revision ? null : await this.get(id, account);
    const chosen = revision ?? latest?.history?.[0]?.version;
    if (!chosen) throw new BackupError('INVALID');
    const gist = await this.get(id, account, chosen);
    const manifestText = await this.file(gist, chosen, MANIFEST_FILE, MAX_MANIFEST_BYTES);
    const manifest = parseManifest(manifestText);
    const actualNames = Object.keys(gist.files).filter(name => name.startsWith('tap-translate.part-')).sort();
    if (actualNames.length !== manifest.parts.length || actualNames.some((name, i) => name !== manifest.parts[i]!.name)) throw new BackupError('INVALID');
    const files: GistFiles = { [MANIFEST_FILE]: { content: manifestText } };
    for (const part of manifest.parts) files[part.name] = { content: await this.file(gist, chosen, part.name, part.bytes) };
    return { gist, revision: chosen, files };
  }

  private async file(gist: RemoteGist, revision: string, name: string, limit: number): Promise<string> {
    const file = gist.files[name];
    if (!file) throw new BackupError('INVALID');
    if (file.size > limit) throw new BackupError('TOO_LARGE');
    if (!file.truncated && typeof file.content === 'string') {
      if (new TextEncoder().encode(file.content).length !== file.size) throw new BackupError('INVALID');
      return file.content;
    }
    let raw: URL;
    try { raw = new URL(file.raw_url ?? ''); } catch { throw new BackupError('INVALID'); }
    const expected = `/${gist.owner.login}/${gist.id}/raw/${revision}/${name}`;
    if (raw.origin !== 'https://gist.githubusercontent.com' || raw.username || raw.password || raw.search || raw.hash
      || raw.pathname !== expected) throw new BackupError('INVALID');
    try {
      await this.authorize?.();
      const fetcher = this.fetcher;
      const response = await fetcher(raw.href, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw responseError(response);
      const text = await boundedText(response, limit);
      if (new TextEncoder().encode(text).length !== file.size) throw new BackupError('INVALID');
      return text;
    } catch (error) { if (error instanceof BackupError) throw error; throw new BackupError('NETWORK'); }
  }
}
