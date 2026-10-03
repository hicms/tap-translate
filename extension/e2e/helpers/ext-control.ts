import type { BrowserContext, Page, Worker } from '@playwright/test';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { DEFAULT_MODEL_SCHEDULING, SETTINGS_SCHEMA_VERSION } from '../../lib/settings/schema';

export interface E2ESettings {
  apiBase: string;
  apiKey?: string;
  connectionMode?: 'direct' | 'proxy';
  model?: string;
  targetLang?: string;
  mode?: 'bilingual' | 'replace';
  uiLocale?: string;
}

export interface PublicSessionConfigLite {
  sessionId: string;
  revision: number;
  targetLang: string;
  uiLocale: string;
  mode: 'bilingual' | 'replace';
  maxConcurrent: number;
  batchSize: number;
  providerFingerprint: string;
  disabled: boolean;
  siteContentRule?: { host: string };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Wait until the MV3 service worker is registered and return its id. */
export async function waitForExtensionId(context: BrowserContext): Promise<{
  extensionId: string;
  sw: Worker;
}> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 400));
  const extensionId = sw.url().split('/')[2] ?? '';
  if (!extensionId) throw new Error('extension id missing from service worker URL');
  return { extensionId, sw };
}

/**
 * Seed chrome.storage from an extension page (trusted origin).
 * Opening popup.html also wakes the service worker so later sw.evaluate calls work.
 */
export async function seedSettings(
  context: BrowserContext,
  extensionId: string,
  settings: E2ESettings,
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForSelector('#primaryBtn', { timeout: 15_000 });
    const written = await page.evaluate(async ({ s, parameters, scheduling, schemaVersion }) => {
      await chrome.storage.local.set({
        apiKey: s.apiKey ?? 'e2e-test-key',
        customHeaders: {},
        tapTranslateSettingsMeta: { revision: 1 },
        providers: [{
          id: 'e2e-provider', name: 'E2E', apiBase: s.apiBase,
          connectionMode: s.connectionMode ?? 'direct', persistApiKey: true,
          models: [{ id: 'e2e-model', name: s.model ?? 'e2e-mock', parameters, ...scheduling }],
          activeModelId: 'e2e-model',
        }],
        activeProviderId: 'e2e-provider',
        tapTranslateProviderSchemaVersion: schemaVersion,
        tapTranslateProviderSecrets: { 'e2e-provider': { apiKey: s.apiKey ?? 'e2e-test-key', customHeaders: {} } },
      });
      await chrome.storage.sync.set({
        schemaVersion,
        connectionMode: s.connectionMode ?? 'direct',
        apiBase: s.apiBase,
        model: s.model ?? 'e2e-mock',
        targetLang: s.targetLang ?? 'zh-CN',
        uiLocale: s.uiLocale ?? 'en',
        mode: s.mode ?? 'bilingual',
        ...scheduling,
        siteRules: [],
        revision: 1,
      });
      return chrome.storage.sync.get(['apiBase', 'mode']);
    }, { s: settings, parameters: defaultModelParameters(), scheduling: DEFAULT_MODEL_SCHEDULING, schemaVersion: SETTINGS_SCHEMA_VERSION });
    if (written.apiBase !== settings.apiBase) {
      throw new Error(`seedSettings failed: apiBase=${String(written.apiBase)}`);
    }
  } finally {
    await page.close();
  }
}

function sessionConfig(mode: 'bilingual' | 'replace', targetLang = 'zh-CN'): PublicSessionConfigLite {
  return {
    sessionId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    revision: 1,
    targetLang,
    uiLocale: 'en',
    mode,
    maxConcurrent: 3,
    batchSize: 6,
    providerFingerprint: 'e2e-mock-fp',
    disabled: false,
  };
}

type ContentAction =
  | { action: 'translatePage'; config: PublicSessionConfigLite }
  | { action: 'restoreOriginal' }
  | { action: 'stopWatch' }
  | { action: 'getStatus' };

