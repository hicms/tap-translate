import { vi } from 'vitest';
import { mockChromeStorage } from './settings-storage';

export function mockBackupBrowser() {
  const stores = mockChromeStorage();
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, _options, run) => run({ name: _name, mode: 'exclusive' })) } });
  Object.assign(chrome, {
    extension: { inIncognitoContext: false },
    runtime: { getManifest: () => ({ version: '0.1.2' }) },
    permissions: { getAll: vi.fn(async () => ({ origins: [], permissions: ['storage'] })), request: vi.fn(async () => true), contains: vi.fn(async () => true) },
  });
  return stores;
}
