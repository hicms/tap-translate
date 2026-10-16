import { A11Y, CLS_BLOCK, CLS_ERR, CLS_REPLACE, DONE, EDITABLE, HIDE, NO_TEXT, OURS_SEL, P } from './dom-const';

/** Ignore renderer writes, controls and already-owned text when checking reveals. */
export function isPageVisibilityTarget(el: Element): boolean {
  return el.isConnected && !NO_TEXT.has(el.tagName)
    && !el.closest(`${OURS_SEL}, ${EDITABLE}, [${DONE}]`);
}

const OWN_CLASSES = [
  CLS_BLOCK, `${P}-nav-sub`, `${P}-target--inline`, `${P}-target--inner`,
  `${P}-target--compact`, CLS_ERR, HIDE, CLS_REPLACE,
];

/** Extension-owned elements never become source content. */
export function isOursElement(el: Element | null): boolean {
  if (!el?.classList) return false;
  return OWN_CLASSES.some(cls => el.classList.contains(cls));
}

/** Shared source pruning for collection and safe rich-text reconstruction. */
export function isA11yHidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.classList?.contains('not-sr-only')) return false;
    if (A11Y.some(c => n!.classList?.contains(c))) return true;
  }
  return false;
}

/** Complete emoji alt only; never reinterpret a photo description or digits. */
export function inlineEmojiAlt(el: Element): string | null {
  if (el.tagName !== 'IMG') return null;
  const alt = el.getAttribute('alt') ?? '';
  if (!alt || alt.length > 32) return null;
  const symbol = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;
  const sequence = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|[\u{E0020}-\u{E007F}]|[0-9#*]\uFE0F?\u20E3)+$/u;
  return symbol.test(alt) && sequence.test(alt) ? alt : null;
}