/**
 * Production-aligned allFrames relay (mirrors lib/inject.sendToContentFrames).
 * Main-frame-only tabs.sendMessage would miss same-origin iframes.
 */
async function relayToFrames(
  sw: Worker,
  tabId: number,
  message: ContentAction,
  label: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return withTimeout(
    sw.evaluate(
      async ({ id, msg }) => {
        const ping = (): Promise<boolean> =>
          new Promise((resolve) => {
            chrome.tabs.sendMessage(id, { action: 'ping' }, (response) => {
              if (chrome.runtime.lastError) resolve(false);
              else resolve(Boolean(response?.pong));
            });
          });

        // Re-injecting tap-translate.js tears down the active session (stopWatch on
        // load). Only inject when the content script is missing.
        if (!(await ping())) {
          await chrome.scripting.executeScript({
            target: { tabId: id, allFrames: true },
            files: ['tap-translate.js'],
          });
          await chrome.scripting.insertCSS({
            target: { tabId: id, allFrames: true },
            files: ['tap-translate.css'],
          });
        }

        type FrameReply = { ok: boolean; payload: unknown };
        const results = await chrome.scripting.executeScript({
          target: { tabId: id, allFrames: true },
          func: (raw) => {
            const g = (globalThis as {
              __TAP_TRANSLATE__?: {
                handleMessage: (
                  req: unknown,
                  sender: unknown,
                  reply: (r: unknown) => void,
                ) => boolean;
              };
            }).__TAP_TRANSLATE__;
            if (!g?.handleMessage) return { ok: false, payload: null };
            return new Promise<FrameReply>((resolve) => {
              let settled = false;
              const reply = (r: unknown) => {
                if (settled) return;
                settled = true;
                resolve({ ok: true, payload: r });
              };
              try {
                const keep = g.handleMessage(raw, null, reply);
                if (!keep && !settled) {
                  settled = true;
                  resolve({ ok: true, payload: null });
                }
              } catch (err) {
                resolve({
                  ok: false,
                  payload: { success: false, error: err instanceof Error ? err.message : String(err) },
                });
              }
            });
          },
          args: [msg],
        });

        const frames = results.map((r) => (r.result as FrameReply | null)?.payload ?? null);
        let success = false;
        let count = 0;
        let failed = 0;
        let total = 0;
        let watching = false;
        let shadowRoots = 0;
        let lastIndexMs = 0;
        let lastMutationIndexMs = 0;
        let error: string | undefined;
        const frameSummary = { sameOrigin: 0, crossOrigin: 0, opaque: 0 };

        for (const payload of frames) {
          if (!payload || typeof payload !== 'object') continue;
          const p = payload as Record<string, unknown>;
          if (p.success === true) success = true;
          if (p.success === false && typeof p.error === 'string' && !error) error = p.error;
          count += Number(p.count) || 0;
          failed += Number(p.failed) || 0;
          total += Number(p.total) || 0;
          watching = watching || Boolean(p.watching);
          shadowRoots += Number(p.shadowRoots) || 0;
          const f = p.frames as { sameOrigin?: number; crossOrigin?: number; opaque?: number } | undefined;
          if (f) {
            frameSummary.sameOrigin += f.sameOrigin || 0;
            frameSummary.crossOrigin += f.crossOrigin || 0;
            frameSummary.opaque += f.opaque || 0;
          }
          const perf = p.perf as { lastIndexMs?: number; lastMutationIndexMs?: number } | undefined;
          if (perf?.lastIndexMs != null) lastIndexMs = Math.max(lastIndexMs, Number(perf.lastIndexMs) || 0);
          if (perf?.lastMutationIndexMs != null) {
            lastMutationIndexMs = Math.max(lastMutationIndexMs, Number(perf.lastMutationIndexMs) || 0);
          }
        }

        if (!success && frames.some((f) => f != null)) {
          if (msg.action === 'getStatus' || msg.action === 'restoreOriginal' || msg.action === 'stopWatch') {
            success = true;
          }
        }

        return {
          success,
          count,
          failed,
          total,
          watching,
          shadowRoots,
          frames: frameSummary,
          perf: { lastIndexMs, lastMutationIndexMs },
          error: success ? undefined : error || 'no frame responded',
          framePayloads: frames,
        };
      },
      { id: tabId, msg: message },
    ),
    timeoutMs,
    label,
  );
}

