// Only this extension's POSTs to the loopback OpenAI-compatible chat endpoint
// need local-origin compatibility. Remote APIs and webpage requests are excluded.
const LOCAL_CHAT_PATTERN = '^http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?/v1/chat/completions$';
const LOCAL_CHAT_RULE_ID = 11434;
let ruleReady: Promise<void> | undefined;

export function isLocalApiBase(apiBase: string): boolean {
  try {
    const url = new URL(apiBase);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function prepareLocalRequest(url: string): Promise<void> {
  if (!new RegExp(LOCAL_CHAT_PATTERN).test(new URL(url).href)) return;
  // Older browsers can still connect when the local service allows their origin.
  const dnr = globalThis.chrome?.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  if (!ruleReady) {
    // Firefox's runtime.id is an add-on ID, not the moz-extension URL hostname.
    const initiator = new URL(chrome.runtime.getURL('/')).hostname;
    ruleReady = dnr.updateSessionRules({
      removeRuleIds: [LOCAL_CHAT_RULE_ID],
      addRules: [{
        id: LOCAL_CHAT_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [{
            header: 'Origin',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          }],
        },
        condition: {
          regexFilter: LOCAL_CHAT_PATTERN,
          isUrlFilterCaseSensitive: true,
          initiatorDomains: [initiator],
          requestMethods: ['post' as chrome.declarativeNetRequest.RequestMethod],
          resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
        },
      }],
    }).catch((error: unknown) => {
      ruleReady = undefined;
      throw error;
    });
  }
  await ruleReady;
}

/** Wait for browser-side header handling before the first probe or translation. */
export async function fetchCompletion(url: string, init: RequestInit): Promise<Response> {
  init.signal?.throwIfAborted();
  await prepareLocalRequest(url);
  init.signal?.throwIfAborted();
  return fetch(url, init);
}
