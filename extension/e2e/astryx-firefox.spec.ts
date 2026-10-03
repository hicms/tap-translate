import { test, expect, firefox } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { artifactPath } from '../tools/artifact-paths.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@astryxdesign/core/Button';

test('Astryx production theme retains neutral colors and buttons without CSS scope support', async () => {
  const browser = await firefox.launch({ headless: true, firefoxUserPrefs: { 'layout.css.at-scope.enabled': false } });
  try {
    const page = await browser.newPage();
    const assets = artifactPath('extension', 'firefox-mv3', 'assets');
    const file = readdirSync(assets).find(name => name.startsWith('connection-') && name.endsWith('.css'))!;
    const css = readFileSync(path.join(assets, file), 'utf8');
    expect(css).not.toContain('@scope');
    const button = renderToStaticMarkup(createElement(Button, { label: 'Save', variant: 'primary' }));
    await page.setContent(`<div data-astryx-theme="neutral"><div id="panel" style="background:var(--color-background-surface);color:var(--color-accent)">${button}</div></div>`);
    await page.addStyleTag({ content: css });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await page.evaluate(() => 'CSSScopeRule' in window)).toBe(false);
    const panel = page.locator('#panel');
    await expect(panel).toHaveCSS('color', 'rgb(27, 27, 27)');
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('button')).toHaveCSS('background-color', 'rgb(27, 27, 27)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(panel).toHaveCSS('color', 'rgb(241, 241, 241)');
    await expect(panel).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  } finally { await browser.close(); }
});
