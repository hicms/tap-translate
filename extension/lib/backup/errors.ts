export type BackupErrorCode =
  | 'BUSY' | 'LOCK_UNAVAILABLE' | 'CHANGED' | 'PERMISSION' | 'PRIVATE'
  | 'TOO_LARGE' | 'INVALID' | 'PASSWORD' | 'PASSWORD_LENGTH'
  | 'TOKEN' | 'FORBIDDEN' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK'
  | 'REMOTE' | 'OWNER' | 'PUBLIC' | 'PENDING' | 'VERIFY' | 'NO_CONNECTION';

/** Public errors carry no response body, credentials or translated content. */
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, readonly retryAt?: number) {
    super(code);
    this.name = 'BackupError';
  }
}
