import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatUrl = 'http://127.0.0.1:11434/v1/chat/completions';
const extensionHost = 'kndmfpimnkdhdncplhgppfjncinmkjhb';
const responseBody = { choices: [{ message: { content: '{"0":"你好"}' } }] };

function mockBrowser(extensionUrl = `chrome-extension://${extensionHost}/`) {
  const updateSessionRules = vi.fn<(options: chrome.declarativeNetRequest.UpdateRuleOptions) => Promise<void>>()
    .mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: { getURL: vi.fn(() => extensionUrl) },
    permissions: { contains: vi.fn(async () => true) },
    declarativeNetRequest: { updateSessionRules },
  });
  return updateSessionRules;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responseBody))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local chat requests', () => {
  it('waits for one shared rule installation before concurrent requests', async () => {
    const update = mockBrowser();
    let finishInstall!: () => void;
    update.mockReturnValue(new Promise<void>((resolve) => { finishInstall = resolve; }));
    const { fetchCompletion } = await import('../lib/provider/local-request');
    const init = { method: 'POST', body: '{"model":"local"}' };
    const first = fetchCompletion(chatUrl, init);
    const second = fetchCompletion(chatUrl, init);
    expect(fetch).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    finishInstall();
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(chatUrl, init);
  });

  it('limits header changes to this extension, POST, and exact loopback chat paths', async () => {
    const update = mockBrowser();
    const { fetchCompletion } = await import('../lib/provider/local-request');
    await fetchCompletion(chatUrl, { method: 'POST' });
    const rule = update.mock.calls[0]![0].addRules![0]!;
    expect(rule.condition.initiatorDomains).toEqual([extensionHost]);
    expect(rule.condition.requestMethods).toEqual(['post']);
    expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
    expect(rule.action).toEqual({ type: 'modifyHeaders', requestHeaders: [{ header: 'Origin', operation: 'remove' }] });
    const pattern = new RegExp(rule.condition.regexFilter!);
    for (const url of [chatUrl, 'http://localhost:11434/v1/chat/completions', 'http://[::1]:11435/v1/chat/completions']) {
      expect(pattern.test(url), url).toBe(true);
    }
    for (const url of [
      'https://api.openai.com/v1/chat/completions',
      'http://127.0.0.1.evil.test:11434/v1/chat/completions',
      'http://localhost.evil.test/v1/chat/completions',
      'http://192.168.1.10:11434/v1/chat/completions',
      'http://0.0.0.0:11434/v1/chat/completions',
      'http://127.0.0.1:11434/api/delete',
      'http://127.0.0.1:11434/v1/chat/completions/other',
      'https://evil.test/?url=http://127.0.0.1:11434/v1/chat/completions',
    ]) {
      expect(pattern.test(url), url).toBe(false);
    }
  });

  it('uses the Firefox extension URL hostname rather than its add-on ID', async () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const update = mockBrowser(`moz-extension://${uuid}/`);
    const { fetchCompletion } = await import('../lib/provider/local-request');
    await fetchCompletion(chatUrl, { method: 'POST' });
    expect(update.mock.calls[0]![0].addRules![0]!.condition.initiatorDomains).toEqual([uuid]);
  });

  it('leaves remote requests unchanged without installing a rule', async () => {
    const update = mockBrowser();
    const { fetchCompletion } = await import('../lib/provider/local-request');
    const url = 'https://api.example.com/v1/chat/completions';
    const init = { method: 'POST', headers: { Authorization: 'Bearer cloud-key' }, body: '{}' };
    await fetchCompletion(url, init);
    expect(update).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(url, init);
  });

  it('does not send a request after registration fails, and permits a later retry', async () => {
    const update = mockBrowser();
    update.mockRejectedValueOnce(new Error('registration failed'));
    const { fetchCompletion } = await import('../lib/provider/local-request');
    await expect(fetchCompletion(chatUrl, { method: 'POST' })).rejects.toThrow('registration failed');
    expect(fetch).not.toHaveBeenCalled();
    await fetchCompletion(chatUrl, { method: 'POST' });
    expect(update).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('honors cancellation while installing the local rule', async () => {
    const update = mockBrowser();
    let finishInstall!: () => void;
    update.mockReturnValue(new Promise<void>((resolve) => { finishInstall = resolve; }));
    const { fetchCompletion } = await import('../lib/provider/local-request');
    const controller = new AbortController();
    const request = fetchCompletion(chatUrl, { method: 'POST', signal: controller.signal });
    controller.abort();
    finishInstall();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('can still call a configured local server when the rule API is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    const { fetchCompletion } = await import('../lib/provider/local-request');
    await fetchCompletion(chatUrl, { method: 'POST' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('local provider integration', () => {
  it('accepts a blank local key but still requires credentials for cloud endpoints', async () => {
    const { isConnectionConfigured } = await import('../lib/provider/connection');
    for (const apiBase of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://[::1]:11434/v1']) {
      expect(isConnectionConfigured({ connectionMode: 'direct', apiBase, apiKey: '' })).toBe(true);
    }
    for (const apiBase of ['https://api.example.com/v1', 'https://localhost.evil.test/v1', 'http://192.168.1.10/v1', 'invalid']) {
      expect(isConnectionConfigured({ connectionMode: 'direct', apiBase, apiKey: '' })).toBe(false);
    }
  });

  it('applies local request handling to both the connection probe and translation', async () => {
    const update = mockBrowser();
    const { testConnection } = await import('../lib/provider/connection');
    const { translateTexts } = await import('../lib/provider');
    const { createDefaultSettings } = await import('../lib/settings/schema');
    const settings = {
      ...createDefaultSettings(),
      apiBase: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'kaelri/hy-mt2:1.8b',
    };
    expect((await testConnection(settings)).ok).toBe(true);
    expect(await translateTexts(['Hello'], settings)).toEqual(['你好']);
    expect(update).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe(chatUrl);
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(String(init?.body)).model).toBe('kaelri/hy-mt2:1.8b');
    }
  });
});
