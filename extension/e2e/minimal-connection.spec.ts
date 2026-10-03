import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { optionsLocale, advancedSettings, settingsTab } from './helpers/options-ui';
import { seedSettings, getTabId } from './helpers/ext-control';
import { startMockServer } from './helpers/mock-server';

async function screenshot(page: Page, name: string, fullPage = false): Promise<void> {
  if (process.env.TAP_TRANSLATE_QA_DIR) await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, name), fullPage });
}

async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  const violations = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('simple settings navigate by tabs, history and keyboard; errors reveal hidden fields', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.setViewportSize({ width: 1504, height: 1044 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options.html#section-reading`);
  await expect(page.locator('#uiLocale')).toBeVisible();
  await optionsLocale(page, 'zh-CN');
  await expect(page.locator('#apiBase')).toBeHidden();
  await expect(page.locator('#serviceEditorTitle')).toBeVisible();
  await expect(page.locator('#useModelBtn')).toHaveCount(0);
  await screenshot(page, 'minimal-options-desktop.png');
  await accessible(page);
  await settingsTab(page, 'sites');
  await page.goBack();
  await expect(page.locator('#serviceEditorTitle')).toBeVisible();
  await page.locator('[data-section-nav="section-connection"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#uiLocale')).toBeVisible();
  for (const section of ['reading', 'sites', 'data'] as const) {
    await settingsTab(page, section);
    await screenshot(page, `minimal-${section}-desktop.png`);
    await accessible(page);
  }
  await settingsTab(page, 'sites');
  await page.locator('#addSiteRuleBtn').click();
  const host = page.locator('#siteRuleRows .site-card:not([data-builtin]) [data-field="host"]');
  await host.fill('https://');
  await settingsTab(page, 'connection');
  await page.locator('#saveBtn').click();
  await expect(host).toBeVisible();
  await expect(host).toBeFocused();
  await host.fill('example.org');
  await settingsTab(page, 'connection');
  await advancedSettings(page);
  await page.locator('#advancedConnection > summary').click();
  await page.locator('#addHeaderBtn').click();
  await page.locator('#customHeaderRows [data-field="value"]').fill('example-value');
  await page.locator('#serviceEditor [data-editor-tab="basic"]').click();
  await page.locator('#saveBtn').click();
  const header = page.locator('#customHeaderRows [data-field="name"]');
  await expect(header).toBeVisible();
  await expect(header).toBeFocused();
  await header.fill('X-Example');
  await page.locator('#maxConcurrent').fill('9');
  await page.locator('#serviceEditor [data-editor-tab="basic"]').click();
  await page.locator('#saveBtn').click();
  await expect(page.locator('#maxConcurrent')).toBeVisible();
  await expect(page.locator('#maxConcurrent')).toBeFocused();
  await page.locator('#maxConcurrent').fill('3');
  await accessible(page);
  await screenshot(page, 'minimal-advanced-desktop.png', true);
  await page.locator('#serviceEditor [data-editor-tab="basic"]').click();
  await page.locator('#addProviderBtn').click();
  await expect(page.locator('#providerPicker [data-provider-id="minimax"]')).toBeVisible();
  await accessible(page);
  await screenshot(page, 'minimal-add-service.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('#addProviderDialog')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, 'minimal-options-mobile.png');
  for (const section of ['connection', 'reading', 'sites', 'data'] as const) {
    await settingsTab(page, section);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await accessible(page);
  }
  for (const locale of ['en', 'fr', 'es', 'ru', 'zh-TW', 'zh-CN']) {
    await optionsLocale(page, locale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), locale).toBe(true);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await screenshot(page, 'minimal-options-dark.png');
  await accessible(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await settingsTab(page, 'connection');
  await page.locator('#addProviderBtn').click();
  await page.locator('#providerPicker [data-provider-id="custom"]').click();
  await expect(page.locator('#apiBase')).toBeVisible();
  await expect(page.locator('#apiBase')).toBeFocused();
  expect(errors).toEqual([]);
});

test('saving locks the options draft and rejects duplicate submission until storage finishes', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('#model')).toHaveValue(/.+/);
  await page.locator('#model').fill('saved-model');
  await page.evaluate(() => {
    chrome.permissions.request = async () => true;
    const original = chrome.storage.sync.set.bind(chrome.storage.sync);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseSave: release });
    chrome.storage.sync.set = async items => { await gate; return original(items); };
  });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#optionsForm')).toHaveAttribute('aria-busy', 'true');
  expect(await page.locator('#optionsForm').evaluate((form: HTMLFormElement) => form.inert)).toBe(true);
  await page.keyboard.type('accidental-edit');
  await expect(page.locator('#model')).toHaveValue('saved-model');
  await page.evaluate(() => {
    (document.getElementById('optionsForm') as HTMLFormElement).requestSubmit();
    (window as Window & { releaseSave?: () => void }).releaseSave!();
  });
  await expect(page.locator('#optionsForm')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#model')).toHaveValue('saved-model');
});

