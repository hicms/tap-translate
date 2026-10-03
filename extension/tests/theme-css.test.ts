import { expect, it } from 'vitest';
import postcss from 'postcss';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { astryxThemeCompatibility } from '../tools/astryx-theme';

it('makes every prebuilt neutral rule usable without scope while retaining its theme boundary', async () => {
  const themeCSS = readFileSync(createRequire(import.meta.url).resolve('@astryxdesign/theme-neutral/theme.css'), 'utf8');
  const result = await postcss([astryxThemeCompatibility()]).process(themeCSS, { from: undefined });
  expect(result.css).not.toContain('@scope');
  expect(result.css).not.toContain(':scope');
  const original = postcss.parse(themeCSS);
  const scopes: string[] = [];
  original.walkAtRules('scope', scope => scope.walkRules(rule => { scopes.push(...rule.selectors); }));
  expect(scopes.length).toBeGreaterThan(40);
  const selectors: string[] = [];
  result.root.walkRules(rule => { selectors.push(...rule.selectors); });
  for (const selector of scopes) {
    const expected = selector.includes(':scope') ? selector.replaceAll(':scope', '[data-astryx-theme="neutral"]') : `[data-astryx-theme="neutral"] ${selector}`;
    expect(selectors).toContain(expected);
  }
});
