import { BackupError } from './errors';

export const GIST_ORIGINS = ['https://api.github.com/*', 'https://gist.githubusercontent.com/*'];
export const GIST_DATA_PERMISSIONS = ['authenticationInfo', 'browsingActivity', 'technicalAndInteraction'];

function firefoxConsent(): boolean { return 'getBrowserInfo' in chrome.runtime; }

/** Synchronous call site: retain the permission prompt's user activation. */
export function requestGistPermissions(): Promise<boolean> {
  return chrome.permissions.request({ origins: GIST_ORIGINS,
    ...(firefoxConsent() ? { data_collection: GIST_DATA_PERMISSIONS } : {}) });
}

export async function assertGistPermissions(): Promise<void> {
  if (!(await chrome.permissions.contains({ origins: GIST_ORIGINS }))) throw new BackupError('PERMISSION');
  if (firefoxConsent()) {
    const granted = await chrome.permissions.getAll() as chrome.permissions.Permissions & { data_collection?: string[] };
    if (!GIST_DATA_PERMISSIONS.every(value => granted.data_collection?.includes(value))) throw new BackupError('PERMISSION');
  }
}
