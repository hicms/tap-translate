import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { seedSettings, getTabId } from './helpers/ext-control';
import { startMockServer } from './helpers/mock-server';
import { settingsTab, advancedSettings } from './helpers/options-ui';
import { selectOption, expectSelection } from './helpers/astryx-controls';

test('provider radio navigation waits for explicit confirmation and cancellation adds nothing', async ({
  extContext,
  extensionId,
}) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const providers = page.locator('#serviceList .workspace-group');
  await expect(providers).toHaveCount(1);
  await page.locator('#addProviderBtn').click();
  const first = page.locator('[data-provider-id="local-api"] input');
  await first.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  const ark = page.locator('[data-provider-id="ark-agent-plan"] input');
  await expect(ark).toBeChecked();
  await expect(ark).toBeFocused();
  await expect(providers).toHaveCount(1);
  await page.locator('#closeProviderDialogBtn').click();
  await expect(page.locator('#addProviderDialog')).toBeHidden();
  await expect(providers).toHaveCount(1);
  await expect(page.locator('#addProviderBtn')).toBeFocused();
  await page.locator('#addProviderBtn').click();
  await expect(first).toBeChecked();
  await first.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.locator('#confirmProviderBtn').click();
  await expect(page.locator('#addProviderDialog')).toBeHidden();
  await expect(providers).toHaveCount(2);
  await expect(page.locator('#model input')).toHaveValue('ark-code-latest');
  await expect(page.locator('#apiKey input')).toBeFocused();
});

async function capture(page: Page, name: string) {
  if (process.env.TAP_TRANSLATE_QA_DIR)
    await page.screenshot({
      path: path.join(process.env.TAP_TRANSLATE_QA_DIR, `controls-${name}.png`),
      animations: 'disabled',
    });
}

