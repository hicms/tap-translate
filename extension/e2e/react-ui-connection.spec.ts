import { selectOption, expectSelection } from './helpers/astryx-controls';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { getTabId, seedSettings } from './helpers/ext-control';
import { startMockServer } from './helpers/mock-server';
import { readFile } from 'node:fs/promises';

test('React popup translates, stops pending work, restores and persists site permission handoff', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, uiLocale: 'en' });
    const article = await extContext.newPage();
    await article.goto(mock.fixtureUrl('article.html'));
    const tabId = await getTabId(article, sw);
    const popup = await extContext.newPage();
    const errors: string[] = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.addInitScript(id => { chrome.tabs.query = async () => [await chrome.tabs.get(id)]; }, tabId);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    mock.setResponseDelay(1500);
    await expect(popup.locator('#primaryBtn')).toHaveText('Translate page');
    await popup.locator('#primaryBtn').click();
    await expect(popup.locator('#primaryBtn')).toHaveText(/Stop/i);
    await expect.poll(() => mock.getRequestCount()).toBeGreaterThan(0);
    await popup.locator('#primaryBtn').click();
    await expect(popup.locator('#primaryBtn')).not.toHaveText(/Stop/i, { timeout: 15000 });
    mock.setResponseDelay(0);
    await article.reload();
    await popup.reload();
    await expect(popup.locator('#primaryBtn')).toHaveText('Translate page');
    await popup.locator('#primaryBtn').click();
    await expect(article.locator('.tap-translate-target').first()).toBeVisible();
    await expect(popup.locator('#primaryBtn')).toHaveText(/Restore/i);
    await popup.locator('#primaryBtn').click();
    await expect(article.locator('.tap-translate-target')).toHaveCount(0);
    await popup.locator('#sitePreferences > summary').click();
    await popup.evaluate(() => {
      chrome.permissions.request = async () => false;
    });
    await selectOption(popup.locator('#sitePolicy'), 'auto');
    await expect(popup.locator('#sitePolicy')).toBeEnabled();
    await expectSelection(popup.locator('#sitePolicy'), 'global');
    expect(await sw.evaluate(async id => (await chrome.storage.session.get(`tapTranslatePendingSiteAuto:${id}`))[`tapTranslatePendingSiteAuto:${id}`], tabId)).toBeUndefined();
    await popup.evaluate(id => {
      chrome.permissions.request = async () => {
        const key = `tapTranslatePendingSiteAuto:${id}`;
        const intent = (await chrome.storage.session.get(key))[key];
        if (intent?.tabId !== id || intent?.host !== '127.0.0.1') throw new Error('Missing durable handoff before permission');
        return true;
      };
    }, tabId);
    await selectOption(popup.locator('#sitePolicy'), 'auto');
    await expect.poll(() => sw.evaluate(async () => (await chrome.storage.sync.get('siteRules')).siteRules)).toContainEqual({ host: '127.0.0.1', auto: true });
    expect(errors).toEqual([]);
  } finally { await mock.close(); }
});

test('React onboarding tests connection and saves a session-only key', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, apiKey: '', uiLocale: 'en' });
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await page.locator('#apiKey input').fill('onboarding-session-secret');
    await page.locator('#rememberKey input').uncheck();
    await page.locator('#testBtn').click();
    await expect(page.locator('#testStatus')).toContainText('Connected');
    await page.locator('#finishBtn').click();
    await expect.poll(() => sw.evaluate(async () => (await chrome.storage.local.get('tapTranslateOnboarding')).tapTranslateOnboarding?.completed)).toBe(true);
    const stored = await sw.evaluate(async () => ({ local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null), session: await chrome.storage.session.get(null) }));
    expect(JSON.stringify(stored.local)).not.toContain('onboarding-session-secret');
    expect(JSON.stringify(stored.sync)).not.toContain('onboarding-session-secret');
    expect(JSON.stringify(stored.session)).toContain('onboarding-session-secret');
    const options = await extContext.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#apiKey input')).toHaveValue('onboarding-session-secret');
  } finally { await mock.close(); }
});

