import type { SiteContentRule } from '../types';
import { normalizeSiteHost } from '../settings/site-host';

export const SITE_CONTENT_LIMITS = { hosts: 200, selectors: 100, selectorLength: 2048, bytes: 256 * 1024 } as const;
export type SelectorField = 'content' | 'ignore';

export class SiteContentValidationError extends Error {
  constructor(readonly code: 'syntax' | 'limit' | 'shape', readonly field?: SelectorField, readonly line?: number) {
    super(`siteContentRules: ${code}${field ? ` (${field}, line ${line ?? 1})` : ''}`);
    this.name = 'SiteContentValidationError';
  }
}

/** Uses the native parser without querying or modifying the user's page. */
export function normalizeSelectors(raw: unknown, field: SelectorField, doc?: Document | null): string[] {
  if (!Array.isArray(raw) || raw.some(s => typeof s !== 'string')) throw new SiteContentValidationError('shape', field);
  if (raw.length > SITE_CONTENT_LIMITS.selectors) throw new SiteContentValidationError('limit', field);
  const out: string[] = [];
  const parser = doc?.createDocumentFragment();
  raw.forEach((value: string, index) => {
    const selector = value.trim();
    if (!selector) return;
    if (selector.length > SITE_CONTENT_LIMITS.selectorLength) throw new SiteContentValidationError('limit', field, index + 1);
    try { parser?.querySelector(selector); }
    catch { throw new SiteContentValidationError('syntax', field, index + 1); }
    if (!out.includes(selector)) out.push(selector);
  });
  return out;
}

/** Storage/service-worker validation is structural; DOM callers also validate CSS. */
export function normalizeSiteContentRules(raw: unknown, doc: Document | null | undefined = typeof document === 'undefined' ? undefined : document): SiteContentRule[] {
  if (!Array.isArray(raw)) throw new SiteContentValidationError('shape');
  if (raw.length > SITE_CONTENT_LIMITS.hosts || new TextEncoder().encode(JSON.stringify(raw)).length > SITE_CONTENT_LIMITS.bytes) {
    throw new SiteContentValidationError('limit');
  }
  const seen = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SiteContentValidationError('shape');
    const host = normalizeSiteHost(value.host);
    if (seen.has(host)) throw new SiteContentValidationError('shape');
    seen.add(host);
    return {
      host,
      ...(value.content !== undefined ? { content: normalizeSelectors(value.content, 'content', doc) } : {}),
      ...(value.ignore !== undefined ? { ignore: normalizeSelectors(value.ignore, 'ignore', doc) } : {}),
    };
  }).filter(rule => rule.content !== undefined || rule.ignore !== undefined);
}
