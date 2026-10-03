import type { SiteProfile } from './types';
import { PROSE_CONTROLS } from './prose-controls';

/** Public watch/channel titles, description and comments checked in Chrome. */
export const youtube: SiteProfile = {
  id: 'youtube',
  hosts: ['youtube.com', 'www.youtube.com'],
  content: [
    'ytd-watch-metadata h1',
    '#description-inline-expander #expanded > yt-attributed-string',
    '#description-inline-expander #attributed-snippet-text',
    'ytd-comment-view-model #content-text',
    'a.ytLockupMetadataViewModelTitle',
    'ytd-video-renderer #video-title', 'ytd-grid-video-renderer #video-title',
    'ytd-channel-video-player-renderer #video-title',
  ],
  ignore: [...PROSE_CONTROLS, '#description-inline-expander a', '#content-text a', 'time'],
};
