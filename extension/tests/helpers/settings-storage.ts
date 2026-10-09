import { vi } from 'vitest';
export function mockChromeStorage(initial?: {
  blockLanguageWrite?: boolean;
  sync?: Record<string, unknown>;
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
}) {
  const sync = new Map<string, unknown>(Object.entries(initial?.sync ?? {}));
  const local = new Map<string, unknown>(Object.entries(initial?.local ?? {}));
  const session = new Map<string, unknown>(Object.entries(initial?.session ?? {}));
  let releaseLanguageWrite: (() => void) | undefined;
  const languageWriteStarted = new Promise<void>((resolve) => {
    releaseLanguageWrite = resolve;
  });
  let signalLanguageWrite: (() => void) | undefined;
  const waitForLanguageWrite = new Promise<void>((resolve) => {
    signalLanguageWrite = resolve;
  });

  const read = (store: Map<string, unknown>, keys?: string | string[] | Record<string, unknown>) => {
    if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
    }
    return { ...(keys ?? {}), ...Object.fromEntries(store) };
  };
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(session, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => { for (const [key, value] of Object.entries(patch)) session.set(key, value); }),
        remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key); }),
      },
      sync: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(sync, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          if (initial?.blockLanguageWrite && patch.targetLang === 'fr') {
            signalLanguageWrite?.();
            await languageWriteStarted;
          }
          for (const [key, value] of Object.entries(patch)) sync.set(key, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) sync.delete(key);
        }),
      },
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => read(local, keys)),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(patch)) local.set(key, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) local.delete(key);
        }),
      },
    },
  });

  return {
    releaseLanguageWrite: () => releaseLanguageWrite?.(),
    waitForLanguageWrite,
    sync,
    local,
    session,
  };
}