async function healthy(page: Page) {
  await expect(page).toHaveTitle(/TapTranslate/);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('vite-error-overlay, select, option')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

async function dropdowns(page: Page, name: string) {
  const controls = page.locator('button[role="combobox"]:visible');
  for (const control of await controls.all()) {
    if (await control.isDisabled()) continue;
    await control.click();
    const list = page.locator(`[id="${await control.getAttribute('aria-controls')}"]`);
    await expect(list).toBeVisible();
    await expect
      .poll(
        async () => {
          const box = (await list.boundingBox())!;
          const viewport = page.viewportSize()!;
          return (
            box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y + box.height <= viewport.height + 1
          );
        },
        { message: `${name}: expanded listbox fits viewport` },
      )
      .toBe(true);
    await capture(page, `${name}-${(await control.getAttribute('id')) || 'select'}-open`);
    await control.press('Escape');
    await expect(list).toBeHidden();
    await expect(control).toBeFocused();
  }
}

for (const display of [
  { name: 'desktop', width: 1440, height: 1000, colorScheme: 'light' as const },
  {
    name: 'mobile-dark',
    width: 390,
    height: 844,
    colorScheme: 'dark' as const,
  },
]) {
  test(`every settings surface uses Astryx controls and fits ${display.name}`, async ({
    extContext,
    extensionId,
  }) => {
    test.setTimeout(150_000);
    await seedSettings(extContext, extensionId, {
      apiBase: 'http://127.0.0.1:8080/v1',
      uiLocale: 'zh-CN',
    });
    const page = await extContext.newPage();
    await page.setViewportSize(display);
    await page.emulateMedia({ colorScheme: display.colorScheme });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#apiKey .astryx-text-input input')).toBeVisible();
    await healthy(page);
    await capture(page, `${display.name}-connection`);
    await dropdowns(page, `${display.name}-model`);
    await advancedSettings(page);
    await selectOption(page.locator('#thinkingAdapter'), 'custom');
    await page.locator('#advancedConnection > summary').click();
    await page.locator('#addHeaderBtn').click();
    await page.locator('#customHeaderRows [data-field="name"]').fill('X-Test');
    await page.locator('#customHeaderRows [data-field="value"]').fill('preview');
    await healthy(page);
    await dropdowns(page, `${display.name}-advanced`);
    await page.locator('#thinkingCustomFields').scrollIntoViewIfNeeded();
    await capture(page, `${display.name}-json`);
    await page.locator('#addProviderBtn').click();
    await expect(page.getByRole('radiogroup')).toBeVisible();
    await healthy(page);
    await capture(page, `${display.name}-providers`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#addProviderBtn')).toBeFocused();
    await settingsTab(page, 'reading');
    await healthy(page);
    await capture(page, `${display.name}-reading`);
    await dropdowns(page, `${display.name}-reading`);
    await settingsTab(page, 'sites');
    await healthy(page);
    await dropdowns(page, `${display.name}-sites`);
    await capture(page, `${display.name}-sites`);
    const site = page.locator('.site-card:visible');
    await site.locator('[data-editor-tab="content"]').click();
    await selectOption(site.locator('[data-rule-mode="content"]'), 'custom');
    await site.locator('[data-selectors="content"]').fill('.markdown-body');
    await dropdowns(page, `${display.name}-content`);
    await healthy(page);
    await capture(page, `${display.name}-content`);
    await settingsTab(page, 'data');
    await healthy(page);
    await capture(page, `${display.name}-data`);
    if (await page.locator('#discardBtn').isEnabled()) await page.locator('#discardBtn').click();
    await expect(page.locator('#exportBtn')).toBeVisible();
    await expect(page.locator('#importBtn')).toBeVisible();
    await page.locator('#importFile input[type="file"]').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"targetLang":"fr"}'),
    });
    await expect(page.locator('#importPreviewDialog')).toBeVisible();
    await healthy(page);
    await capture(page, `${display.name}-import`);
    await page.locator('#importPreviewDialog button[value="cancel"]').click();
    await expect(page.locator('#importPreviewDialog')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('popup and onboarding dropdowns fit narrow windows in both themes and support keyboard selection', async ({
  extContext,
  extensionId,
  sw,
}) => {
  test.setTimeout(120_000);
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, {
      apiBase: mock.apiBase,
      uiLocale: 'zh-CN',
    });
    const article = await extContext.newPage();
    await article.goto(mock.fixtureUrl('article.html'));
    const tabId = await getTabId(article, sw);
    const popup = await extContext.newPage();
    const errors: string[] = [];
    popup.on('pageerror', (error) => errors.push(error.message));
    await popup.addInitScript((id) => {
      chrome.tabs.query = async () => [await chrome.tabs.get(id)];
    }, tabId);
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#sitePreferences > summary').click();
    for (const scheme of ['light', 'dark'] as const) {
      await popup.emulateMedia({ colorScheme: scheme });
      await healthy(popup);
      await capture(popup, `popup-${scheme}`);
      await dropdowns(popup, `popup-${scheme}`);
    }
    await popup.locator('#mode').focus();
    await popup.keyboard.press('ArrowDown');
    await popup.keyboard.press('End');
    await popup.keyboard.press('Enter');
    await expectSelection(popup.locator('#mode'), 'replace');
    const onboarding = await extContext.newPage();
    onboarding.on('pageerror', (error) => errors.push(error.message));
    await onboarding.setViewportSize({ width: 320, height: 568 });
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await onboarding.locator('#connectionOptions > summary').click();
    for (const scheme of ['light', 'dark'] as const) {
      await onboarding.emulateMedia({ colorScheme: scheme });
      await healthy(onboarding);
      await dropdowns(onboarding, `onboarding-${scheme}`);
      await onboarding.evaluate(() => window.scrollTo(0, 0));
      await capture(onboarding, `onboarding-${scheme}`);
    }
    await onboarding.locator('#providerPreset').click();
    await onboarding.getByRole('option', { name: /自定义/ }).click();
    await expect(onboarding.locator('#apiBase input')).toBeVisible();
    await expect(onboarding.locator('#providerPreset')).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await mock.close();
  }
});

test('component numeric drafts, hard text limits and open dropdown transaction lock preserve saved values', async ({
  extContext,
  extensionId,
  sw,
}) => {
  await seedSettings(extContext, extensionId, {
    apiBase: 'http://127.0.0.1:8080/v1',
    uiLocale: 'en',
  });
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('#model input')).toHaveAttribute('required', '');
  await expect(page.locator('#model input')).toHaveAttribute('maxlength', '200');
  await page.locator('#model input').fill('');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#model input')).toBeFocused();
  await page.keyboard.insertText('x'.repeat(201));
  await expect(page.locator('#model input')).toHaveValue('x'.repeat(200));
  await page.locator('#model input').fill('component-model');
  await advancedSettings(page);
  await expect(page.locator('#systemPrompt textarea')).toHaveAttribute('maxlength', '20000');
  await page.locator('#systemPrompt textarea').fill('x'.repeat(20000));
  await page.keyboard.insertText('y');
  await expect(page.locator('#systemPrompt textarea')).toHaveValue('x'.repeat(20000));
  await page.locator('#systemPrompt textarea').fill('');
  for (const value of ['-', '0x1', '0.001', '3']) {
    await page.locator('#temperature input').fill(value);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#temperature input')).toBeFocused();
    await expect(page.locator('#temperature input')).toHaveValue(value);
  }
  await page.locator('#temperature input').fill('0.31');
  await page.locator('#maxTokens input').fill('0');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#maxTokens input')).toBeFocused();
  await page.locator('#maxTokens input').fill('');
  await page.evaluate(() => {
    const set = chrome.storage.sync.set.bind(chrome.storage.sync);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseControlsSave: release });
    chrome.storage.sync.set = async (values) => {
      await gate;
      return set(values);
    };
  });
  await page.locator('#thinking').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  // Initiate the same form submit while its dropdown is still open.
  await page.locator('#optionsForm').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#optionsForm')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.locator('#thinking')).toBeDisabled();
  await expect(page.locator('#temperature input')).toBeDisabled();
  await expect(page.locator('#rememberApiKey input')).toBeDisabled();
  await expect(page.locator('#importFile input[type="file"]')).toBeDisabled();
  await page.keyboard.type('accidental');
  await expect(page.locator('#temperature input')).toHaveValue('0.31');
  await page.evaluate(() => (window as unknown as { releaseControlsSave: () => void }).releaseControlsSave());
  await expect(page.locator('#saveStatus')).toHaveText('Saved');
  await page.reload();
  await advancedSettings(page);
  await expect(page.locator('#temperature input')).toHaveValue('0.31');
  await expect(page.locator('#maxTokens input')).toHaveValue('');
  expect(await sw.evaluate(async () => (await chrome.storage.sync.get('model')).model)).toBe(
    'component-model',
  );
});

