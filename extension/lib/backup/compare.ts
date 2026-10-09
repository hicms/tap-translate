import type { FullBackup } from '../settings/backup';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

type BackupState = Pick<FullBackup, 'settings' | 'onboarding' | 'permissions'>;
export async function stateFingerprint(state: BackupState, includePermissions = true): Promise<string> {
  const { revision: _revision, ...settings } = state.settings;
  return sha256(new TextEncoder().encode(canonical({
    settings, onboarding: state.onboarding,
    ...(includePermissions ? { permissions: {
      origins: [...state.permissions.origins].sort(), permissions: [...state.permissions.permissions].sort(),
    } } : {}),
  })));
}

/** Keys only: secrets influence comparison but are never returned for rendering. */
export function changedGroups(local: FullBackup, remote: FullBackup): string[] {
  const fields = (Object.keys(local.settings) as (keyof FullBackup['settings'])[]).filter(key => key !== 'revision' && key !== 'schemaVersion');
  const changed: string[] = fields.filter(key => canonical(local.settings[key]) !== canonical(remote.settings[key]));
  if (canonical(local.onboarding) !== canonical(remote.onboarding)) changed.push('onboarding');
  if (canonical([...local.permissions.origins].sort()) !== canonical([...remote.permissions.origins].sort())
    || canonical([...local.permissions.permissions].sort()) !== canonical([...remote.permissions.permissions].sort())) changed.push('permissions');
  return changed;
}
