import { z } from 'zod';
import type { PublicSessionConfig } from '../types';

/**
 * Cache v2 (namespace dr:c3):
 * - key = sha256(text + targetLang + providerFingerprint)
 * - L1 memory always
 * - L2 chrome.storage.local with TTL + byte-aware LRU
 * - Incognito: L1 only (never persist)
 */

const NS = 'dr:c3:';
/** Legacy namespaces purged on clear / eviction sweeps. */
const LEGACY_NS = ['dr:c2:', 'dr:c:'];
const MAX_ENTRIES = 5000;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MiB of translation payload
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EVICT_EVERY = 200;

const l1 = new Map<string, string>();
let writesSinceEvict = 0;

interface CacheEntry {
  t: string;
  at: number;
  /** UTF-8 byte length of `t` (approx via string length * 2 for JS strings is wrong; store explicit). */
  b: number;
}

type CacheSettings = Pick<PublicSessionConfig, 'targetLang' | 'providerFingerprint'>;

export function isIncognitoContext(): boolean {
  try {
    return Boolean(chrome?.extension?.inIncognitoContext);
  } catch {
    return false;
  }
}

function utf8Bytes(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

async function keyFor(text: string, settings: CacheSettings): Promise<string> {
  const material = [text, settings.targetLang, settings.providerFingerprint].join('\u0000');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return NS + hex;
}

function isFresh(entry: CacheEntry, now = Date.now()): boolean {
  return Boolean(entry?.t) && now - (entry.at || 0) < TTL_MS;
}

function isCacheKey(k: string): boolean {
  if (k.startsWith(NS)) return true;
  return LEGACY_NS.some((p) => k.startsWith(p));
}

/** Returns translations aligned to `texts`; null for misses. */
export async function lookup(
  texts: string[],
  settings: CacheSettings,
): Promise<(string | null)[]> {
  if (!texts.length) return [];
  const keys = await Promise.all(texts.map((t) => keyFor(t, settings)));
  const now = Date.now();
  const persist = !isIncognitoContext();

  const need: string[] = [];
  for (const k of keys) {
    if (!l1.has(k)) need.push(k);
  }

  if (need.length && persist) {
    try {
      const stored = (await chrome.storage.local.get(need)) as Record<string, CacheEntry>;
      const stale: string[] = [];
      for (const k of need) {
        const entry = stored[k];
        if (entry && typeof entry.t === 'string' && isFresh(entry, now)) {
          l1.set(k, entry.t);
        } else if (entry) {
          stale.push(k);
        }
      }
      if (stale.length) void chrome.storage.local.remove(stale);
    } catch {
      /* storage unavailable — fall back to L1 only */
    }
  }

  return keys.map((k) => (l1.has(k) ? (l1.get(k) as string) : null));
}

export async function store(
  entries: { text: string; translation: string }[],
  settings: CacheSettings,
): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  const payload: Record<string, CacheEntry> = {};
  for (const { text, translation } of entries) {
    if (!translation) continue;
    const k = await keyFor(text, settings);
    l1.set(k, translation);
    payload[k] = { t: translation, at: now, b: utf8Bytes(translation) };
  }
  const keys = Object.keys(payload);
  if (!keys.length) return;

  if (isIncognitoContext()) {
    // Privacy: never write translation cache to disk in incognito.
    return;
  }

  try {
    await chrome.storage.local.set(payload);
    writesSinceEvict += keys.length;
    if (writesSinceEvict >= EVICT_EVERY) {
      writesSinceEvict = 0;
      await evictIfNeeded();
    }
  } catch {
    /* storage quota or unavailable — L1 still holds the entries */
  }
}

