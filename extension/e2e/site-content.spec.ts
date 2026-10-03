import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import { getTabId, getTabStatus, inspectSelectionOverlay, seedSettings, translateSelectionInTab, translateTab } from './helpers/ext-control';

test('site content editor: browse, validate, inspect, save, restart and restore', async ({ extContext, extensionId, sw }, testInfo) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, uiLocale: 'en' });
    const page = await extContext.newPage();
    await page.goto(mock.fixtureUrl('article.html'));
    const tabId = await getTabId(page, sw);
    const original = await page.locator('#p1').textContent();
    const options = await extContext.newPage();
    const errors: string[] = [];
    options.on('pageerror', error => errors.push(error.message));
    options.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await options.goto(`chrome-extension://${extensionId}/options.html#section-sites`);
    await expect(options).toHaveTitle(/TapTranslate/);
    await expect(options.locator('#section-sites')).toBeVisible();
    const github = options.locator('.site-card[data-builtin]').first();
    await options.locator('[data-site-host="github.com"]').click();
    await github.locator('[data-editor-tab="content"]').click();
    await expect(github.locator('[data-selectors="content"]')).toHaveValue(/markdown-body/);
    await expect(github.locator('[data-selectors="content"]')).toBeDisabled();
    await expect(options.locator('#saveBtn')).toBeDisabled();
    await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('siteContentRules')).siteContentRules ?? [])).toEqual([]);
    await github.locator('[data-rule-mode="content"]').selectOption('custom');
    await expect(github.locator('[data-selectors="content"]')).toBeEnabled();
    await expect(github.locator('[data-selectors="content"]')).toHaveValue(/markdown-body/);
    await github.getByRole('button', { name: 'Restore field default', exact: true }).first().click();
    await expect(options.locator('#saveBtn')).toBeDisabled();
    await options.locator('[data-site-host="github.com"]').click();

    await options.locator('#addSiteRuleBtn').click();
    const card = options.locator('.site-card:not([data-builtin])').last();
    await card.locator('[data-field="host"]').fill('127.0.0.1');
    await card.locator('[data-editor-tab="content"]').click();
    await card.locator('[data-rule-mode="content"]').selectOption('custom');
    await card.locator('[data-selectors="content"]').fill('#p1\n[');
    await options.locator('#saveBtn').click();
    await expect(card.locator('.content-error')).toHaveText(/Content selectors, line 2/);
    await expect(card.locator('[data-selectors="content"]')).toBeFocused();
    await card.locator('[data-selectors="content"]').fill('#p1\n#missing\n#p1\n');
    const htmlBefore = await page.locator('body').innerHTML();
    await card.getByRole('button', { name: 'Check current webpage', exact: true }).click();
    await expect(card.locator('.content-check-results')).toContainText('127.0.0.1 — element match counts');
    await expect(card.locator('.content-check-results')).toContainText('#p1 — 1');
    await expect(card.locator('.content-check-results')).toContainText('#missing — 0');
    expect(await page.locator('body').innerHTML()).toBe(htmlBefore);
    expect(mock.getRequestCount()).toBe(0);
    await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('siteContentRules')).siteContentRules ?? [])).toEqual([]);

    // A concurrent provider edit must survive this content-only patch.
    await options.evaluate(async () => {
      const data = await chrome.storage.local.get('providers');
      data.providers[0].name = 'Concurrent provider name';
      await chrome.storage.local.set({ providers: data.providers });
      await chrome.storage.sync.set({ siteRules: [{ host: 'other.example', auto: true, targetLang: 'fr' }] });
    });
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toContainText('Saved');
    const persisted = await options.evaluate(async () => ({ local: await chrome.storage.local.get(['providers', 'siteContentRules']), sync: await chrome.storage.sync.get(['siteRules', 'siteContentRules']) }));
    expect(persisted.local.providers[0].name).toBe('Concurrent provider name');
    expect(persisted.local.siteContentRules).toEqual([{ host: '127.0.0.1', content: ['#p1', '#missing'] }]);
    expect(persisted.sync.siteContentRules).toBeUndefined();
    expect(persisted.sync.siteRules).toEqual([{ host: 'other.example', auto: true, targetLang: 'fr' }]);
    await translateTab(sw, tabId);
    await expect(page.locator('#p1 .tap-translate-target')).toBeVisible();
    await expect(page.locator('#p2 .tap-translate-target')).toHaveCount(0);

    const localCard = options.locator('.site-card').filter({ has: options.locator('[data-field="host"]') }).filter({ has: options.locator('[data-selectors="content"]') });
    const index = await localCard.evaluateAll(cards => cards.findIndex(item => item.querySelector<HTMLInputElement>('[data-field="host"]')!.value === '127.0.0.1'));
    const edit = localCard.nth(index);
    await edit.locator('[data-editor-tab="content"]').click();
    await edit.locator('[data-selectors="content"]').fill('#p2');
    const status = await getTabStatus(sw, tabId);
    const requests = mock.getRequestCount();
    await edit.getByRole('button', { name: 'Check current webpage', exact: true }).click();
    await expect(edit.locator('.content-check-results')).toContainText('#p2 — 1');
    expect((await getTabStatus(sw, tabId)).watching).toBe(status.watching);
    expect(mock.getRequestCount()).toBe(requests);
    await options.evaluate(() => {
      const storage = chrome.storage.local;
      const original = storage.set.bind(storage);
      Object.assign(globalThis, { restoreLocalWrite: () => { storage.set = original; } });
      storage.set = (async (patch: Record<string, unknown>) => {
        if ('siteContentRules' in patch) throw new Error('Synthetic local write failure');
        return original(patch);
      }) as typeof storage.set;
    });
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toContainText('Synthetic local write failure');
    await expect(edit.locator('[data-selectors="content"]')).toHaveValue('#p2');
    await expect(options.locator('#saveBtn')).toBeEnabled();
    await options.evaluate(() => (globalThis as unknown as { restoreLocalWrite: () => void }).restoreLocalWrite());
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toContainText('Saved');
    await expect(page.locator('#p1 .tap-translate-target')).toHaveCount(1);
    await translateTab(sw, tabId);
    await expect(page.locator('#p1 .tap-translate-target')).toHaveCount(0);
    await expect(page.locator('#p1')).toHaveText(original!);
    await expect(page.locator('#p2 .tap-translate-target')).toBeVisible();

    await edit.locator('[data-editor-tab="preferences"]').click();
    await edit.locator('[data-field="policy"]').selectOption('never');
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toContainText('Saved');
    expect((await translateTab(sw, tabId)).success).toBe(false);
    await expect(page.locator('.tap-translate-target')).toHaveCount(0);
    await edit.locator('[data-field="policy"]').selectOption('auto');
    await edit.locator('[data-field="mode"]').selectOption('replace');
    await edit.locator('[data-field="targetLang"]').selectOption('fr');
    await edit.locator('[data-editor-tab="content"]').click();
    await edit.getByRole('button', { name: 'Restore all content defaults', exact: true }).click();
    await expect(edit.locator('[data-rule-mode="content"]')).toHaveValue('inherit');
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toContainText('Saved');
    expect(await options.evaluate(async () => (await chrome.storage.local.get('siteContentRules')).siteContentRules)).toEqual([]);
    const prefs = await options.evaluate(async () => (await chrome.storage.sync.get('siteRules')).siteRules);
    expect(prefs).toContainEqual({ host: '127.0.0.1', auto: true, mode: 'replace', targetLang: 'fr' });
    await page.reload();
    await expect(page.locator('#p1')).toContainText('译:', { timeout: 15000 });
    await expect(page.locator('#p2')).toContainText('译:');
    await expect(page.locator('#editor')).toHaveText('Do not translate this editable text.');
    await options.bringToFront();
    await edit.locator('[data-editor-tab="content"]').click();
    await edit.scrollIntoViewIfNeeded();
    const { AxeBuilder } = await import('@axe-core/playwright');
    const accessibility = await new AxeBuilder({ page: options }).analyze();
    expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
    await options.screenshot({ path: testInfo.outputPath('site-content-desktop.png'), fullPage: true });
    await options.setViewportSize({ width: 390, height: 844 });
    await options.screenshot({ path: testInfo.outputPath('site-content-mobile.png'), fullPage: true });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await mock.close(); }
});

