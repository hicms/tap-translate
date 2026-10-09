import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyModelParameters } from '../lib/provider/parameters';
import { defaultModelParameters, modelParametersSchema } from '../lib/settings/model-parameters';
import { parseSettings, providerAffectingChanged, providerFingerprint } from '../lib/settings/schema';
import { prepareSettingsImport } from '../lib/settings/transfer';
import { buildSettingsExport } from './helpers/legacy-settings-export';
import { testConnection } from '../lib/provider/connection';
import { translateTexts } from '../lib/provider';
import { toUserFacingError } from '../lib/errors';
import type { ModelParameters } from '../lib/types';

function config(model: string, parameters: Partial<ModelParameters> = {}, apiBase = 'https://api.minimax.cn/v1') {
  return { apiBase, model, modelParameters: { ...defaultModelParameters(), ...parameters } };
}

function request(model: string, parameters: Partial<ModelParameters> = {}, apiBase?: string) {
  return applyModelParameters({ model, messages: [] }, config(model, parameters, apiBase), 64);
}

describe('thinking request compatibility', () => {
  it.each(['auto', 'disabled'] as const)('disables M3 for %s', (thinking) => {
    expect(request('MiniMax-M3', { thinking }).thinking).toEqual({ type: 'disabled' });
  });

  it('enables M3 with adaptive and omits unsupported effort', () => {
    const body = request('MiniMax-M3', { thinking: 'enabled', reasoningEffort: 'high' });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBe(4096);
  });

  it.each(['auto', 'enabled'] as const)('keeps Flash thinking on for %s', (thinking) => {
    const body = request('MiniMax-M3.1-Flash-Preview', { thinking });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBe(4096);
  });

  it('rejects Flash off without pretending it was disabled', () => {
    expect(() => request('MiniMax-M3.1-Flash-Preview', { thinking: 'disabled' })).toThrow();
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('supports Flash effort %s', (reasoningEffort) => {
    const params = modelParametersSchema.parse({ reasoningEffort });
    expect(request('MiniMax-M3.1-Flash-Preview', params).reasoning_effort).toBe(reasoningEffort);
  });

  it('matches exact model IDs at compatible gateways but does not guess future models', () => {
    expect(request('minimax-m3', { thinking: 'enabled' }, 'https://gateway.example/v1').thinking).toEqual({ type: 'adaptive' });
    expect(request('MiniMax-M3.2', {}, 'https://gateway.example/v1').thinking).toBeUndefined();
  });

  it('preserves generic and DeepSeek defaults and explicit budget', () => {
    expect(request('some-model', {}, 'https://gateway.example/v1').thinking).toBeUndefined();
    expect(request('deepseek-v4-flash', {}, 'https://gateway.example/v1').thinking).toEqual({ type: 'disabled' });
    expect(request('MiniMax-M3.1-Flash-Preview', { maxTokens: 123 }).max_completion_tokens).toBe(123);
  });

  it.each(['xhigh', 'max'] as const)('rejects unsupported generic effort %s with a configuration error', (reasoningEffort) => {
    expect(() => request('unknown-model', { reasoningEffort }, 'https://gateway.example/v1'))
      .toThrow('thinkingEffortUnsupported');
  });

  it('uses custom boolean/nested patches instead of built-in fields and effort', () => {
    const thinkingOverride = { enabled: { enable_thinking: true, reasoning: { effort: 'high', budget: null } }, disabled: { enable_thinking: false } };
    const on = request('MiniMax-M3', { thinking: 'enabled', reasoningEffort: 'high', thinkingOverride });
    expect(on).toMatchObject(thinkingOverride.enabled);
    expect(on.thinking).toBeUndefined();
    expect(on.reasoning_effort).toBeUndefined();
    const off = request('MiniMax-M3.1-Flash-Preview', { thinking: 'disabled', thinkingOverride });
    expect(off.enable_thinking).toBe(false);
    expect(off.thinking).toBeUndefined();
    expect(request('MiniMax-M3', { thinkingOverride }).enable_thinking).toBeUndefined();
    expect(request('MiniMax-M3', { thinkingOverride }).thinking).toBeUndefined();
  });

  it('removes top-level null fields without mutating the input', () => {
    const input = { model: 'custom', messages: [], thinking: { type: 'enabled' }, reasoning_effort: 'high' };
    const body = applyModelParameters(input, config('custom', { thinking: 'disabled', thinkingOverride: { enabled: {}, disabled: { thinking: null, reasoning_effort: null } } }), 64);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(input.thinking).toEqual({ type: 'enabled' });
  });

  it('supports custom always-on models and rejects an unsupported enable', () => {
    expect(() => request('custom', { thinking: 'disabled', thinkingOverride: { enabled: {}, disabled: null } })).toThrow();
    expect(() => request('custom', { thinking: 'enabled', thinkingOverride: { enabled: null, disabled: {} } })).toThrow();
  });
});

describe('thinking configuration persistence', () => {
  it('preserves old settings including conflicting Flash off for repair in the UI', () => {
    const settings = parseSettings({ apiKey: 'keep-me', ...config('MiniMax-M3.1-Flash-Preview', { thinking: 'disabled' }) });
    expect(settings.model).toBe('MiniMax-M3.1-Flash-Preview');
    expect(settings.apiKey).toBe('keep-me');
    expect(settings.modelParameters.thinking).toBe('disabled');
  });

  it('round-trips custom mappings and changes cache identity', async () => {
    const initial = parseSettings(config('custom'));
    const thinkingOverride = { enabled: { reasoning_effort: 'high' }, disabled: { reasoning_effort: 'none' } };
    const settings = parseSettings(config('custom', { thinkingOverride }));
    const exported = buildSettingsExport(settings, { includeApiKey: false, includeCustomHeaders: false });
    const restored = parseSettings(prepareSettingsImport(JSON.parse(JSON.stringify(exported))));
    expect(restored.modelParameters.thinkingOverride).toEqual(thinkingOverride);
    expect(providerAffectingChanged(initial, restored)).toBe(true);
    expect(await providerFingerprint(initial)).not.toBe(await providerFingerprint(restored));
  });

  it.each(['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', '__proto__', 'constructor'])('rejects reserved custom key %s', (key) => {
    const enabled = JSON.parse(`{"${key}":true}`);
    expect(() => prepareSettingsImport({ modelParameters: { thinkingOverride: { enabled, disabled: {} } } })).toThrow();
  });

  it('rejects nested prototype keys, arrays, oversized and malformed mappings', () => {
    for (const enabled of [[], JSON.parse('{"nested":{"__proto__":{}}}'), { padding: 'x'.repeat(5000) }]) {
      expect(modelParametersSchema.safeParse({ thinkingOverride: { enabled, disabled: {} } }).success).toBe(false);
    }
    expect(modelParametersSchema.safeParse({ thinkingOverride: { enabled: {} } }).success).toBe(false);
  });
});

describe('shared translation/probe behavior', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('blocks invalid off before any network call and returns a nonretryable configuration error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) } });
    const settings = parseSettings({ ...config('MiniMax-M3.1-Flash-Preview', { thinking: 'disabled' }), apiKey: 'test' });
    const probe = await testConnection(settings);
    expect(probe).toMatchObject({ ok: false, code: 'MODEL_PARAMETERS_INVALID', messageKey: 'thinkingCannotDisable' });
    const error = await translateTexts(['Hello'], settings).catch((err: unknown) => err);
    expect(toUserFacingError(error)).toMatchObject({ code: 'MODEL_PARAMETERS_INVALID', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses adaptive thinking and an adequate automatic floor in both entry points', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"0":"你好"}' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) } });
    const settings = parseSettings({ ...config('MiniMax-M3.1-Flash-Preview'), apiKey: 'test' });
    await testConnection(settings);
    await translateTexts(['Hello'], settings);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({ thinking: { type: 'adaptive' }, max_completion_tokens: 4096 });
    }
  });
});
