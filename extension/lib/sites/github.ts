import type { SiteProfile } from './types';

/** Public DOM checked in Chrome on 2026-10-03. See docs/SITE-ADAPTERS.md. */
export const github: SiteProfile = {
  id: 'github',
  hosts: ['github.com'],
  content: [
    // README, rendered Markdown files, issue/PR bodies & comments, releases, wiki.
    'main .markdown-body',
    // Own the heading so the companion appears below title + number together.
    // The leaf selectors also support indexing an updated title subtree.
    'main h1:has(> .markdown-title)',
    'main [data-testid="issue-title"]',
    'main .markdown-title',
    // Current issue/PR lists. Do not select the row: it also owns labels/authors.
    'main [data-testid="issue-listitem-title-link"]',
    'main a[data-testid="listitem-title-link"][data-hovercard-type="pull_request"]',
    // These components have no stable semantic attribute; match the module name,
    // never the generated CSS suffix. Keep these two fallbacks localized here.
    'main a[class*="PinnedIssueCard-module__Link__"]',
    'main p[class*="SidebarAbout-module__description__"]',
    'main [data-testid="mobile-description"]',
  ],
  ignore: [
    'relative-time',
    // Title siblings (issue number, badges) retain their exact position/spelling.
    'main h1 > .markdown-title ~ *',
    // Draft previews can also be markdown-body; they are part of the editor.
    '[data-testid="comment-composer"]',
    '.js-preview-body',
    '.wiki-custom-sidebar',
    'form',
    '[role="textbox"]',
    '[role="toolbar"]',
    '[role="menu"]',
    // Identifiers embedded in prose keep their exact spelling and link target.
    '.user-mention',
    '.team-mention',
    '.issue-link',
    '.commit-link',
    'a[data-hovercard-type="user"]',
    'a[data-hovercard-type="team"]',
    'a[data-hovercard-type="commit"]',
  ],
};
