import os from 'node:os';
import path from 'node:path';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { seedSettings } from './helpers/ext-control';
import { MockGitHub } from '../tests/helpers/mock-github';
import type { BrowserContext, Page } from '@playwright/test';
import { settingsTab } from './helpers/options-ui';

test.use({ testHostPermissions: ['https://api.github.com/*', 'https://gist.githubusercontent.com/*'] });

async function routeGitHub(context: BrowserContext, mock: MockGitHub) {
  await context.route(/^https:\/\/(api\.github\.com|gist\.githubusercontent\.com)\//, async route => {
    const request = route.request();
    try {
      const response = await mock.fetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    } catch { await route.abort('failed'); }
  });
}
async function connect(page: Page) {
  await page.locator('#gistConnectBtn').click();
  await page.locator('#gistToken input').fill('ghp-test-only-never-real');
  await page.locator('#gistPassword input').fill('test password for backup');
  await page.locator('#gistConnectConfirm').click();
  await expect(page.locator('#gistBackupBtn')).toBeEnabled();
}
async function backup(page: Page) {
  await page.locator('#gistBackupBtn').click();
  const confirm = page.locator('#gistPasswordConfirm input');
  if (await confirm.count()) await confirm.fill('test password for backup');
  await page.locator('#gistDeviceLabel input').fill('QA Laptop');
  await page.locator('#gistConfirmDialog button[value="confirm"]').click();
}

