import { afterEach, expect, it, vi } from 'vitest';
import { withDataTransferLock } from '../lib/backup/lock';

afterEach(() => vi.unstubAllGlobals());

it('refuses an unavailable lock instead of queueing a second mutation', async () => {
  const action = vi.fn();
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, _options, run) => run(null)) } });
  await expect(withDataTransferLock(action)).rejects.toThrow('BUSY');
  expect(action).not.toHaveBeenCalled();
  expect(navigator.locks.request).toHaveBeenCalledWith('tap-translate-data-transfer', { ifAvailable: true }, expect.any(Function));
});

it('fails closed when the browser cannot coordinate settings pages', async () => {
  vi.stubGlobal('navigator', {});
  const action = vi.fn();
  await expect(withDataTransferLock(action)).rejects.toThrow('LOCK_UNAVAILABLE');
  expect(action).not.toHaveBeenCalled();
});
