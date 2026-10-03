import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Public permalink checked in Chrome. Metadata and body are separate siblings. */
export const instagram: SiteProfile = {
  id: 'instagram',
  hosts: ['instagram.com', 'www.instagram.com'],
  content: [
    'main div:has(> div time) > span[style*="line-height"]',
    'main div:has(> div time) > div > span[dir="auto"][style*="--x-lineHeight"]',
  ],
  // Caption/comment links are handles or hashtags. Profile bio is a control.
  // A caption can share an outer span with its timestamp: exclude time itself,
  // never span:has(time), which would also protect all of that caption's prose.
  ignore: [...PROSE_CONTROLS, '[role="dialog"]', 'a', 'time'],
};
