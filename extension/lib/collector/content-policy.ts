import { EDITABLE, NO_TEXT } from '../dom-const';
import { resolveContentPolicy, type SiteContentPolicy } from '../sites/policy';
import type { SiteProfile } from '../sites/types';
import type { SiteContentRule } from '../types';

// Ancestor-aware: <pre><code><span> and <button><span> are also protected.
const COMMON_IGNORE = [
  ...Array.from(NO_TEXT, tag => tag.toLowerCase()), EDITABLE,
  '[contenteditable="plaintext-only"]', '[translate="no" i]', '.notranslate',
  '.tap-translate-target', '.tap-translate-error', '#tap-translate-overlay-host',
].join(', ');
interface CompiledPolicy {
  content?: string;
  mode: SiteContentPolicy['content']['mode'];
  ignore: string;
  matches: WeakMap<Node, boolean>;
}
const documents = new WeakMap<Document, CompiledPolicy>();
const skeletons = new WeakSet<Node>();

/** Source exclusions have already been encoded as translate=no in this copy. */
export function registerContentSkeleton(root: Element): void {
  skeletons.add(root);
}

/** Installed once after restoring the prior session, never for draft previews. */
export function installContentPolicy(doc: Document, override?: SiteContentRule, profile?: SiteProfile | null): void {
  const policy = resolveContentPolicy(doc.location?.hostname ?? '', override, profile);
  documents.set(doc, {
    mode: policy.content.mode,
    content: policy.content.mode === 'selectors' ? policy.content.selectors.join(', ') : undefined,
    ignore: [COMMON_IGNORE, ...policy.ignore].join(', '),
    matches: new WeakMap(),
  });
}

function rulesFor(node: Node): CompiledPolicy {
  const doc = node.nodeType === 9 ? node as Document : node.ownerDocument!;
  if (!documents.has(doc)) installContentPolicy(doc);
  return documents.get(doc)!;
}

/** Recheck page layout once per collection, including incremental/SPA updates. */
export function refreshContentScope(node: Node): void {
  rulesFor(node).matches.delete(node.getRootNode());
}

function hasContentMatch(node: Node, rules: CompiledPolicy): boolean {
  // A mutation subtree without matches must not bypass a rule matched elsewhere
  // on the page. Shadow trees have their own selector scope, just like frames.
  const root = node.getRootNode() as Document | ShadowRoot | Element;
  let matches = rules.matches.get(root);
  if (matches === undefined) {
    matches = (root.nodeType === 1 && (root as Element).matches(rules.content!))
      || !!root.querySelector(rules.content!);
    rules.matches.set(root, matches);
  }
  return matches;
}

/** Additional candidates include nonstandard text hosts such as GitHub's bdi. */
export function siteContentSelector(node: Node): string | undefined {
  return rulesFor(node)?.content;
}

/** Explicit site prose takes precedence over generic sidebar/layout heuristics. */
export function siteContentRoot(el: Element): Element | null {
  const selector = siteContentSelector(el);
  return selector ? el.closest(selector) : null;
}

/** Candidate scope only. Do not use on disconnected rich-text skeletons. */
export function isContentCandidate(el: Element): boolean {
  const rules = rulesFor(el);
  return !isPreservedElement(el) && (rules.mode === 'generic'
    || (rules.mode === 'selectors' && (!hasContentMatch(el, rules) || !!el.closest(rules.content!))));
}

/** Shared source/skeleton text boundary; deliberately independent of content scope. */
export function isPreservedElement(el: Element): boolean {
  return !!el.closest(skeletons.has(el.getRootNode()) ? COMMON_IGNORE : rulesFor(el).ignore);
}

/** Even a plain span token needs rich slots to retain its position in a sentence. */
export function hasPreservedContent(el: Element): boolean {
  return !!el.querySelector(rulesFor(el)?.ignore ?? COMMON_IGNORE);
}
