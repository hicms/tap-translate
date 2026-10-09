import { z } from 'zod';
import { exportCacheSnapshot, parseCacheSnapshot, replaceCacheSnapshot } from '../cache';
import { siteProfiles } from '../sites';
import { siteProfilesSchema } from '../sites/snapshot';
import { createDefaultSettings, SETTINGS_SCHEMA_VERSION, validateSettings } from './schema';
import { getSettings, saveSettings } from './storage';
import { prepareSettingsImport } from './transfer';
import { onboardingSchema, readOnboardingSnapshot, replaceOnboardingSnapshot } from './onboarding';
import type { Settings } from '../types';
import { stateFingerprint } from '../backup/compare';
import { BackupError } from '../backup/errors';
import { withDataTransferLock } from '../backup/lock';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const FORMAT = 'tap-translate-backup';

// Only host patterns supported by this extension's manifest can be requested.
const originSchema = z.string().refine(value => {
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])\/\*$/.test(value)) return true;
  if (value === 'https://*/*') return true;
  if (!/^https:\/\/((\*\.)?[^/*?#@:[\]]+|\[[a-f\d:]+\])\/\*$/i.test(value)) return false;
  try { return Boolean(new URL(value.replace('://*.', '://')).hostname); } catch { return false; }
}, 'Unsupported host permission');

const envelopeSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  extensionVersion: z.string().min(1),
  settings: z.record(z.unknown()),
  cache: z.unknown(),
  onboarding: onboardingSchema,
  permissions: z.object({
    origins: z.array(originSchema).max(2000),
    permissions: z.array(z.string().min(1).max(100)).max(100),
  }).strict(),
}).strict();

export interface FullBackup extends Omit<z.infer<typeof envelopeSchema>, 'settings' | 'cache'> {
  settings: Settings;
  cache: ReturnType<typeof parseCacheSnapshot>;
}

function assertSnapshot(value: unknown, normalized: unknown, path = 'settings'): void {
  if (normalized !== null && typeof normalized === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(normalized)) {
      throw new Error(`Invalid backup: ${path}`);
    }
    const source = value as Record<string, unknown>;
    if (Object.keys(source).length !== Object.keys(normalized).length) throw new Error(`Incomplete backup: ${path}`);
    for (const [key, child] of Object.entries(normalized)) assertSnapshot(source[key], child, `${path}.${key}`);
  } else if (value !== normalized) {
    throw new Error(`Invalid backup: ${path}`);
  }
}

/** Full snapshots must never silently turn missing settings or credentials into defaults. */
export function parseFullBackup(raw: unknown): FullBackup {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 20 MiB');
  const envelope = envelopeSchema.parse(raw);
  for (const field of Object.keys(createDefaultSettings())) {
    if (!Object.hasOwn(envelope.settings, field)) throw new Error(`Incomplete backup: settings.${field}`);
  }
  if (envelope.settings.schemaVersion !== SETTINGS_SCHEMA_VERSION) throw new Error('Unsupported settings version');
  const patch = prepareSettingsImport(envelope.settings);
  const settings = validateSettings({ ...envelope.settings, ...patch });
  if (!settings.providers.some(provider => provider.id === envelope.settings.activeProviderId)) {
    throw new Error('Unknown active provider');
  }
  for (const provider of z.array(z.record(z.unknown())).parse(envelope.settings.providers)) {
    if (typeof provider.apiKey !== 'string' || !provider.customHeaders || typeof provider.persistApiKey !== 'boolean') {
      throw new Error('Incomplete backup: provider credentials');
    }
  }
  settings.builtinSiteProfiles = siteProfilesSchema.parse(envelope.settings.builtinSiteProfiles);
  assertSnapshot(envelope.settings, settings);
  return { ...envelope, settings, cache: parseCacheSnapshot(envelope.cache) };
}

export type PreparedImport = { kind: 'settings'; settings: Partial<Settings> } | { kind: 'backup'; backup: FullBackup };

export function parseImportFile(text: string): PreparedImport {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 20 MiB');
  const raw: unknown = JSON.parse(text);
  if (raw && typeof raw === 'object' && ('format' in raw || 'version' in raw || 'settings' in raw)) {
    return { kind: 'backup', backup: parseFullBackup(raw) };
  }
  const settings = prepareSettingsImport(raw);
  if (!Object.keys(settings).length) throw new Error('No recognized settings in this file');
  return { kind: 'settings', settings };
}

export async function createFullBackup(): Promise<FullBackup> {
  const before = await readBackupState();
  const [state, cache] = await Promise.all([readBackupState(), exportCacheSnapshot()]);
  const backup = parseFullBackup({
    format: FORMAT, version: 1, createdAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    ...state, cache,
  });
  const signatures = await Promise.all([before, backup, await readBackupState()].map(value => stateFingerprint(value)));
  if (signatures.some(value => value !== signatures[0])) throw new BackupError('CHANGED');
  return backup;
}

async function readBackupState(): Promise<Pick<FullBackup, 'settings' | 'onboarding' | 'permissions'>> {
  const [settings, onboarding, permissions] = await Promise.all([
    getSettings({ strict: true }), readOnboardingSnapshot(), chrome.permissions.getAll(),
  ]);
  return {
    settings: { ...settings, builtinSiteProfiles: settings.builtinSiteProfiles ?? [...siteProfiles] }, onboarding,
    permissions: { origins: permissions.origins ?? [], permissions: permissions.permissions ?? [] },
  };
}

export async function restoreFingerprint(): Promise<string> {
  return stateFingerprint(await readBackupState(), false);
}

/** Local undo retains the installed-rules mode; portable backups always materialize it. */
export interface LocalRestoreSnapshot { backup: FullBackup; settings: Settings }

export interface RestoreOptions {
  expectedFingerprint?: string;
  onSnapshot?: (before: LocalRestoreSnapshot) => void;
}

export class BackupRestoreError extends Error {
  constructor(readonly failure: unknown, readonly rollbackFailures: unknown[]) {
    super(rollbackFailures.length
      ? `Restore failed; rollback incomplete: ${String(failure)}; ${rollbackFailures.map(String).join('; ')}`
      : `Restore failed; previous data restored: ${String(failure)}`);
    this.name = 'BackupRestoreError';
  }
}

/** Call directly from the confirmation click: permissions.request needs a user gesture. */
export async function restoreFullBackup(backup: FullBackup, options: RestoreOptions = {}): Promise<Settings> {
  const origins = backup.permissions.origins;
  if (origins.length && !(await chrome.permissions.request({ origins }))) throw new Error('Backup permissions were not granted; no data changed');
  return withDataTransferLock(async () => {
    if (options.expectedFingerprint && options.expectedFingerprint !== await restoreFingerprint()) throw new BackupError('CHANGED');
    const previousSettings = await getSettings({ strict: true });
    const before = await createFullBackup();
    const previousState = { ...before, settings: { ...previousSettings, builtinSiteProfiles: previousSettings.builtinSiteProfiles ?? [...siteProfiles] } };
    if (await stateFingerprint(previousState, false) !== await stateFingerprint(before, false)) throw new BackupError('CHANGED');
    if (options.expectedFingerprint && options.expectedFingerprint !== await stateFingerprint(before, false)) throw new BackupError('CHANGED');
    options.onSnapshot?.({ backup: before, settings: previousSettings });
    return applyFullBackup(backup, before, previousSettings);
  });
}

async function applyFullBackup(backup: FullBackup, before: FullBackup, previousSettings: Settings): Promise<Settings> {
  const { cache: previousCache, onboarding: previousOnboarding } = before;
  try {
    const saved = await saveSettings(backup.settings);
    await replaceOnboardingSnapshot(backup.onboarding);
    await replaceCacheSnapshot(parseCacheSnapshot(backup.cache));
    return saved;
  } catch (failure) {
    const rollbackFailures: unknown[] = [];
    for (const restore of [
      () => saveSettings(previousSettings),
      () => replaceOnboardingSnapshot(previousOnboarding),
      () => replaceCacheSnapshot(previousCache),
    ]) {
      try { await restore(); } catch (error) { rollbackFailures.push(error); }
    }
    throw new BackupRestoreError(failure, rollbackFailures);
  }
}
