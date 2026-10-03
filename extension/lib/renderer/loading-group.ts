import { collectVisibleTextNodes } from '../collector';
import type { TranslationUnit } from '../types';

const TITLES = 'h1, h2, h3, h4, h5, h6, [role="heading"], [slot="title"]';
const DESCRIPTIONS = '[slot="text-body"], [property~="schema:articleBody"], [itemprop~="description"]';
const PARAGRAPHS = 'p, li, blockquote, td, th, dd, dt, figcaption, caption';

/** Display boundaries only; collection and request batching still own units. */
export function loadingGroupHost(unit: TranslationUnit): HTMLElement {
  if (unit.kind === 'nav') return unit.el;
  return unit.el.closest<HTMLElement>(TITLES)
    ?? unit.el.closest<HTMLElement>(DESCRIPTIONS)
    ?? unit.el.closest<HTMLElement>(PARAGRAPHS)
    ?? unit.el;
}

export function loadingGroupTail(host: HTMLElement): Text | null {
  const nodes = collectVisibleTextNodes(host);
  // A body may contain a heading which has its own independent indicator.
  return nodes.filter(node => {
    const title = node.parentElement?.closest(TITLES);
    return !title || title === host;
  }).at(-1) ?? null;
}
