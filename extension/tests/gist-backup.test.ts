import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GIST_SESSION_KEY, GIST_STATE_KEY, GistSession } from '../lib/backup/gist';
import { mockBackupBrowser } from './helpers/backup-browser';
import { MockGitHub } from './helpers/mock-github';
import { GIST_DATA_PERMISSIONS, GIST_ORIGINS } from '../lib/backup/permissions';

beforeEach(() => { mockBackupBrowser(); });
afterEach(() => vi.unstubAllGlobals());
const password = 'test backup password';

it.each([413, 422])('clears a definitely rejected upload (%i) without retrying', async status => {
  const mock = new MockGitHub();
  const session = await GistSession.connect('token', password, mock.fetch);
  mock.nextStatus = status;
  await expect(session.upload('Laptop')).rejects.toThrow(status === 413 ? 'TOO_LARGE' : 'REMOTE');
  expect(await session.pending()).toEqual([]);
  expect(mock.gists.size).toBe(0);
  expect(mock.calls.filter(c => c.init?.method === 'POST')).toHaveLength(1);
});

it('requests Firefox data consent in the click stack and stops network calls after revocation', async () => {
  const mock = new MockGitHub();
  Object.assign(chrome.runtime, { getBrowserInfo: vi.fn() });
  Object.assign(chrome.permissions, { getAll: vi.fn(async () => ({ data_collection: GIST_DATA_PERMISSIONS })) });
  const connecting = GistSession.connect('token', password, mock.fetch);
  expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: GIST_ORIGINS, data_collection: GIST_DATA_PERMISSIONS });
  const session = await connecting;
  Object.assign(chrome.permissions, { getAll: vi.fn(async () => ({})) });
  await expect(session.list()).rejects.toThrow('PERMISSION');
  expect(mock.calls).toHaveLength(1);
});

it('connects without uploading and creates independent verified snapshots without persisting secrets to disk', async () => {
  const mock = new MockGitHub();
  const first = await GistSession.connect('first-test-token', password, mock.fetch);
  expect(mock.gists.size).toBe(0);
  const a = await first.upload('Laptop');
  const second = await GistSession.connect('second-test-token', password, mock.fetch);
  const b = await second.upload('Desktop');
  expect(a.id).not.toBe(b.id); expect(mock.gists.size).toBe(2);
  expect(mock.calls.filter(c => c.init?.method === 'PATCH')).toHaveLength(0);
  expect((await second.download(a.id, a.revision)).source.label).toBe('Laptop');
  const stored = JSON.stringify(await chrome.storage.local.get(GIST_STATE_KEY));
  for (const secret of [password, 'first-test-token', 'second-test-token']) expect(stored).not.toContain(secret);
  expect(await first.pending()).toEqual([]);
  await second.disconnect();
  expect(mock.gists.size).toBe(2);
  await expect(second.list()).rejects.toThrow('NO_CONNECTION');
});

it('resumes and decrypts a backup without prompting for permissions or uploading again', async () => {
  const mock = new MockGitHub();
  const session = await GistSession.connect('  test-token  ', password, mock.fetch);
  const backup = await session.upload('Laptop');
  const prompts = vi.mocked(chrome.permissions.request).mock.calls.length;
  const resumed = await GistSession.resume(mock.fetch);
  expect(resumed?.account).toEqual(mock.account);
  expect(resumed?.confirmsPassword(password)).toBe(true);
  const restored = await resumed!.download(backup.id);
  expect(restored.source.label).toBe('Laptop');
  for (const secret of ['test-token', password, GIST_SESSION_KEY]) expect(JSON.stringify(restored.backup)).not.toContain(secret);
  expect(chrome.permissions.request).toHaveBeenCalledTimes(prompts);
  expect(mock.calls.filter(call => call.init?.method === 'POST')).toHaveLength(1);
  expect((await chrome.storage.session.get(GIST_SESSION_KEY))[GIST_SESSION_KEY].token).toBe('test-token');
  for (const store of [chrome.storage.local, chrome.storage.sync]) {
    const saved = JSON.stringify(await store.get(null));
    expect(saved).not.toContain('test-token'); expect(saved).not.toContain(password);
  }
  await resumed!.disconnect();
  expect(await chrome.storage.session.get(GIST_SESSION_KEY)).toEqual({});
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  expect(mock.gists.size).toBe(1);
});

it('does not reconnect without session credentials or after the browser session ends', async () => {
  const mock = new MockGitHub();
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  expect(mock.calls).toHaveLength(0);
  await GistSession.connect('test-token', password, mock.fetch);
  await chrome.storage.session.remove(GIST_SESSION_KEY);
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  expect(mock.calls).toHaveLength(1);
});

