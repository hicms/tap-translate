import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { translateTexts } from '../lib/provider';
import type { Settings } from '../lib/types';
import { parseSettings } from '../lib/settings/schema';
import { defaultModelParameters } from '../lib/settings/model-parameters';

function settings(partial: Partial<Settings> = {}): Settings {
  return parseSettings({
    schemaVersion: 4,
    connectionMode: 'direct',
    apiBase: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-v4-flash',
    targetLang: 'zh-CN',
    uiLocale: 'en',
    mode: 'bilingual',
    maxConcurrent: 3,
    batchSize: 6,
    customHeaders: {},
    siteRules: [],
    revision: 0,
    ...partial,
  });
}

describe('translateTexts / DeepSeek V4 thinking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables thinking for DeepSeek endpoints', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"你好"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await translateTexts(['Hello'], settings());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.deepseek.com/chat/completions');
  });

  it('does not force thinking off for non-DeepSeek providers', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"Hola"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await translateTexts(['Hello'], settings({ apiBase: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.thinking).toBeUndefined();
  });

  it('uses MiniMax completion token field and disables M3 thinking by default', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"你好"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await translateTexts(['Hello'], settings({
      apiBase: 'https://api.minimax.cn/v1',
      apiKey: 'mm-test',
      model: 'MiniMax-M3',
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(1024);
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('falls back to JSON inside reasoning_content when content is empty', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '', reasoning_content: 'thinking... {"0":"世界"} done' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(translateTexts(['World'], settings())).resolves.toEqual(['世界']);
  });

  it('bisects malformed batches serially (never parallel)', async () => {
    const fetchMock = vi.mocked(fetch);
    let inflight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (_url, init) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight--;
      const body = JSON.parse(String(init?.body));
      const user = JSON.parse(body.messages[1].content) as Record<string, string>;
      const keys = Object.keys(user);
      if (keys.length > 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const out: Record<string, string> = {};
      for (const k of keys) out[k] = `T:${user[k]}`;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await translateTexts(['A', 'B'], settings({ apiBase: 'https://api.openai.com/v1', model: 'gpt' }));
    expect(result).toEqual(['T:A', 'T:B']);
    expect(peak).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('aborts before fetch when signal is already aborted', async () => {
    const fetchMock = vi.mocked(fetch);
    const ac = new AbortController();
    ac.abort();
    await expect(translateTexts(['Hi'], settings(), ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the selected model parameters and additional translation instructions', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"你好"}' } }] }), { status: 200 }));
    await translateTexts(['Hello'], settings({
      modelParameters: { ...defaultModelParameters(), temperature: 0.5, maxTokens: 2048, topP: 0.8, systemPrompt: 'Use academic terminology.' },
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ temperature: 0.5, max_tokens: 2048, top_p: 0.8 });
    expect(body.messages[0].content).toContain('Use academic terminology.');
    expect(body.messages[0].content).toContain('JSON');
  });
});
