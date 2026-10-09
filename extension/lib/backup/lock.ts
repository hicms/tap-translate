import { BackupError } from './errors';

/** The outer operation owns the lock. Snapshot/read/write primitives never re-enter it. */
export async function withDataTransferLock<T>(run: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw new BackupError('LOCK_UNAVAILABLE');
  return navigator.locks.request('tap-translate-data-transfer', { ifAvailable: true }, async lock => {
    if (!lock) throw new BackupError('BUSY');
    return run();
  });
}