/** Inject tap-translate.js and run translatePage across all reachable frames. */
export async function translateTab(
  sw: Worker,
  tabId: number,
  mode: 'bilingual' | 'replace' = 'bilingual',
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const host = await sw.evaluate(async id => new URL((await chrome.tabs.get(id)).url!).hostname, tabId);
  return relayToFrames(
    sw,
    tabId,
    { action: 'translatePage', config: { ...sessionConfig(mode), siteContentRule: { host } } },
    'translateTab',
    opts?.timeoutMs ?? 25_000,
  );
}

export async function restoreTab(sw: Worker, tabId: number): Promise<Record<string, unknown>> {
  return relayToFrames(sw, tabId, { action: 'restoreOriginal' }, 'restoreTab', 12_000);
}

export async function stopWatchTab(sw: Worker, tabId: number): Promise<void> {
  await relayToFrames(sw, tabId, { action: 'stopWatch' }, 'stopWatchTab', 5_000).catch(() => undefined);
}

export async function getTabStatus(sw: Worker, tabId: number): Promise<Record<string, unknown>> {
  return relayToFrames(sw, tabId, { action: 'getStatus' }, 'getTabStatus', 8_000);
}

/** Selection translate via the production inject + executeScript path. */
export async function translateSelectionInTab(
  sw: Worker,
  tabId: number,
  text: string,
  opts?: { frameId?: number; timeoutMs?: number; disabled?: boolean },
): Promise<Record<string, unknown>> {
  const frameId = opts?.frameId ?? 0;
  return withTimeout(
    sw.evaluate(
      async ({ id, frame, selected, disabled }) => {
        const ping = (): Promise<{ pong?: boolean; version?: string; runtimeId?: string | null } | null> =>
          new Promise((resolve) => {
            chrome.tabs.sendMessage(id, { action: 'ping' }, { frameId: frame }, (response) => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(response || null);
            });
          });
        const expected = chrome.runtime.getManifest().version;
        const live = (reply: Awaited<ReturnType<typeof ping>>): boolean =>
          Boolean(
            reply?.pong
            && reply.version === expected
            && reply.runtimeId === chrome.runtime.id,
          );

        if (!live(await ping())) {
          await chrome.scripting.executeScript({
            target: { tabId: id, frameIds: [frame] },
            files: ['tap-translate.js'],
          });
          await chrome.scripting.insertCSS({
            target: { tabId: id, frameIds: [frame] },
            files: ['tap-translate.css'],
          });
          if (!live(await ping())) {
            return { success: false, error: 'content script did not bind' };
          }
        }

        const config = {
          sessionId: `e2e-sel-${Date.now()}`,
          revision: 1,
          targetLang: 'zh-CN',
          uiLocale: 'en',
          mode: 'bilingual' as const,
          maxConcurrent: 3,
          batchSize: 6,
          providerFingerprint: 'e2e-mock-fp',
          disabled,
        };

        type FrameReply = { ok: boolean; payload: unknown };
        const results = await chrome.scripting.executeScript({
          target: { tabId: id, frameIds: [frame] },
          func: (cfg, selectedText: string) => {
            const g = (globalThis as {
              __TAP_TRANSLATE__?: {
                handleMessage: (
                  req: unknown,
                  sender: unknown,
                  reply: (r: unknown) => void,
                ) => boolean;
              };
            }).__TAP_TRANSLATE__;
            if (!g?.handleMessage) return { ok: false, payload: null };
            return new Promise<FrameReply>((resolve) => {
              let settled = false;
              const reply = (r: unknown) => {
                if (settled) return;
                settled = true;
                resolve({ ok: true, payload: r });
              };
              try {
                const keep = g.handleMessage(
                  { action: 'translateSelection', config: cfg, text: selectedText },
                  null,
                  reply,
                );
                if (!keep && !settled) {
                  settled = true;
                  resolve({ ok: true, payload: null });
                }
              } catch (err) {
                resolve({
                  ok: false,
                  payload: { success: false, error: err instanceof Error ? err.message : String(err) },
                });
              }
            });
          },
          args: [config, selected],
        });
        const result = results[0]?.result as FrameReply | undefined;
        return (result?.payload as Record<string, unknown>) || { success: false, error: 'no reply' };
      },
      { id: tabId, frame: frameId, selected: text, disabled: opts?.disabled ?? false },
    ),
    opts?.timeoutMs ?? 25_000,
    'translateSelectionInTab',
  );
}

