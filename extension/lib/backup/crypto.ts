import { z } from 'zod';
import { MAX_BACKUP_BYTES, parseFullBackup, type FullBackup } from '../settings/backup';
import { canonical, sha256 } from './compare';
import { BackupError } from './errors';

export const MANIFEST_FILE = 'tap-translate.manifest.json';
export const PART_PREFIX = 'tap-translate.part-';
export const PART_BYTES = 512 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_CIPHER_BYTES = MAX_BACKUP_BYTES + 4096 + 16;
export const MAX_ENCODED_BYTES = 4 * Math.ceil(MAX_CIPHER_BYTES / 3);
const encoder = new TextEncoder();
const sourceSchema = z.object({ deviceId: z.string().uuid(), label: z.string().min(1).max(100) }).strict();
export type BackupSource = z.infer<typeof sourceSchema>;

const headerSchema = z.object({
  format: z.literal('tap-translate-encrypted-backup'), version: z.literal(1),
  operationId: z.string().uuid(), cipher: z.literal('AES-256-GCM'),
  kdf: z.literal('PBKDF2-SHA256'), iterations: z.literal(600_000),
  salt: z.string().length(24), iv: z.string().length(16),
});
const manifestSchema = headerSchema.extend({
  cipherBytes: z.number().int().min(16).max(MAX_CIPHER_BYTES),
  parts: z.array(z.object({
    name: z.string().regex(/^tap-translate\.part-\d{4}$/),
    bytes: z.number().int().min(1).max(PART_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(64),
}).strict();
export type BackupManifest = z.infer<typeof manifestSchema>;
export type GistFiles = Record<string, { content: string }>;
export interface OpenedBackup {
  backup: FullBackup;
  source: BackupSource;
  operationId: string;
  expiredCacheCount: number;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function unbase64(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new BackupError('INVALID');
  const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  if (base64(bytes) !== text) throw new BackupError('INVALID');
  return bytes;
}

export function checkPassword(password: string): void {
  if ([...password].length < 8 || encoder.encode(password).length > 1024) throw new BackupError('PASSWORD_LENGTH');
}
async function keyFor(password: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: unbase64(salt) },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function header(manifest: BackupManifest | z.infer<typeof headerSchema>) {
  const { format, version, operationId, cipher, kdf, iterations, salt, iv } = manifest;
  return { format, version, operationId, cipher, kdf, iterations, salt, iv };
}
function partName(index: number): string { return `${PART_PREFIX}${String(index + 1).padStart(4, '0')}`; }

export function parseManifest(text: string): BackupManifest {
  if (encoder.encode(text).length > MAX_MANIFEST_BYTES) throw new BackupError('TOO_LARGE');
  try {
    const manifest = manifestSchema.parse(JSON.parse(text));
    if (unbase64(manifest.salt).length !== 16 || unbase64(manifest.iv).length !== 12) throw new BackupError('INVALID');
    const total = manifest.parts.reduce((sum, part) => sum + part.bytes, 0);
    if (total !== 4 * Math.ceil(manifest.cipherBytes / 3) || total > MAX_ENCODED_BYTES
      || manifest.parts.some((part, i) => part.name !== partName(i)
        || (i < manifest.parts.length - 1 && part.bytes !== PART_BYTES))) throw new BackupError('INVALID');
    return manifest;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('INVALID');
  }
}

export async function sealBackup(backup: FullBackup, source: BackupSource, password: string, operationId: string): Promise<GistFiles> {
  checkPassword(password);
  const clean = parseFullBackup(backup);
  const payload = encoder.encode(JSON.stringify({ backup: clean, source: sourceSchema.parse(source), operationId }));
  if (payload.length > MAX_CIPHER_BYTES - 16) throw new BackupError('TOO_LARGE');
  const meta = headerSchema.parse({
    format: 'tap-translate-encrypted-backup', version: 1, operationId,
    cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600_000,
    salt: base64(crypto.getRandomValues(new Uint8Array(16))), iv: base64(crypto.getRandomValues(new Uint8Array(12))),
  });
  const cipher = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: unbase64(meta.iv), additionalData: encoder.encode(canonical(header(meta))), tagLength: 128,
  }, await keyFor(password, meta.salt), payload);
  const encoded = base64(new Uint8Array(cipher));
  const files: GistFiles = {};
  const parts: BackupManifest['parts'] = [];
  for (let i = 0; i < encoded.length; i += PART_BYTES) {
    const content = encoded.slice(i, i + PART_BYTES);
    const name = partName(parts.length);
    files[name] = { content };
    parts.push({ name, bytes: content.length, sha256: await sha256(encoder.encode(content)) });
  }
  files[MANIFEST_FILE] = { content: JSON.stringify({ ...meta, cipherBytes: cipher.byteLength, parts }) };
  return files;
}

export async function openBackup(files: GistFiles, password: string): Promise<OpenedBackup> {
  checkPassword(password);
  const manifest = parseManifest(files[MANIFEST_FILE]?.content ?? '');
  if (Object.keys(files).filter(name => name.startsWith(PART_PREFIX)).length !== manifest.parts.length) throw new BackupError('INVALID');
  const chunks: string[] = [];
  for (const part of manifest.parts) {
    const text = files[part.name]?.content;
    if (typeof text !== 'string' || encoder.encode(text).length !== part.bytes
      || await sha256(encoder.encode(text)) !== part.sha256) throw new BackupError('INVALID');
    chunks.push(text);
  }
  const cipher = unbase64(chunks.join(''));
  if (cipher.length !== manifest.cipherBytes) throw new BackupError('INVALID');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: unbase64(manifest.iv), tagLength: 128,
      additionalData: encoder.encode(canonical(header(manifest))),
    }, await keyFor(password, manifest.salt), cipher);
  } catch { throw new BackupError('PASSWORD'); }
  try {
    const raw = z.object({ backup: z.unknown(), source: sourceSchema, operationId: z.string().uuid() }).strict()
      .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
    if (raw.operationId !== manifest.operationId) throw new BackupError('INVALID');
    if (encoder.encode(JSON.stringify(raw.backup)).length > MAX_BACKUP_BYTES) throw new BackupError('TOO_LARGE');
    const backup = parseFullBackup(raw.backup);
    const originalCache = (raw.backup as { cache: Record<string, unknown> }).cache;
    return { ...raw, backup, expiredCacheCount: Object.keys(originalCache).length - Object.keys(backup.cache).length };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('INVALID');
  }
}
