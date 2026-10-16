import { inlineEmojiAlt } from '../dom-guards';
import { hasPreservedContent, isPreservedElement } from './content-policy';

const MARKUP = 'a[href], code, kbd, var, samp, strong, b, em, i, mark, sup, sub, abbr, cite, q';
const BLOCKING = 'button, label, summary, input, select, textarea, img, video, audio, iframe';

function hasSeparateLayoutLabels(host: Element): boolean {
  if (host.children.length < 2) return false;
  const display = getComputedStyle(host).display;
  if (!['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display)) return false;
  // Plain spans can be independent badges or metadata fields. Flattening them
  // moves all translated text into the first item and empties every later one.
  return Array.from(host.children).filter(child => child.textContent?.trim()).length > 1;
}

/** Rich slots retain inline token positions even next to controls or media. */
export function needsRichSlots(host: Element): boolean {
  // A preserved link/token can contain only an emoji image, with no textContent.
  // It still separates source slots; retention must not remove that boundary.
  const hasEmoji = Array.from(host.querySelectorAll('img')).some(el => inlineEmojiAlt(el) !== null);
  if (!hasEmoji && !host.querySelector(MARKUP) && !hasPreservedContent(host)
    && !hasSeparateLayoutLabels(host)) return false;
  if (!host.querySelector(BLOCKING) || hasEmoji) return true;
  // Preserve code/handles/opt-out tokens while the safe skeleton drops controls.
  return Array.from(host.querySelectorAll('*')).some(el =>
    !el.closest(BLOCKING) && isPreservedElement(el) && !!el.textContent?.trim(),
  );
}
