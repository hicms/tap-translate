import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFullBackup, MAX_BACKUP_BYTES, parseFullBackup } from '../lib/settings/backup';
import { checkPassword, MANIFEST_FILE, openBackup, parseManifest, sealBackup } from '../lib/backup/crypto';
import { mockBackupBrowser } from './helpers/backup-browser';
import { getSettings, saveSettings } from '../lib/settings/storage';
import { stateFingerprint } from '../lib/backup/compare';
import { encryptedFixture } from './helpers/encrypted-fixture';

const password = '密码 abc12'; // Exactly eight Unicode characters, including a space.
const source = { deviceId: '39f33a83-45ba-42e0-aa1a-26ab7c6f3f9c', label: '我的电脑' };
const operationId = '44b6bcad-0acb-4e2d-b32f-e231cb48fb95';
beforeEach(() => { mockBackupBrowser(); });
afterEach(() => vi.unstubAllGlobals());

describe('encrypted backup protocol', () => {
  it('round trips exactly 20 MiB and rejects an authenticated inner backup one byte larger', async () => {
    const backup = await createFullBackup();
    const provider = { ...backup.settings.providers[0]!, id: crypto.randomUUID(), apiKey: '' };
    backup.settings.providers.push(provider);
    const base = new TextEncoder().encode(JSON.stringify(backup)).length;
    provider.apiKey = 'x'.repeat(MAX_BACKUP_BYTES - base);
    expect(new TextEncoder().encode(JSON.stringify(parseFullBackup(backup))).length).toBe(MAX_BACKUP_BYTES);
    const files = await sealBackup(backup, source, password, operationId);
    expect((await openBackup(files, password)).backup).toEqual(backup);
    provider.apiKey += 'x';
    const oversized = await encryptedFixture({ backup, source, operationId }, password, operationId);
    expect(parseManifest(oversized[MANIFEST_FILE]!.content).parts.length).toBeLessThan(64);
    await expect(openBackup(oversized, password)).rejects.toThrow('TOO_LARGE');
    await expect(sealBackup(backup, source, password, operationId)).rejects.toThrow('20 MiB');
  }, 30_000);
  it('round trips credentials and Chinese text without leaking them into the manifest or ciphertext', async () => {
    const settings = await getSettings();
    await saveSettings({ providers: settings.providers.map(p => ({ ...p, apiKey: 'secret-example-key', customHeaders: { Authorization: 'private-header' } })) });
    const backup = await createFullBackup();
    const files = await sealBackup(backup, source, password, operationId);
    const text = JSON.stringify(files);
    for (const secret of [password, 'secret-example-key', 'private-header', source.label]) expect(text).not.toContain(secret);
    const opened = await openBackup(files, password);
    expect(opened.backup).toEqual(backup);
    expect(opened.source).toEqual(source);
    expect(opened.operationId).toBe(operationId);
    const next = await sealBackup(backup, source, password, operationId);
    expect(next).not.toEqual(files);
  });

  it('authenticates the password and header, and rejects altered or missing pieces', async () => {
    const files = await sealBackup(await createFullBackup(), source, password, operationId);
    await expect(openBackup(files, 'incorrect-password')).rejects.toThrow('PASSWORD');
    const meta = JSON.parse(files[MANIFEST_FILE]!.content);
    const tampered = { ...files, [MANIFEST_FILE]: { content: JSON.stringify({ ...meta, operationId: crypto.randomUUID() }) } };
    await expect(openBackup(tampered, password)).rejects.toThrow('PASSWORD');
    const part = meta.parts[0].name;
    await expect(openBackup({ ...files, [part]: { content: files[part]!.content.slice(1) } }, password)).rejects.toThrow('INVALID');
    const missing = { ...files }; delete missing[part];
    await expect(openBackup(missing, password)).rejects.toThrow('INVALID');
    await expect(openBackup({ ...files, 'tap-translate.part-0064': { content: 'AAAA' } }, password)).rejects.toThrow('INVALID');
  });

  it('rejects unbounded KDF, nonce, version, part order and manifest before deriving a key', async () => {
    const files = await sealBackup(await createFullBackup(), source, password, operationId);
    const meta = JSON.parse(files[MANIFEST_FILE]!.content);
    for (const patch of [{ iterations: 999999999 }, { version: 99 }, { salt: 'a'.repeat(24) }, { iv: '!' .repeat(16) },
      { parts: [{ ...meta.parts[0], name: 'tap-translate.part-0002' }] }, { cipherBytes: 2 ** 32 }]) {
      expect(() => parseManifest(JSON.stringify({ ...meta, ...patch }))).toThrow('INVALID');
    }
    expect(() => parseManifest(' '.repeat(64 * 1024 + 1))).toThrow('TOO_LARGE');
    expect(() => checkPassword('1234567')).toThrow('PASSWORD_LENGTH');
    expect(() => checkPassword('中'.repeat(400))).toThrow('PASSWORD_LENGTH');
  });

  it('splits large encrypted content and reads it back without renewing cache TTL', async () => {
    const key = `dr:c3:${'a'.repeat(64)}`;
    const at = Date.now();
    await chrome.storage.local.set({ [key]: { t: '译'.repeat(200_000), at, b: 600_000, epoch: 5 } });
    const backup = await createFullBackup();
    const files = await sealBackup(backup, source, password, operationId);
    expect(parseManifest(files[MANIFEST_FILE]!.content).parts.length).toBeGreaterThan(1);
    expect((await openBackup(files, password)).backup.cache[key]!.at).toBe(at);
  });

  it('ignores cache/time/revision in comparisons but detects provider secrets', async () => {
    const backup = await createFullBackup();
    const copy = structuredClone(backup);
    copy.settings.revision++;
    copy.createdAt = '2020-01-01T00:00:00.000Z';
    copy.cache = { x: { t: 'a', at: 1, b: 1 } };
    expect(await stateFingerprint(copy)).toBe(await stateFingerprint(backup));
    copy.settings.providers[0]!.apiKey = 'different';
    expect(await stateFingerprint(copy)).not.toBe(await stateFingerprint(backup));
  });
});