it.each(['token', 'permission', 'account'] as const)('clears unusable session credentials after %s changes', async reason => {
  const mock = new MockGitHub();
  await GistSession.connect('test-token', password, mock.fetch);
  if (reason === 'token') mock.nextStatus = 401;
  if (reason === 'permission') Object.assign(chrome.permissions, { contains: vi.fn(async () => false) });
  if (reason === 'account') mock.account = { id: 8, login: 'other' };
  await expect(GistSession.resume(mock.fetch)).rejects.toThrow(
    reason === 'token' ? 'TOKEN' : reason === 'permission' ? 'PERMISSION' : 'OWNER');
  expect(await chrome.storage.session.get(GIST_SESSION_KEY)).toEqual({});
  if (reason === 'permission') expect(mock.calls).toHaveLength(1);
});

it('retains session credentials on a temporary network failure so refresh can retry', async () => {
  const mock = new MockGitHub();
  await GistSession.connect('test-token', password, mock.fetch);
  await expect(GistSession.resume(async () => { throw new TypeError('offline'); })).rejects.toThrow('NETWORK');
  expect((await GistSession.resume(mock.fetch))?.account).toEqual(mock.account);
});

it('ignores saved credentials in private windows and never falls back to disk', async () => {
  const mock = new MockGitHub();
  await GistSession.connect('test-token', password, mock.fetch);
  vi.mocked(chrome.storage.session.get).mockClear();
  Object.assign(chrome.extension, { inIncognitoContext: true });
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  expect(chrome.storage.session.get).not.toHaveBeenCalled();
  expect(mock.calls).toHaveLength(1);
  Object.assign(chrome.extension, { inIncognitoContext: false });
  Object.assign(chrome.storage, { session: undefined });
  const session = await GistSession.connect('another-token', password, mock.fetch);
  expect(await session.list()).toEqual({ items: [], nextPage: null });
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  const saved = JSON.stringify(await chrome.storage.local.get(null));
  expect(saved).not.toContain('another-token'); expect(saved).not.toContain(password);
});

it('discards malformed session credentials without sending a request', async () => {
  const mock = new MockGitHub();
  await chrome.storage.session.set({ [GIST_SESSION_KEY]: { token: 'test-token' } });
  expect(await GistSession.resume(mock.fetch)).toBeNull();
  expect(await chrome.storage.session.get(GIST_SESSION_KEY)).toEqual({});
  expect(mock.calls).toHaveLength(0);
});

it('reconciles a lost create response without a duplicate POST, including after reconnect', async () => {
  const mock = new MockGitHub();
  const session = await GistSession.connect('test-token', password, mock.fetch);
  mock.loseCreateResponse = true;
  await expect(session.upload('Laptop')).rejects.toThrow('PENDING');
  expect(mock.gists.size).toBe(1);
  await expect(session.upload('Laptop')).rejects.toThrow('PENDING');
  const reconnected = await GistSession.connect('renewed-token', password, mock.fetch);
  await reconnected.list();
  expect(await reconnected.reconcile()).toHaveLength(1);
  expect(await reconnected.pending()).toEqual([]);
  expect(mock.calls.filter(c => c.init?.method === 'POST')).toHaveLength(1);
});

it('keeps pending uploads bound to their account and never clears them when changing accounts', async () => {
  const mock = new MockGitHub();
  const session = await GistSession.connect('token-a', password, mock.fetch);
  mock.loseCreateResponse = true;
  await expect(session.upload('Laptop')).rejects.toThrow('PENDING');
  mock.account = { id: 8, login: 'second' };
  const other = await GistSession.connect('token-b', password, mock.fetch);
  expect(await other.pending()).toEqual([]);
  await other.list();
  expect(await other.reconcile()).toEqual([]);
  expect(await session.pending()).toHaveLength(1);
});

it('permission denial or a private window never sends credentials or creates data', async () => {
  const mock = new MockGitHub();
  Object.assign(chrome.permissions, { request: vi.fn(async () => false) });
  await expect(GistSession.connect('token', password, mock.fetch)).rejects.toThrow('PERMISSION');
  expect(mock.calls).toHaveLength(0);
  Object.assign(chrome.extension, { inIncognitoContext: true });
  await expect(GistSession.connect('token', password, mock.fetch)).rejects.toThrow('PRIVATE');
  expect(mock.calls).toHaveLength(0);
});

it('an incomplete search leaves an unknown upload pending instead of retrying it', async () => {
  const mock = new MockGitHub();
  const session = await GistSession.connect('token', password, mock.fetch);
  mock.loseCreateResponse = true;
  await expect(session.upload('Laptop')).rejects.toThrow('PENDING');
  for (let i = 0; i < 20; i++) mock.add({ unrelated: { content: 'x' } });
  const page = await session.list();
  expect(page.items).toEqual([]); expect(page.nextPage).toBe(2);
  expect(await session.reconcile()).toEqual([]);
  expect(await session.pending()).toHaveLength(1);
  await session.list(2);
  expect(await session.reconcile()).toHaveLength(1);
});
