import { test, expect, firefox } from '@playwright/test';
import { withExtension } from 'playwright-webextext';
import fs from 'node:fs';
import path from 'node:path';
import { artifactPath } from '../tools/artifact-paths.mjs';
import { startMockServer } from './helpers/mock-server';
import {
  FIREFOX_EXT_PATH,
  launchFirefoxGeckoContext,
  installFirefoxTapTranslate,
  firefoxTranslatePage,
  firefoxRestore,
  firefoxStopWatch,
  inspectTranslation,
} from './helpers/firefox-gecko';

const FIREFOX_EXT = artifactPath('extension', 'firefox-mv3');

/**
 * Firefox E2E:
 * 1) Temporary-addon load smoke via playwright-webextext (real gecko.id).
 * 2) Translate main path on Gecko via content harness — Playwright cannot drive
 *    moz-extension:// / Firefox MV3 service workers like Chromium.
 *    Harness loads built firefox-mv3 tap-translate.js (same artifact users ship).
 */

test.describe('firefox extension load', () => {
  test('builds output exists', () => {
    expect(fs.existsSync(path.join(FIREFOX_EXT, 'manifest.json'))).toBeTruthy();
    expect(fs.existsSync(path.join(FIREFOX_EXT, 'popup.html'))).toBeTruthy();
    expect(fs.existsSync(path.join(FIREFOX_EXT, 'tap-translate.js'))).toBeTruthy();
    const manifest = JSON.parse(fs.readFileSync(path.join(FIREFOX_EXT, 'manifest.json'), 'utf8'));
    expect(manifest.browser_specific_settings?.gecko?.id).toBe('{213b6ed4-24ad-44b0-aa70-9fbfc53dd8e1}');
    expect(FIREFOX_EXT_PATH).toBe(FIREFOX_EXT);
  });

  test('loads temporary addon and browses without crash', async () => {
    // launch() (not persistent) avoids a playwright-webextext bug when the MV3
    // manifest has neither content_scripts nor optional_permissions arrays.
    const browserType = withExtension(firefox, FIREFOX_EXT);
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('https://example.com/');
      await expect(page).toHaveTitle(/Example Domain/i);
    } finally {
      await browser.close();
    }
  });
});

test.describe('firefox translate main path (Gecko content harness)', () => {
  test('bilingual → restore leaves original DOM', async () => {
    const mock = await startMockServer();
    const fx = await launchFirefoxGeckoContext();
    try {
      const page = await fx.context.newPage();
      await page.goto(mock.fixtureUrl('article.html'), {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await expect(page.locator('#title')).toHaveText('Hello World');

      await installFirefoxTapTranslate(page);
      const result = await firefoxTranslatePage(page, 'bilingual');
      expect(result.success, JSON.stringify(result)).toBeTruthy();
      expect(Number(result.total) || Number(result.count) || 0).toBeGreaterThan(0);

      await expect
        .poll(async () => (await inspectTranslation(page)).targetCount, { timeout: 20_000 })
        .toBeGreaterThan(0);

      const after = await inspectTranslation(page);
      expect(after.doneCount).toBeGreaterThan(0);
      expect(after.targetSamples.some((t) => t.includes('译:'))).toBeTruthy();
      expect(after.editorText).toBe('Do not translate this editable text.');

      await firefoxRestore(page);
      await expect
        .poll(async () => (await inspectTranslation(page)).targetCount, { timeout: 10_000 })
        .toBe(0);

      const restored = await inspectTranslation(page);
      expect(restored.doneCount).toBe(0);
      expect(restored.titleText).toBe('Hello World');
      expect(restored.p1Text).toContain('first paragraph');
      expect(restored.editorText).toBe('Do not translate this editable text.');
    } finally {
      await fx.close();
      await mock.close();
    }
  });

  test('replace mode updates source text in place', async () => {
    const mock = await startMockServer();
    const fx = await launchFirefoxGeckoContext();
    try {
      const page = await fx.context.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      await installFirefoxTapTranslate(page);

      const result = await firefoxTranslatePage(page, 'replace');
      expect(result.success, JSON.stringify(result)).toBeTruthy();

      await expect
        .poll(async () => {
          const i = await inspectTranslation(page);
          return i.doneCount;
        }, { timeout: 20_000 })
        .toBeGreaterThan(0);

      const after = await inspectTranslation(page);
      expect(after.doneCount).toBeGreaterThan(0);
      expect(after.hideCount + after.replaceCount + after.targetCount).toBe(0);
      await expect(page.locator('#title')).toHaveText('译:Hello World');
      expect(after.editorText).toBe('Do not translate this editable text.');
      await firefoxStopWatch(page);
    } finally {
      await fx.close();
      await mock.close();
    }
  });

  test('API auth failure surfaces errors without mutating editable', async () => {
    const mock = await startMockServer();
    const fx = await launchFirefoxGeckoContext();
    try {
      const page = await fx.context.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      await installFirefoxTapTranslate(page, { batchMode: 'auth_fail' });

      const result = await firefoxTranslatePage(page, 'bilingual');
      // start() may still succeed (indexed); failures appear as error chrome.
      expect(String(result.error || ''), JSON.stringify(result)).not.toMatch(/timed out/i);

      await expect
        .poll(async () => (await inspectTranslation(page)).errorCount, { timeout: 45_000 })
        .toBeGreaterThan(0);

      const after = await inspectTranslation(page);
      expect(after.editorText).toBe('Do not translate this editable text.');
      expect(after.targetSamples.every((t) => !t.includes('译:'))).toBeTruthy();
      await firefoxStopWatch(page);
    } finally {
      await fx.close();
      await mock.close();
    }
  });
});
