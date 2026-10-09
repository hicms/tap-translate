import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitHubGists, gistId } from '../lib/backup/github';
import { createFullBackup } from '../lib/settings/backup';
import { MANIFEST_FILE, sealBackup } from '../lib/backup/crypto';
import { mockBackupBrowser } from './helpers/backup-browser';
import { MockGitHub } from './helpers/mock-github';

beforeEach(() => { mockBackupBrowser(); });
afterEach(() => vi.unstubAllGlobals());
const source = { deviceId: '39f33a83-45ba-42e0-aa1a-26ab7c6f3f9c', label: 'Test' };

it('accepts fine-grained auth without a scopes header; denies a classic token without gist', async () => {
  const mock = new MockGitHub(); const api = new GitHubGists('test-token', mock.fetch);
  mock.scopes = null;
  expect(await api.account()).toEqual(mock.account);
  mock.scopes = 'repo';
  await expect(api.account()).rejects.toThrow('FORBIDDEN');
  expect(mock.calls[0]!.init?.redirect).toBe('error');
});

it('pins downloads to a revision and never sends the token to raw hosts', async () => {
  const mock = new MockGitHub(); const api = new GitHubGists('test-token', mock.fetch);
  const files = await sealBackup(await createFullBackup(), source, 'long-passphrase', crypto.randomUUID());
  const id = mock.add(files);
  const gist = mock.gists.get(id)!;
  const remoteFiles = gist.files as Record<string, { truncated: boolean }>;
  remoteFiles[MANIFEST_FILE]!.truncated = true;
  const read = await api.read(id, mock.account);
  expect(read.files).toEqual(files);
  expect(mock.calls.map(c => c.url)).toContain(`https://api.github.com/gists/${id}/${read.revision}`);
  const raw = mock.calls.find(c => c.url.includes('gist.githubusercontent.com'))!;
  expect(raw.init?.headers).toBeUndefined();
  expect(raw.init?.redirect).toBe('error');
  Object.assign(remoteFiles[MANIFEST_FILE]!, { raw_url: 'https://evil.example/stolen' });
  await expect(api.read(id, mock.account)).rejects.toThrow('INVALID');
  expect(mock.calls.some(c => c.url.includes('evil.example'))).toBe(false);
});

it('refuses public, foreign and oversized response data', async () => {
  const mock = new MockGitHub(); const api = new GitHubGists('test-token', mock.fetch);
  const id = mock.add({ [MANIFEST_FILE]: { content: '{}' } });
  const gist = mock.gists.get(id)!;
  gist.public = true;
  await expect(api.get(id, mock.account)).rejects.toThrow('PUBLIC');
  gist.public = false; gist.owner = { id: 8, login: 'foreign' };
  await expect(api.get(id, mock.account)).rejects.toThrow('OWNER');
  const huge = new GitHubGists('token', async () => new Response('{}', { headers: { 'content-length': '999999999' } }));
  await expect(huge.account()).rejects.toThrow('TOO_LARGE');
});

it('paginates past unrelated gists rather than declaring an empty account', async () => {
  const mock = new MockGitHub(); const api = new GitHubGists('token', mock.fetch);
  mock.add({ [MANIFEST_FILE]: { content: '{}' } });
  for (let i = 0; i < 20; i++) mock.add({ unrelated: { content: 'x' } });
  const first = await api.list(1);
  expect(first.items).toEqual([]); expect(first.nextPage).toBe(2);
  expect((await api.list(2)).items).toHaveLength(1);
});

it('exposes safe errors and rate limit time, without echoing remote bodies', async () => {
  const api = new GitHubGists('secret-token', async () => Response.json({ message: 'secret-token' }, { status: 429, headers: { 'retry-after': '60' } }));
  const error = await api.account().catch(error => error);
  expect(error.code).toBe('RATE_LIMITED'); expect(error.retryAt).toBeGreaterThan(Date.now());
  expect(String(error)).not.toContain('secret-token');
  expect(gistId('https://gist.github.com/user/abcdef')).toBe('abcdef');
  for (const value of ['https://api.github.com/abcdef', 'https://gist.github.com.evil/x/a', 'https://gist.github.com/u/a?key=x']) {
    expect(() => gistId(value)).toThrow('INVALID');
  }
});