/** Force a real script rebind to exercise destroy/teardown behavior. */
export async function reinjectFrame(sw: Worker, tabId: number, frameId = 0): Promise<void> {
  await sw.evaluate(async ({ id, frame }) => {
    await chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [frame] },
      files: ['tap-translate.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: id, frameIds: [frame] },
      files: ['tap-translate.css'],
    });
  }, { id: tabId, frame: frameId });
}

export async function inspectSelectionOverlay(page: Page): Promise<{
  present: boolean;
  hostCount: number;
  bodyText: string;
  originalText: string;
  isError: boolean;
  isLoading: boolean;
}> {
  return page.evaluate(() => {
    const host = document.getElementById('tap-translate-overlay-host');
    if (!host?.shadowRoot) {
      return {
        present: false,
        hostCount: 0,
        bodyText: '',
        originalText: '',
        isError: false,
        isLoading: false,
      };
    }
    const body = host.shadowRoot.querySelector('.dr-body');
    const original = host.shadowRoot.querySelector('.dr-original');
    const cls = body?.className || '';
    return {
      present: true,
      hostCount: document.querySelectorAll('#tap-translate-overlay-host').length,
      bodyText: (body?.textContent || '').trim(),
      originalText: (original?.textContent || '').trim(),
      isError: cls.includes('dr-error'),
      isLoading: cls.includes('dr-loading'),
    };
  });
}

export async function getTabId(page: Page, sw: Worker): Promise<number> {
  const url = page.url();
  return withTimeout(
    sw.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const hit = tabs.find((t) => t.url === targetUrl);
      if (!hit?.id) throw new Error(`no tab for ${targetUrl}`);
      return hit.id;
    }, url),
    8_000,
    'getTabId',
  );
}

export async function inspectTranslation(page: Page): Promise<{
  targetCount: number;
  errorCount: number;
  doneCount: number;
  hideCount: number;
  replaceCount: number;
  targetSamples: string[];
  titleText: string;
  editorText: string;
  p1Text: string;
}> {
  return page.evaluate(() => {
    const targets = [...document.querySelectorAll('.tap-translate-target')];
    const errors = [...document.querySelectorAll('.tap-translate-error')];
    const done = [...document.querySelectorAll('[data-tap-translate-done]')];
    const hide = [...document.querySelectorAll('.tap-translate-original-hidden')];
    const replace = [...document.querySelectorAll('.tap-translate-replace-text')];
    return {
      targetCount: targets.length,
      errorCount: errors.length,
      doneCount: done.length,
      hideCount: hide.length,
      replaceCount: replace.length,
      targetSamples: targets.slice(0, 8).map((el) => (el.textContent || '').trim()),
      titleText: (document.getElementById('title')?.textContent || '').trim(),
      editorText: (document.getElementById('editor')?.textContent || '').trim(),
      p1Text: (document.getElementById('p1')?.textContent || '').trim(),
    };
  });
}
