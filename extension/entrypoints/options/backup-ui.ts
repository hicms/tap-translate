import { BackupError } from '../../lib/backup/errors';
import { BackupRestoreError } from '../../lib/settings/backup';
import type { Translate } from '../../ui/locale';

export function backupErrorText(error: unknown, t: Translate): string {
  if (error instanceof BackupRestoreError) return t(error.rollbackFailures.length ? 'gistRollbackFailed' : 'gistRollbackDone');
  if (error instanceof BackupError) return `${t(`gistError${error.code}`)}${error.retryAt ? ` ${new Date(error.retryAt).toLocaleString()}` : ''}`;
  if (error instanceof Error && error.message.includes('20 MiB')) return t('backupTooLarge');
  if (error instanceof Error && error.message.includes('permissions were not granted')) return t('gistErrorPERMISSION');
  return t('gistErrorUNKNOWN');
}
