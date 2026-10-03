import { z } from 'zod';
import { normalizeSiteHost } from '../settings/site-host';
import { resolveContentPolicy } from './policy';
import { normalizeSiteContentRules, SITE_CONTENT_LIMITS } from './validation';

const selectors = z.array(z.string().max(SITE_CONTENT_LIMITS.selectorLength)).max(SITE_CONTENT_LIMITS.selectors);
export const contentCheckRequestSchema = z.object({
  action: z.literal('checkSiteContent'),
  rule: z.object({ host: z.string().min(1).max(253), content: selectors.optional(), ignore: selectors.optional() }).strict(),
}).strict();
const counts = z.array(z.object({ selector: z.string().max(SITE_CONTENT_LIMITS.selectorLength), count: z.number().int().nonnegative() }).strict()).max(SITE_CONTENT_LIMITS.selectors);
export const contentCheckResultSchema = z.object({
  host: z.string().min(1).max(253),
  mode: z.enum(['generic', 'none', 'selectors']),
  content: counts,
  ignore: counts,
}).strict();
export type ContentCheckResult = z.infer<typeof contentCheckResultSchema>;
export type ContentCheckRequest = z.infer<typeof contentCheckRequestSchema>;

/** Counts elements only. No policy installation, text reads, or DOM writes. */
export function checkSiteContent(raw: unknown, doc: Document): ContentCheckResult {
  const { rule } = contentCheckRequestSchema.parse(raw);
  if (normalizeSiteHost(rule.host) !== doc.location.hostname) throw new Error('CHECK_HOST_MISMATCH');
  if (!['https:', 'http:'].includes(doc.location.protocol)) throw new Error('CHECK_UNSUPPORTED');
  const normalized = normalizeSiteContentRules([rule], doc)[0] ?? { host: normalizeSiteHost(rule.host) };
  const policy = resolveContentPolicy(normalized.host, normalized);
  const count = (list: readonly string[]) => list.map(selector => ({ selector, count: doc.querySelectorAll(selector).length }));
  return {
    host: doc.location.hostname, mode: policy.content.mode,
    content: count(policy.content.mode === 'selectors' ? policy.content.selectors : []),
    ignore: count(policy.ignore),
  };
}
