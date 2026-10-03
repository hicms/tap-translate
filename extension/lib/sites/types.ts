/** Built-in DOM rules, independent of the user's per-site language/mode settings. */
export interface SiteProfile {
  readonly id: string;
  /** Exact hostnames. Subdomains and enterprise installations are opt-in. */
  readonly hosts: readonly string[];
  /** Prose containers or standalone titles; unmatched areas stay original. */
  readonly content: readonly string[];
  /** Subtrees/tokens to keep original, including inside content. Exclusion wins. */
  readonly ignore: readonly string[];
}
