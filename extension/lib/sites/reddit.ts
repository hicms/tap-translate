import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Current Shreddit light-DOM slots, checked on public feed and comments pages. */
export const reddit: SiteProfile = {
  id: 'reddit',
  hosts: ['reddit.com', 'www.reddit.com'],
  content: [
    'shreddit-post [slot="title"]', 'shreddit-post [slot="text-body"]',
    'shreddit-comment [slot="comment"]',
  ],
  ignore: [
    ...PROSE_CONTROLS, 'shreddit-post[promoted]', 'shreddit-ad-post',
    'shreddit-post-flair', '[slot="post-flair"]', '[slot="authorName"]',
    '[slot="commentMeta"]', '[slot="actionRow"]',
    // Feed cards wrap their body in a post permalink as well as their title.
    'a[href^="/user/"]', 'a[href^="/u/"]', 'a[href^="/r/"]:not([slot="title"]):not([slot="text-body"])',
  ],
};
