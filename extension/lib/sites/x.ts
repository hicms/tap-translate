import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Public profile, status and replies checked in Chrome; see docs/SITE-ADAPTERS.md. */
export const x: SiteProfile = {
  id: 'x',
  hosts: ['x.com', 'www.x.com'],
  content: ['article[data-testid="tweet"] [data-testid="tweetText"]', 'main [data-testid="UserDescription"]'],
  ignore: [
    ...PROSE_CONTROLS,
    // Tweet links represent mentions, hashtags or shortened URLs.
    '[data-testid="tweetText"] a', '[data-testid="UserDescription"] a',
    '[data-testid="tweet-text-show-more-link"]',
  ],
};