test('React data controls export all data after confirmation and import legacy files', async ({ extContext, extensionId, sw }) => {
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.example.com/v1', apiKey: 'export-test-secret', uiLocale: 'en', targetLang: 'en' });
  await sw.evaluate(async () => {
    const secrets = { 'e2e-provider': { apiKey: 'export-test-secret', customHeaders: { 'X-Private': 'export-test-header' } } };
    await chrome.storage.local.set({ customHeaders: { 'X-Private': 'export-test-header' }, tapTranslateProviderSecrets: secrets });
  });
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#section-data`);
  async function download() {
    const pending = page.waitForEvent('download');
    await page.locator('#exportBtn').click();
    await page.locator('#dataConfirmDialog button[value="confirm"]').click();
    const file = await pending;
    return readFile((await file.path())!, 'utf8');
  }
  await page.locator('#exportBtn').click();
  await expect(page.locator('#dataConfirmDialog')).toContainText(/API key/i);
  await expect(page.locator('#dataConfirmDialog')).toContainText('headers');
  await page.locator('#dataConfirmDialog button[value="cancel"]').click();
  await page.locator('#exportBtn').click();
  const privateDownload = page.waitForEvent('download');
  await page.locator('#dataConfirmDialog button[value="confirm"]').click();
  const privateExport = await readFile((await (await privateDownload).path())!, 'utf8');
  expect(privateExport).toContain('export-test-secret');
  expect(privateExport).toContain('export-test-header');
  const file = { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ targetLang: 'fr' })) };
  await page.locator('#importFile input[type="file"]').setInputFiles(file);
  await expect(page.locator('#importPreviewDialog')).toBeVisible();
  await expect(page.locator('#importPreviewChanges')).toContainText('Target language');
  await page.locator('#importPreviewDialog button[value="cancel"]').click();
  expect(await sw.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('en');
  await page.locator('#importFile input[type="file"]').setInputFiles(file);
  await page.locator('#importPreviewDialog button[value="confirm"]').click();
  await expect(page.locator('#importPreviewDialog')).toBeHidden();
  await expect.poll(() => sw.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe('fr');
  await page.reload();
  const after = await download();
  expect(JSON.parse(after).settings.targetLang).toBe('fr');
  await page.locator('[data-section-nav="section-connection"]').click();
  await expect(page.locator('#apiKey input')).toHaveValue('export-test-secret');
});

test('custom site drafts stay editable at built-in domain prefixes and unrelated saves preserve concurrent rules', async ({ extContext, extensionId, sw }) => {
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.example.com/v1', uiLocale: 'en', targetLang: 'en' });
  await sw.evaluate(() => chrome.storage.sync.set({ siteRules: [{ host: 'custom.example', disabled: true }, { host: 'github.com', disabled: true }] }));
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#section-sites`);
  await page.locator('#addSiteRuleBtn').click();
  const card = page.locator('.site-card:visible');
  const host = card.locator('input[data-field="host"]');
  await host.fill('github.com');
  await expect(host).toBeEditable();
  await page.locator('#saveBtn').click();
  await expect(host).toBeFocused();
  await expect(card.locator('[data-action="remove-site"]')).toBeVisible();
  await host.press('End');
  await host.pressSequentially('.example.org');
  await expect(host).toHaveValue('github.com.example.org');
  await card.locator('[data-action="remove-site"]').click();
  await sw.evaluate(() => chrome.storage.sync.set({ siteRules: [{ host: 'concurrent.example', disabled: true }] }));
  await page.locator('[data-section-nav="section-reading"]').click();
  await selectOption(page.locator('#targetLang'), 'fr');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveStatus')).toContainText('Saved');
  expect(await sw.evaluate(async () => (await chrome.storage.sync.get('siteRules')).siteRules)).toEqual([{ host: 'concurrent.example', disabled: true }]);
});
