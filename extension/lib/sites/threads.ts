import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Public profile/permalink/replies checked in Chrome; see maintenance limits. */
export const threads: SiteProfile = {
  id: 'threads',
  hosts: ['threads.com', 'www.threads.com'],
  // The prose line-height marker distinguishes body from small author badges.
  // Do not broaden to every dir=auto span: dates and counters share that shape.
  content: ['[data-pressable-container="true"] span[dir="auto"][style*="1.4"]'],
  ignore: [...PROSE_CONTROLS, '[role="dialog"]', 'a', '[role="link"]', 'time', 'span:has(time)', 'header', 'nav'],
};