test('Gist encrypts, previews, restores, undoes and resumes after refresh', async ({ extContext, extensionId }) => {
  const mock = new MockGitHub();
  await routeGitHub(extContext, mock);
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.deepseek.com', uiLocale: 'en', targetLang: 'en', apiKey: 'provider-secret-for-test' });
  const page = await extContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`chrome-extension://${extensionId}/options.html#section-data`);
  await expect(page).toHaveTitle(/TapTranslate/);
  await expect(page.locator('#section-data')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await connect(page);
  expect(mock.gists.size).toBe(0);
  await backup(page);
  await expect(page.locator('#saveStatus')).toContainText('uploaded and verified');
  await expect(page.locator('#gistRestoreBtn')).toBeEnabled();
  expect(mock.gists.size).toBe(1);
  const posted = mock.calls.find(call => call.init?.method === 'POST')!;
  expect(String(posted.init?.body)).not.toContain('provider-secret-for-test');
  expect(String(posted.init?.body)).not.toContain('test password for backup');
  expect(JSON.stringify(await page.evaluate(() => chrome.storage.local.get('tapTranslateGist')))).not.toContain('ghp-test');

  await settingsTab(page, 'connection');
  await page.locator('#model input').fill('updated-model');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await settingsTab(page, 'data');
  await expect(page.locator('#gistStatus')).toContainText('differs');
  await page.evaluate(() => chrome.storage.sync.set({ targetLang: 'fr' }));
  await page.locator('#gistRestoreBtn').click();
  await expect(page.locator('#importPreviewDialog')).toContainText('QA Laptop');
  await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-gist-preview.png'), animations: 'disabled' });
  await page.locator('#importPreviewDialog button[value="confirm"]').click();
  await expect(page.locator('#importPreviewDialog')).toBeHidden();
  expect(await page.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('en');
  await page.locator('#undoRestoreBtn').click();
  await expect(page.locator('#importPreviewDialog')).toContainText('changes made since');
  await page.locator('#importPreviewDialog button[value="confirm"]').click();
  await expect(page.locator('#importPreviewDialog')).toBeHidden();
  expect(await page.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('fr');
  expect(await page.evaluate(async () => (await chrome.storage.local.get('builtinSiteProfiles')).builtinSiteProfiles)).toBeNull();
  await expect(page.locator('#undoRestoreBtn')).toHaveCount(0);
  await backup(page);
  await expect.poll(() => mock.gists.size).toBe(2);
  await expect(page.locator('#gistCheckBtn')).toBeEnabled();
  await page.locator('#gistHistoryBtn').click();
  await expect(page.locator('#gistHistory > ul > li')).toHaveCount(2);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#gistPanel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-gist-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-gist-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { AxeBuilder } = await import('@axe-core/playwright');
  expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-gist-dark.png') });
  expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.reload();
  await expect(page.locator('#gistBackupBtn')).toBeEnabled();
  await expect(page.locator('#gistConnectBtn')).toHaveCount(0);
  await expect(page.locator('#gistToken')).toHaveCount(0);
  await expect(page.locator('#undoRestoreBtn')).toHaveCount(0);
  await expect(page.locator('#gistSelected')).toContainText('QA Laptop');
  await expect(page.locator('#gistRestoreBtn')).toBeEnabled();
  await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-gist-resumed.png') });
  await page.locator('#gistDisconnectBtn').click();
  await page.locator('#gistConfirmDialog button[value="confirm"]').click();
  await expect(page.locator('#gistConnectBtn')).toBeVisible();
  expect(await page.evaluate(() => chrome.storage.session.get('tapTranslateGistSession'))).toEqual({});
  await page.reload();
  await expect(page.locator('#gistConnectBtn')).toBeEnabled();
  expect(mock.gists.size).toBe(2);
  expect(errors).toEqual([]);
});

test('Gist lost responses reconcile without duplicate uploads and stale previews refuse restore', async ({ extContext, extensionId }) => {
  const mock = new MockGitHub();
  await routeGitHub(extContext, mock);
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.deepseek.com', uiLocale: 'en', targetLang: 'en' });
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#section-data`);
  await connect(page);
  mock.loseCreateResponse = true;
  await backup(page);
  await expect(page.locator('#gistError')).toContainText('unknown');
  await expect(page.locator('#gistReconcileBtn')).toBeEnabled();
  await page.locator('#gistReconcileBtn').click();
  await expect(page.locator('#saveStatus')).toContainText('uploaded and verified');
  await expect(page.locator('#gistReconcileBtn')).toHaveCount(0);
  expect(mock.gists.size).toBe(1);
  await page.locator('#gistRestoreBtn').click();
  await expect(page.locator('#importPreviewDialog')).toBeVisible();
  await page.evaluate(() => chrome.storage.sync.set({ targetLang: 'fr' }));
  await page.locator('#importPreviewDialog button[value="confirm"]').click();
  await expect(page.locator('#saveStatus')).toContainText('Saved data changed');
  expect(await page.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('fr');
  await page.locator('#importPreviewDialog button[value="cancel"]').click();
  mock.gists.clear();
  await page.locator('#gistCheckBtn').click();
  await expect(page.locator('#gistError')).toContainText('could not be found');
  await expect(page.locator('#gistRestoreBtn')).toBeDisabled();
});

test('Gist resumes in a reopened settings page and clears expired credentials', async ({ extContext, extensionId }) => {
  const mock = new MockGitHub();
  await routeGitHub(extContext, mock);
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.deepseek.com', uiLocale: 'en', targetLang: 'en' });
  const url = `chrome-extension://${extensionId}/options.html#section-data`;
  const first = await extContext.newPage();
  await first.goto(url);
  await connect(first);
  await first.close();
  const page = await extContext.newPage();
  await page.goto(url);
  await expect(page.locator('#gistBackupBtn')).toBeEnabled();
  await expect(page.locator('#gistStatus')).toContainText('No Gist backups');
  await expect(page.locator('#gistToken')).toHaveCount(0);
  expect(mock.gists.size).toBe(0);

  // Ending browser-session memory requires an explicit connection again.
  await page.evaluate(() => chrome.storage.session.remove('tapTranslateGistSession'));
  await page.reload();
  await expect(page.locator('#gistConnectBtn')).toBeEnabled();
  await connect(page);
  mock.nextStatus = 401;
  await page.reload();
  await expect(page.locator('#gistError')).toContainText('invalid, or expired');
  await expect(page.locator('#gistConnectBtn')).toBeEnabled();
  expect(await page.evaluate(() => chrome.storage.session.get('tapTranslateGistSession'))).toEqual({});
  await connect(page);
  expect(mock.gists.size).toBe(0);
});
