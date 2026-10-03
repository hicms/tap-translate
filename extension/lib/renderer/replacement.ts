/** In-place replacement: retain page-owned elements AND Text node identities. */
interface SavedText {
  original: string;
  translated: string;
}

interface ReplacementState {
  hosts: WeakMap<HTMLElement, Map<Text, SavedText>>;
  writes: WeakMap<Text, string>;
}

// Content scripts can be reinjected while translated DOM is still live. Like
// the session holder, restoration state must survive module re-evaluation.
const STATE_KEY = '__TAP_TRANSLATE_TEXT_REPLACEMENTS__';

function state(): ReplacementState {
  const global = globalThis as typeof globalThis & { [STATE_KEY]?: ReplacementState };
  return global[STATE_KEY] ??= { hosts: new WeakMap(), writes: new WeakMap() };
}

function writeText(node: Text, value: string): void {
  state().writes.set(node, value);
  if (node.nodeValue !== value) node.nodeValue = value;
}

/** Compare the current value too: a subsequent site edit must not be ignored. */
export function isReplacementWrite(node: Text): boolean {
  return state().writes.get(node) === node.nodeValue;
}

export function replaceTextNodes(host: HTMLElement, replacements: ReadonlyArray<[Text, string]>): void {
  const saved = state().hosts.get(host) ?? new Map<Text, SavedText>();
  state().hosts.set(host, saved);
  for (const [node, translated] of replacements) {
    const previous = saved.get(node);
    const current = node.nodeValue ?? '';
    saved.set(node, {
      original: previous && current === previous.translated ? previous.original : current,
      translated,
    });
    writeText(node, translated);
  }
}

/** Restore only our own surviving text; retain any newer application content. */
export function restoreReplacedText(host: HTMLElement): boolean {
  const saved = state().hosts.get(host);
  if (!saved) return false;
  for (const [node, value] of saved) {
    if (host.contains(node) && node.nodeValue === value.translated) {
      writeText(node, value.original);
    }
  }
  state().hosts.delete(host);
  return true;
}
