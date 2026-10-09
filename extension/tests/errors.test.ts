import { describe, expect, it } from 'vitest';
import {
  TapTranslateError,
  classifyHttpStatus,
  isAbortError,
  sanitizeDetail,
  toUserFacingError,
  userFacing,
} from '../lib/errors';

describe('sanitizeDetail', () => {
  it('redacts key-like tokens and truncates', () => {
    const s = sanitizeDetail(`Bearer sk-abcdefghijklmnopqrstuvwxyz HTTP 401 ${'x'.repeat(200)}`, 80);
    expect(s).toBeDefined();
    expect(s!).not.toMatch(/sk-abcdefgh/);
    expect(s!).toMatch(/Bearer/);
    expect(s!.length).toBeLessThanOrEqual(80);
  });
});

describe('classifyHttpStatus', () => {
  it('maps common upstream statuses', () => {
    expect(classifyHttpStatus(401)).toBe('AUTH_INVALID');
    expect(classifyHttpStatus(403)).toBe('AUTH_INVALID');
    expect(classifyHttpStatus(429)).toBe('RATE_LIMITED');
    expect(classifyHttpStatus(500)).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyHttpStatus(504)).toBe('UPSTREAM_TIMEOUT');
  });

  it('distinguishes model-missing 404 from wrong-path 404', () => {
    expect(classifyHttpStatus(404, '{"error":"model not found"}')).toBe('MODEL_NOT_FOUND');
    // Bare 404 is usually a wrong apiBase path — not a missing model.
    expect(classifyHttpStatus(404)).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyHttpStatus(404, 'Not Found')).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('toUserFacingError', () => {
  it.each([
    new Error('Extension context invalidated.'),
    'Extension context invalidated.',
    new TapTranslateError('UPSTREAM_UNAVAILABLE', { detail: 'Extension context invalidated.' }),
  ])('treats an invalid extension context as cancellation: %s', err => {
    expect(toUserFacingError(err)).toMatchObject({ code: 'SESSION_CANCELLED', retryable: false });
  });

  it('keeps ordinary port disconnections retryable', () => {
    expect(toUserFacingError(new Error('translation port disconnected')))
      .toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: true });
  });

  it('preserves TapTranslateError codes', () => {
    const err = new TapTranslateError('AUTH_INVALID', { detail: 'HTTP 401' });
    const uf = toUserFacingError(err);
    expect(uf.code).toBe('AUTH_INVALID');
    expect(uf.messageKey).toBe('errAuthInvalid');
    expect(uf.retryable).toBe(false);
    expect(uf.actionKey).toBe('errActionCheckKey');
  });

  it('classifies legacy HTTP strings', () => {
    const uf = toUserFacingError(new Error('HTTP 429: rate limit exceeded'));
    expect(uf.code).toBe('RATE_LIMITED');
    expect(uf.detail).toBe('HTTP 429');
    expect(uf.retryable).toBe(true);
  });

  it('maps abort to SESSION_CANCELLED', () => {
    const uf = toUserFacingError(new DOMException('Aborted', 'AbortError'));
    expect(uf.code).toBe('SESSION_CANCELLED');
    expect(uf.retryable).toBe(false);
  });

  it.each([
    new Error('network connection aborted'),
    new TapTranslateError('NETWORK_ERROR', { detail: 'The operation was aborted.' }),
    new TapTranslateError('UPSTREAM_TIMEOUT', { detail: 'request aborted after timeout' }),
  ])('does not swallow upstream failures mentioning abort: %s', err => {
    expect(isAbortError(err)).toBe(false);
    expect(toUserFacingError(err).retryable).toBe(true);
    expect(toUserFacingError(err).code).not.toBe('SESSION_CANCELLED');
  });
});

describe('userFacing', () => {
  it('builds catalog keys for page codes', () => {
    expect(userFacing('PAGE_RESTRICTED').messageKey).toBe('errPageRestricted');
    expect(userFacing('PAGE_UNSUPPORTED').messageKey).toBe('errPageUnsupported');
  });
});
