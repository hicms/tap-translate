import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Public Meta post/replies checked in Chrome; no generated class names. */
export const facebook: SiteProfile = {
  id: 'facebook',
  hosts: ['facebook.com', 'www.facebook.com'],
  content: [
    '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]',
    // Comment author/date/action text has no language-marked prose container.
    '[role="article"] span[dir="auto"][lang]',
  ],
  ignore: [...PROSE_CONTROLS, 'a[role="link"]', 'h1', 'h2', 'h3', 'time', 'span:has(time)'],
};