test('connection and import transactions lock components and prevent duplicate imports', async ({
  extContext,
  extensionId,
  sw,
}) => {
  test.setTimeout(90_000);
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, uiLocale: 'en' });
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await advancedSettings(page);
    mock.setResponseDelay(1600);
    await page.locator('#thinking').click();
    await page.locator('#testConnectionBtn').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.locator('#thinking')).toBeDisabled();
    await expect(page.locator('#temperature input')).toBeDisabled();
    await expect(page.locator('#testConnectionStatus')).toContainText('Connected');
    await settingsTab(page, 'data');
    await page.locator('#clearCacheBtn').click();
    await expect(page.locator('#dataConfirmDialog')).toBeVisible();
    await capture(page, 'cache-confirm');
    await page.locator('#dataConfirmDialog button[value="cancel"]').click();
    await page
      .locator('#importFile input[type="file"]')
      .setInputFiles({
        name: 'settings.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"targetLang":"fr"}'),
      });
    await page.evaluate(() => {
      const set = chrome.storage.sync.set.bind(chrome.storage.sync);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state = { release: () => release(), writes: 0 };
      Object.assign(window, { importGate: state });
      chrome.storage.sync.set = async (values) => {
        state.writes++;
        await gate;
        return set(values);
      };
    });
    const confirm = page.locator('#importPreviewDialog button[value="confirm"]');
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(page.locator('#importFile input[type="file"]')).toBeDisabled();
    await confirm.evaluate((button: HTMLButtonElement) => button.click());
    expect(
      await page.evaluate(() => (window as unknown as { importGate: { writes: number } }).importGate.writes),
    ).toBe(1);
    await page.evaluate(() =>
      (window as unknown as { importGate: { release: () => void } }).importGate.release(),
    );
    await expect(page.locator('#importPreviewDialog')).toBeHidden();
    expect(await sw.evaluate(async () => (await chrome.storage.sync.get('targetLang')).targetLang)).toBe(
      'fr',
    );
  } finally {
    await mock.close();
  }
});
