import { afterEach, describe, expect, it, vi } from 'vitest';
import { isConnectionConfigured, testConnection } from '../lib/provider/connection';
import { getProviderPreset } from '../lib/provider/presets';

describe('isConnectionConfigured', () => {
  it('requires an API key', () => {
    expect(isConnectionConfigured({
      connectionMode: 'direct', apiBase: 'https://api.deepseek.com', apiKey: '',
    })).toBe(false);
    expect(isConnectionConfigured({
      connectionMode: 'direct', apiBase: 'https://api.deepseek.com', apiKey: 'sk-x',
    })).toBe(true);
  });

  it('allows a proxy to manage the upstream API key', () => {
    expect(isConnectionConfigured({
      connectionMode: 'proxy', apiBase: 'https://proxy.example.com/v1', apiKey: '',
    })).toBe(true);
  });
});

describe('testConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the Agent Plan OpenAI path, default model and dedicated Bearer key', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"pong"}' } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const preset = getProviderPreset('ark-agent-plan');
    const result = await testConnection({
      connectionMode: preset.mode, apiBase: preset.apiBase, model: preset.model,
      apiKey: 'agent-plan-test-key', customHeaders: {}, targetLang: 'en',
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer agent-plan-test-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'ark-code-latest' });
  });

  it('requires API credentials before testing', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    const result = await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.deepseek.com',
      apiKey: '',
      model: 'x',
      customHeaders: {},
      targetLang: 'en',
    });
    expect(result.code).toBe('CONFIG_REQUIRED');
  });

  it('returns OK on a healthy chat completion', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"pong"}' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const result = await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'x',
      customHeaders: {},
      targetLang: 'en',
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('disables thinking for DeepSeek models on the connection probe', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"pong"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      customHeaders: {},
      targetLang: 'zh-CN',
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { thinking?: { type: string } };
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('does not force thinking off for non-DeepSeek probe models', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      customHeaders: {},
      targetLang: 'zh-CN',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { thinking?: unknown };
    expect(body.thinking).toBeUndefined();
  });

  it('uses MiniMax completion token field for connection probes', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.minimax.cn/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      customHeaders: {},
      targetLang: 'zh-CN',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { max_completion_tokens?: number; max_tokens?: number };
    expect(body.max_completion_tokens).toBe(64);
    expect(body.max_tokens).toBeUndefined();
  });

  it('maps 401 to AUTH_INVALID', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );
    const result = await testConnection({
      connectionMode: 'direct',
      apiBase: 'https://api.deepseek.com',
      apiKey: 'bad',
      model: 'x',
      customHeaders: {},
      targetLang: 'en',
    });
    expect(result.code).toBe('AUTH_INVALID');
  });
});
