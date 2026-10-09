import type { SiteProfile } from '../../lib/sites/types';
import type { SiteContentRule } from '../../lib/types';
import { ensureFrameContentScript, isRestrictedUrl, originPattern } from '../../lib/inject';
import { contentCheckRequestSchema, contentCheckResultSchema, type ContentCheckResult } from '../../lib/sites/check';

/** A settings tab is not a webpage: use the most recently visited other tab. */
export async function checkCurrentPage(rule: SiteContentRule, profile?: SiteProfile | null): Promise<ContentCheckResult> {
  const request = contentCheckRequestSchema.parse({ action: 'checkSiteContent', rule, profile });
  const own = await chrome.tabs.getCurrent();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs.filter(tab => tab.id !== own?.id).sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!target?.id) throw new Error('CHECK_UNSUPPORTED');
  if (!target.url) {
    // Restricted tabs can hide their URL without the broad tabs permission.
    // A metadata-only probe lets the browser reject them before any host prompt.
    try {
      const [probe] = await chrome.scripting.executeScript({ target: { tabId: target.id, frameIds: [0] }, func: () => location.origin });
      if (probe?.result) target.url = probe.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/chrome:\/\/|edge:\/\/|about:|chrome-extension:\/\/|extensions gallery|Cannot access a chrome/i.test(message)) throw new Error('CHECK_UNSUPPORTED');
      // Ordinary sites without access proceed to the exact-host permission request.
    }
  }
  // URL can be withheld without permission; request only the edited host.
  if (target.url) assertTarget(target.url, rule.host);
  const origin = target.url ? originPattern(target.url) : `https://${rule.host}/*`;
  if (!origin) throw new Error('CHECK_UNSUPPORTED');
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error('CHECK_PERMISSION');
  }
  const current = await chrome.tabs.get(target.id);
  assertTarget(current.url, rule.host);
  if (!(await ensureFrameContentScript(target.id, 0))) throw new Error('CHECK_UNAVAILABLE');
  const response: unknown = await chrome.tabs.sendMessage(target.id, request, { frameId: 0 });
  if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('result' in response)) throw new Error('CHECK_UNAVAILABLE');
  const result = contentCheckResultSchema.parse(response.result);
  if (result.host !== rule.host) throw new Error('CHECK_HOST_MISMATCH');
  return result;
}

function assertTarget(url: string | undefined, host: string): void {
  if (!url || isRestrictedUrl(url) || !/^https?:\/\//.test(url)) throw new Error('CHECK_UNSUPPORTED');
  if (new URL(url).hostname !== host) throw new Error('CHECK_HOST_MISMATCH');
}
