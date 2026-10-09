import { canonical, sha256 } from '../../lib/backup/compare';
import { MANIFEST_FILE, PART_BYTES, type GistFiles } from '../../lib/backup/crypto';

/** Produces authenticated hostile payloads without weakening the production encoder. */
export async function encryptedFixture(payload: object, password: string, operationId: string): Promise<GistFiles> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: 'tap-translate-encrypted-backup', version: 1, operationId,
    cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600_000,
    salt: Buffer.from(salt).toString('base64'), iv: Buffer.from(iv).toString('base64') };
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
    additionalData: encoder.encode(canonical(header)) }, key, encoder.encode(JSON.stringify(payload)));
  const encoded = Buffer.from(cipher).toString('base64');
  const files: GistFiles = {};
  const parts: { name: string; bytes: number; sha256: string }[] = [];
  for (let start = 0; start < encoded.length; start += PART_BYTES) {
    const name = `tap-translate.part-${String(parts.length + 1).padStart(4, '0')}`;
    const content = encoded.slice(start, start + PART_BYTES);
    files[name] = { content };
    parts.push({ name, bytes: content.length, sha256: await sha256(encoder.encode(content)) });
  }
  files[MANIFEST_FILE] = { content: JSON.stringify({ ...header, cipherBytes: cipher.byteLength, parts }) };
  return files;
}
