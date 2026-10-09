import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import { getTabId, translateTab, seedSettings } from './helpers/ext-control';

test('full backup download, preview and restore preserves credentials, rules, cache and setup', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, apiKey: 'backup-test-key', uiLocale: 'en', targetLang: 'en' });
    const cacheKey = `dr:c3:${'a'.repeat(64)}`;
    await sw.evaluate(async key => {
      await chrome.storage.local.set({
        builtinSiteProfiles: [{ id: 'snapshot', hosts: ['127.0.0.1'], content: ['#p1'], ignore: ['.old-ignore'] }],
        siteContentRules: [{ host: '127.0.0.1', ignore: [] }],
        tapTranslateOnboarding: { completed: true, completedAt: 12345, path: 'direct' },
        [key]: { t: 'Saved translation', at: Date.now(), b: 17 },
      });
    }, cacheKey);
    const page = await extContext.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${extensionId}/options.html#section-data`);
    await expect(page).toHaveTitle(/TapTranslate/);
    await expect(page.locator('#section-data')).toBeVisible();
    await page.locator('#fullBackupBtn').click();
    await expect(page.locator('#dataConfirmDialog')).toContainText('unencrypted');
    await page.locator('#dataConfirmDialog button[value="cancel"]').click();
    await page.locator('#fullBackupBtn').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#dataConfirmDialog button[value="confirm"]').click();
    const download = await downloadEvent;
    const serialized = await readFile((await download.path())!, 'utf8');
    const backup = JSON.parse(serialized);
    expect(backup.settings.providers[0].apiKey).toBe('backup-test-key');
    expect(backup.cache[cacheKey].t).toBe('Saved translation');
    expect(backup.settings.builtinSiteProfiles[0].hosts).toEqual(['127.0.0.1']);

    await page.evaluate(async key => {
      await chrome.storage.sync.set({ targetLang: 'fr', siteRules: [] });
      await chrome.storage.local.set({ builtinSiteProfiles: null, siteContentRules: [], tapTranslateOnboarding: { completed: false } });
      await chrome.storage.local.remove(key);
    }, cacheKey);
    await page.reload();
    const file = { name: 'full-backup.json', mimeType: 'application/json', buffer: Buffer.from(serialized) };
    await page.locator('#importFile input[type="file"]').setInputFiles(file);
    await expect(page.locator('#backupPreview')).toContainText('1 built-in profiles');
    await expect(page.locator('#importPreviewSummary')).toContainText('replaces all');
    await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-backup-preview.png'), fullPage: true });
    await page.locator('#importPreviewDialog button[value="cancel"]').click();
    expect(await page.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('fr');
    await page.locator('#importFile input[type="file"]').setInputFiles(file);
    await page.locator('#importPreviewDialog button[value="confirm"]').click();
    await expect(page.locator('#importPreviewDialog')).toBeHidden();
    await expect(page.locator('#saveStatus')).toContainText('Full backup restored');
    const restored = await page.evaluate(async key => ({
      local: await chrome.storage.local.get(['builtinSiteProfiles', 'siteContentRules', 'tapTranslateOnboarding', key]),
      sync: await chrome.storage.sync.get('targetLang'),
    }), cacheKey);
    expect(restored.sync.targetLang).toBe('en');
    expect(restored.local.builtinSiteProfiles).toEqual(backup.settings.builtinSiteProfiles);
    expect(restored.local.siteContentRules).toEqual(backup.settings.siteContentRules);
    expect(restored.local.tapTranslateOnboarding).toEqual(backup.onboarding);
    expect(restored.local[cacheKey]).toEqual(backup.cache[cacheKey]);
    const article = await extContext.newPage();
    await article.goto(mock.fixtureUrl('article.html'));
    await translateTab(sw, await getTabId(article, sw));
    await expect(article.locator('#p1 .tap-translate-target')).toBeVisible();
    await expect(article.locator('#p2 .tap-translate-target')).toHaveCount(0);
    await article.close();
    await page.locator('#fullBackupBtn').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-backup-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#fullBackupBtn').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(os.tmpdir(), 'tap-translate-backup-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#importFile input[type="file"]').setInputFiles({ ...file, buffer: Buffer.from(JSON.stringify({ ...backup, version: 999 })) });
    await expect(page.locator('#saveStatus')).toContainText('Import failed');
    await expect(page.locator('#importPreviewDialog')).toBeHidden();
    const emptySites = { ...backup, settings: { ...backup.settings, builtinSiteProfiles: [], siteContentRules: [], siteRules: [] } };
    await page.locator('#importFile input[type="file"]').setInputFiles({ ...file, buffer: Buffer.from(JSON.stringify(emptySites)) });
    await page.locator('#importPreviewDialog button[value="confirm"]').click();
    await expect(page.locator('#importPreviewDialog')).toBeHidden();
    await page.reload();
    await expect(page.locator('#fullBackupBtn')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await mock.close(); }
});
