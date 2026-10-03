import type { SiteContentRule } from '../types';
import { resolveSiteProfile } from './index';
import type { SiteProfile } from './types';

export interface SiteContentPolicy {
  readonly content: { readonly mode: 'generic' } | { readonly mode: 'none' } | { readonly mode: 'selectors'; readonly selectors: readonly string[] };
  readonly ignore: readonly string[];
}

/** Exact hostname and field replacement are owned here, shared by UI and DOM policy. */
export function resolveContentPolicy(
  hostname: string,
  override?: SiteContentRule,
  profile: SiteProfile | undefined = resolveSiteProfile(hostname),
): SiteContentPolicy {
  const own = override?.host === hostname.toLowerCase() ? override : undefined;
  const content = own?.content ?? profile?.content;
  return Object.freeze({
    content: content === undefined ? { mode: 'generic' as const }
      : content.length === 0 ? { mode: 'none' as const }
        : { mode: 'selectors' as const, selectors: Object.freeze([...content]) },
    ignore: Object.freeze([...(own?.ignore ?? profile?.ignore ?? [])]),
  });
}