test('onboarding is one form, reveals invalid endpoint, and never completes after denied permission', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await expect(page.locator('#apiKey')).toBeEnabled();
  await expect(page.locator('#apiBase')).toBeHidden();
  await page.locator('#finishBtn').click();
  await expect(page.locator('#apiKey')).toBeFocused();
  await page.locator('#apiKey').fill('session-key');
  await page.locator('#connectionOptions > summary').click();
  await page.locator('#apiBase').fill('http://example.org/v1');
  await page.locator('#connectionOptions > summary').click();
  await page.locator('#finishBtn').click();
  await expect(page.locator('#apiBase')).toBeVisible();
  await expect(page.locator('#apiBase')).toBeFocused();
  await page.locator('#apiBase').fill('https://example.org/v1');
  await page.evaluate(() => { chrome.permissions.request = async () => false; });
  await page.locator('#finishBtn').click();
  await expect(page.locator('#testStatus')).toHaveClass(/is-error/);
  await expect(page.locator('#finishBtn')).toBeEnabled();
  const stored = await page.evaluate(() => chrome.storage.local.get(null));
  expect(stored.tapTranslateOnboarding?.completed).not.toBe(true);
  expect(JSON.stringify(stored)).not.toContain('session-key');
});

test('onboarding tests and saves the same model parameters, preserves other windows language and session-only key', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, model: 'MiniMax-M3', targetLang: 'en', uiLocale: 'zh-CN' });
    await sw.evaluate(async () => {
      const { providers } = await chrome.storage.local.get('providers');
      providers[0].models[0].parameters.thinking = 'enabled';
      providers[0].models[0].parameters.temperature = 0.42;
      await chrome.storage.local.set({ providers });
    });
    const page = await extContext.newPage();
    const requests: Record<string, unknown>[] = [];
    page.on('request', request => { if (request.url().endsWith('/chat/completions')) requests.push(request.postDataJSON()); });
    await page.setViewportSize({ width: 1504, height: 1044 });
    await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await expect(page.locator('#apiKey')).toBeEnabled();
    await page.locator('#apiKey').fill('only-this-session');
    await page.locator('#rememberKey').uncheck();
    await screenshot(page, 'minimal-onboarding-desktop.png');
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'minimal-onboarding-mobile.png');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#testBtn').click();
    await expect(page.locator('#testStatus')).toHaveClass(/is-ok/);
    expect(requests.at(-1)).toMatchObject({ model: 'MiniMax-M3', thinking: { type: 'adaptive' }, temperature: 0.42 });
    await sw.evaluate(() => chrome.storage.sync.set({ targetLang: 'fr' }));
    await page.locator('#finishBtn').click();
    await expect.poll(() => sw.evaluate(async () => (await chrome.storage.local.get('tapTranslateOnboarding')).tapTranslateOnboarding?.completed)).toBe(true);
    const stored = await sw.evaluate(async () => ({ local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null), session: await chrome.storage.session.get(null) }));
    expect(stored.sync.targetLang).toBe('fr');
    expect(stored.local.providers[0].models[0].parameters).toMatchObject({ thinking: 'enabled', temperature: 0.42 });
    expect(JSON.stringify(stored.local)).not.toContain('only-this-session');
    expect(JSON.stringify(stored.sync)).not.toContain('only-this-session');
    expect(JSON.stringify(stored.session)).toContain('only-this-session');
  } finally { await mock.close(); }
});

test('onboarding blocks incompatible thinking configuration with access to full settings', async ({ extContext, extensionId, sw }) => {
  await seedSettings(extContext, extensionId, { apiBase: 'https://api.minimax.cn/v1', model: 'MiniMax-M3.1-Flash-Preview' });
  await sw.evaluate(async () => {
    const { providers } = await chrome.storage.local.get('providers');
    providers[0].models[0].parameters.thinking = 'disabled';
    await chrome.storage.local.set({ providers });
  });
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await expect(page.locator('#finishBtn')).toBeEnabled();
  await page.locator('#finishBtn').click();
  await expect(page.locator('#testStatus')).toContainText(/cannot disable thinking/i);
  await expect(page.locator('#openSettings')).toBeVisible();
  expect(await page.evaluate(async () => (await chrome.storage.local.get('tapTranslateOnboarding')).tapTranslateOnboarding?.completed)).not.toBe(true);
});

test('popup keeps the main action first and reveals active website policy and its reset', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, uiLocale: 'zh-CN' });
    const article = await extContext.newPage();
    await article.goto(mock.fixtureUrl('article.html'));
    const id = await getTabId(article, sw);
    await sw.evaluate(() => chrome.storage.sync.set({ siteRules: [{ host: '127.0.0.1', auto: false, disabled: true }] }));
    const popup = await extContext.newPage();
    // An extension page opened as a tab must target the article like the real action popup does.
    await popup.addInitScript(tabId => { chrome.tabs.query = async () => [await chrome.tabs.get(tabId)]; }, id);
    await popup.setViewportSize({ width: 340, height: 620 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#sitePolicySummary')).toHaveText(/永不|不翻译|Never translate/);
    await expect(popup.locator('#sitePolicy')).toBeHidden();
    await screenshot(popup, 'minimal-popup-never.png');
    await popup.locator('#sitePreferences > summary').click();
    await expect(popup.locator('#sitePolicy')).toBeEnabled();
    await popup.locator('#sitePolicy').selectOption('global');
    await expect(popup.locator('#primaryBtn')).toBeEnabled();
    await expect(popup.locator('#sitePolicySummary')).toBeEmpty();
    await popup.locator('#sitePreferences > summary').click();
    await screenshot(popup, 'minimal-popup.png');
    await accessible(popup);
    await popup.locator('#primaryBtn').click();
    await expect(article.locator('.tap-translate-target').first()).toBeVisible();
  } finally { await mock.close(); }
});
