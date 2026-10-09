import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GIST_STATE_KEY, GistSession } from '../lib/backup/gist';
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

it('connects without uploading and creates independent verified snapshots without persisting secrets', async () => {
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
