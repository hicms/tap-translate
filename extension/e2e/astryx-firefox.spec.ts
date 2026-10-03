import { test, expect, firefox } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { artifactPath } from '../tools/artifact-paths.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@astryxdesign/core/Button';
import { installFirefoxUi } from './helpers/firefox-ui';

test('Firefox production UI uses bottom sheets when the anchor feature probe is unavailable', async () => {
  test.setTimeout(90_000);
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: { 'layout.css.at-scope.enabled': false },
  });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installFirefoxUi(page);
    // Firefox 155 removed the anchor preference. Exercise the older-browser
    // presentation branch in real Gecko by overriding only this feature probe.
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args: [string, string?]) =>
        args[0] === 'position-anchor'
          ? false
          : args.length === 1
            ? supports(args[0])
            : supports(args[0], args[1]!);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://tap-ui.test/onboarding.html');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page).toHaveTitle(/TapTranslate/);
    expect(await page.evaluate(() => CSS.supports('position-anchor', '--test'))).toBe(false);
    await page.locator('#providerPreset').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option', { name: /^DeepSeek/ }).click();
    await expect(page.locator('#model input')).toHaveValue('deepseek-v4-flash');
    await expect(page.getByRole('dialog')).toBeHidden();
    const optionsURL = new URL('options.html#section-reading', page.url()).href;
    await page.goto(optionsURL);
    await page.locator('#uiLocale').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('option', { name: 'French', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#targetLang').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y + box.height).toBeLessThanOrEqual(845);
    if (process.env.TAP_TRANSLATE_QA_DIR)
      await page.screenshot({
        path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'controls-firefox-sheet.png'),
        animations: 'disabled',
      });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#targetLang')).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test('Astryx production theme retains neutral colors and buttons without CSS scope support', async () => {
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: { 'layout.css.at-scope.enabled': false },
  });
  try {
    const page = await browser.newPage();
    const assets = artifactPath('extension', 'firefox-mv3', 'assets');
    const file = readdirSync(assets).find((name) => name.startsWith('connection-') && name.endsWith('.css'))!;
    const css = readFileSync(path.join(assets, file), 'utf8');
    expect(css).not.toContain('@scope');
    const button = renderToStaticMarkup(createElement(Button, { label: 'Save', variant: 'primary' }));
    await page.setContent(
      `<div data-astryx-theme="neutral"><div id="panel" style="background:var(--color-background-surface);color:var(--color-accent)">${button}</div></div>`,
    );
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
  } finally {
    await browser.close();
  }
});