async function evictIfNeeded(): Promise<void> {
  try {
    const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
    const now = Date.now();
    const rows: { k: string; at: number; b: number }[] = [];
    const expired: string[] = [];

    for (const [k, raw] of Object.entries(all)) {
      if (!isCacheKey(k)) continue;
      // Drop legacy namespaces immediately (wrong fingerprint era).
      if (!k.startsWith(NS)) {
        expired.push(k);
        continue;
      }
      const entry = raw as CacheEntry;
      if (!entry || typeof entry.t !== 'string' || !isFresh(entry, now)) {
        expired.push(k);
        continue;
      }
      rows.push({
        k,
        at: entry.at || 0,
        b: typeof entry.b === 'number' ? entry.b : utf8Bytes(entry.t),
      });
    }

    if (expired.length) {
      await chrome.storage.local.remove(expired);
      for (const k of expired) l1.delete(k);
    }

    rows.sort((a, b) => a.at - b.at);
    let totalBytes = rows.reduce((n, r) => n + r.b, 0);
    const toRemove: string[] = [];

    while (
      rows.length
      && (rows.length > MAX_ENTRIES || totalBytes > MAX_BYTES)
    ) {
      const victim = rows.shift()!;
      toRemove.push(victim.k);
      totalBytes -= victim.b;
    }

    // If still over after count trim, also shed to 80% byte budget.
    if (totalBytes > MAX_BYTES * 0.8) {
      while (rows.length && totalBytes > MAX_BYTES * 0.8) {
        const victim = rows.shift()!;
        toRemove.push(victim.k);
        totalBytes -= victim.b;
      }
    }

    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
      for (const k of toRemove) l1.delete(k);
    }
  } catch {
    /* best-effort eviction */
  }
}

export async function clearCache(): Promise<void> {
  l1.clear();
  try {
    const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
    const cacheKeys = Object.keys(all).filter(isCacheKey);
    if (cacheKeys.length) await chrome.storage.local.remove(cacheKeys);
  } catch {
    /* ignore */
  }
}

export function clearMemoryCache(): void {
  l1.clear();
}

const cacheSnapshotSchema = z.record(
  z.string().regex(/^dr:c3:[a-f0-9]{64}$/),
  z.object({ t: z.string().min(1), at: z.number().int().nonnegative(), b: z.number().int().nonnegative() }).strict(),
);
export type CacheSnapshot = z.infer<typeof cacheSnapshotSchema>;

/** Imported bytes are recomputed; timestamps retain the original expiry. */
export function parseCacheSnapshot(raw: unknown): CacheSnapshot {
  const snapshot = cacheSnapshotSchema.parse(raw);
  const entries = Object.entries(snapshot);
  if (entries.length > MAX_ENTRIES || entries.reduce((sum, [, entry]) => sum + utf8Bytes(entry.t), 0) > MAX_BYTES) {
    throw new Error('Cache snapshot exceeds storage limits');
  }
  const now = Date.now();
  if (entries.some(([, entry]) => entry.at > now)) throw new Error('Cache timestamp is in the future');
  return Object.fromEntries(entries.filter(([, entry]) => isFresh(entry, now))
    .map(([key, entry]) => [key, { ...entry, b: utf8Bytes(entry.t) }]));
}

export async function exportCacheSnapshot(): Promise<CacheSnapshot> {
  if (isIncognitoContext()) return {};
  const all = await chrome.storage.local.get(null);
  const rows = Object.entries(all).filter(([key, entry]) => key.startsWith(NS) && isFresh(entry));
  rows.sort((a, b) => b[1].at - a[1].at);
  let bytes = 0;
  const selected = rows.filter(([, entry], index) => {
    bytes += utf8Bytes(entry.t);
    return index < MAX_ENTRIES && bytes <= MAX_BYTES;
  });
  // Local entries can carry runtime metadata (such as epoch); only the portable
  // cache fields belong in exports. Leave the original stored entries intact.
  return parseCacheSnapshot(Object.fromEntries(selected.map(([key, { t, at, b }]) => [key, { t, at, b }])));
}

/** Replaces only cache-owned keys; storage errors must reach the restore coordinator. */
export async function replaceCacheSnapshot(snapshot: CacheSnapshot): Promise<void> {
  if (isIncognitoContext()) {
    if (Object.keys(snapshot).length) throw new Error('Cannot restore persistent cache in a private window');
    return;
  }
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter(key => isCacheKey(key) && !(key in snapshot));
  if (stale.length) await chrome.storage.local.remove(stale);
  await chrome.storage.local.set(snapshot);
  clearMemoryCache();
}

export function invalidateChangedCache(changes: Record<string, chrome.storage.StorageChange>): void {
  for (const key of Object.keys(changes)) if (isCacheKey(key)) l1.delete(key);
}

/** Test helpers — not used in production paths. */
export const _cacheTest = {
  NS,
  TTL_MS,
  MAX_BYTES,
  isFresh,
  utf8Bytes,
};