test('each iframe receives its own host rules and check rejects a different active hostname', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, uiLocale: 'en' });
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        siteContentRules: [{ host: '127.0.0.1', content: ['#p1'] }, { host: 'localhost', content: ['#p2'] }],
        tapTranslateSettingsMeta: { revision: 2 },
      });
    });
    const page = await extContext.newPage();
    await page.goto(mock.fixtureUrl('article.html'));
    await page.evaluate(src => {
      const frame = document.createElement('iframe'); frame.id = 'child'; frame.src = src; frame.style.height = '400px'; document.body.prepend(frame);
    }, mock.fixtureUrl('article.html').replace('127.0.0.1', 'localhost'));
    const child = page.frameLocator('#child');
    await expect(child.locator('#p2')).toBeVisible();
    await translateTab(sw, await getTabId(page, sw));
    await expect(page.locator('#p1 .tap-translate-target')).toHaveCount(1);
    await expect(page.locator('#p2 .tap-translate-target')).toHaveCount(0);
    await expect(child.locator('#p1 .tap-translate-target')).toHaveCount(0);
    await expect(child.locator('#p2 .tap-translate-target')).toHaveCount(1);

    const options = await extContext.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#section-sites`);
    const github = options.locator('.site-card[data-builtin]').first();
    await options.locator('[data-site-host="github.com"]').click();
    await github.locator('[data-editor-tab="content"]').click();
    await github.getByRole('button', { name: 'Check current webpage', exact: true }).click();
    await expect(github.locator('.content-error')).toContainText('hostname does not match');
    await page.goto('chrome://version');
    await page.bringToFront(); await options.bringToFront();
    await github.getByRole('button', { name: 'Check current webpage', exact: true }).click();
    await expect(github.locator('.content-error')).toContainText('This page cannot be checked');
  } finally { await mock.close(); }
});

