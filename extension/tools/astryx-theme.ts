import type { Plugin } from 'postcss';

/**
 * Astryx's prebuilt neutral theme uses @scope (Firefox 146+), while the
 * extension supports Firefox 140. We have one theme per page/shadow root and
 * no differently themed subtrees, so ordinary descendant selectors preserve
 * the theme boundary without requiring @scope or a runtime polyfill.
 * This deliberately handles only the pinned neutral theme, not general scopes.
 */
export function astryxThemeCompatibility(): Plugin {
  const theme = '[data-astryx-theme="neutral"]';
  return {
    postcssPlugin: 'tap-translate-astryx-theme',
    AtRule: {
      scope(scope) {
        if (scope.params !== `(${theme}) to ([data-astryx-theme])`) return;
        scope.walkRules(rule => {
          rule.selectors = rule.selectors.map(selector => selector.includes(':scope')
            ? selector.replaceAll(':scope', theme)
            : `${theme} ${selector}`);
        });
        scope.replaceWith(...scope.nodes!);
      },
    },
  };
}