test('a draft check requests only the ungranted HTTPS host and retains the draft on denial', async ({ extContext, extensionId }) => {
  await seedSettings(extContext, extensionId, { apiBase: 'http://127.0.0.1:8080/v1', uiLocale: 'en' });
  const page = await extContext.newPage();
  await page.route('https://rules.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic permission fixture</title><p>Local synthetic text.</p>' }));
  await page.goto('https://rules.example.test/article');
  const options = await extContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#section-sites`);
  await options.locator('#addSiteRuleBtn').click();
  const card = options.locator('.site-card:not([data-builtin])');
  await card.locator('[data-field="host"]').fill('rules.example.test');
  await card.locator('[data-editor-tab="content"]').click();
  await card.locator('[data-rule-mode="content"]').selectOption('custom');
  await card.locator('[data-selectors="content"]').fill('p');
  await options.evaluate(() => {
    // Deterministic denial at the native permission boundary; no external grant.
    chrome.permissions.request = (async (request: chrome.permissions.Permissions) => {
      Object.assign(globalThis, { requestedSitePermission: request }); return false;
    }) as typeof chrome.permissions.request;
  });
  await card.getByRole('button', { name: 'Check current webpage', exact: true }).click();
  await expect(card.locator('.content-error')).toContainText('Site access was not granted');
  expect(await options.evaluate(() => (globalThis as unknown as { requestedSitePermission: unknown }).requestedSitePermission)).toEqual({ origins: ['https://rules.example.test/*'] });
  await expect(card.locator('[data-selectors="content"]')).toHaveValue('p');
  expect(await options.evaluate(async () => (await chrome.storage.local.get('siteContentRules')).siteContentRules)).toEqual([]);
});

test('an older frame-config response cannot replace a newer selection', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });
    const page = await extContext.newPage(); await page.goto(mock.fixtureUrl('article.html'));
    const tabId = await getTabId(page, sw);
    await sw.evaluate(async id => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['tap-translate.js'] });
      await chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        let requests = 0;
        chrome.runtime.sendMessage = (async (message: { action: string }) => {
          const response = await original(message);
          if (message.action === 'getFrameSessionConfig' && ++requests === 1) await new Promise(resolve => setTimeout(resolve, 500));
          return response;
        }) as typeof chrome.runtime.sendMessage;
      } });
    }, tabId);
    const first = translateSelectionInTab(sw, tabId, 'Older selection.');
    await page.waitForTimeout(80);
    const latest = translateSelectionInTab(sw, tabId, 'Latest selection.');
    await Promise.all([first, latest]);
    expect((await inspectSelectionOverlay(page)).originalText).toBe('Latest selection.');
    expect(mock.getRequestCount()).toBe(1);
  } finally { await mock.close(); }
});
