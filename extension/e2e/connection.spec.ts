import { optionsLocale, advancedSettings, chooseModel, showServiceField } from './helpers/options-ui';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import path from 'node:path';

/**
 * Connection diagnostics via Options UI:
 * mock OpenAI-compatible loopback + Test connection button.
 */
test.describe('options connection test', () => {
  test('Connected on healthy /v1 chat completions', async ({ extContext, extensionId }) => {
    const mock = await startMockServer();
    try {
      const options = await extContext.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#testConnectionBtn')).toBeVisible();

      await optionsLocale(options, 'en');
    await advancedSettings(options);
      await expect(options.locator('#testConnectionBtn')).toHaveText(/Test connection/i);

      await showServiceField(options, '#apiBase');
      await options.locator('#apiBase').fill(mock.apiBase);
      await showServiceField(options, '#model');
      await options.locator('#model').fill('e2e-mock');
      await showServiceField(options, '#apiKey');
      await options.locator('#apiKey').fill('e2e-test-key');

      await options.locator('#testConnectionBtn').click();
      await expect
        .poll(async () => ((await options.locator('#testConnectionStatus').textContent()) ?? '').trim(), {
          timeout: 15_000,
        })
        .toMatch(/^Connected/i);
    } finally {
      await mock.close();
    }
  });

  test('401 maps to API key rejected', async ({ extContext, extensionId }) => {
    const mock = await startMockServer();
    mock.setMode('auth_fail');
    try {
      const options = await extContext.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await optionsLocale(options, 'en');
    await advancedSettings(options);
      await showServiceField(options, '#apiBase');
      await options.locator('#apiBase').fill(mock.apiBase);
      await showServiceField(options, '#model');
      await options.locator('#model').fill('e2e-mock');
      await showServiceField(options, '#apiKey');
      await options.locator('#apiKey').fill('bad-key');

      await options.locator('#testConnectionBtn').click();
      await expect
        .poll(async () => ((await options.locator('#testConnectionStatus').textContent()) ?? '').trim(), {
          timeout: 15_000,
        })
        .toMatch(/API key rejected/i);
      await expect(options.locator('#testConnectionStatus')).toHaveClass(/is-error/);
    } finally {
      await mock.close();
    }
  });

  test('proxy route can test without a plugin API key', async ({ extContext, extensionId }) => {
    const mock = await startMockServer();
    try {
      const options = await extContext.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await optionsLocale(options, 'en');
    await advancedSettings(options);
      await options.locator('#addProviderBtn').click();
      await options.locator('#providerPicker [data-provider-id="local-api"]').click();
      await showServiceField(options, '#apiBase');
      await options.locator('#apiBase').fill(mock.apiBase);
      await showServiceField(options, '#model');
      await options.locator('#model').fill('e2e-mock');
      await showServiceField(options, '#apiKey');
      await options.locator('#apiKey').fill('');

      await options.locator('#testConnectionBtn').click();
      await expect
        .poll(async () => ((await options.locator('#testConnectionStatus').textContent()) ?? '').trim(), {
          timeout: 15_000,
        })
        .toMatch(/^Connected/i);
    } finally {
      await mock.close();
    }
  });

});

test.describe('provider and model workbench', () => {
  test('adds Ark Agent Plan from options and fills the same preset in onboarding', async ({ extContext, extensionId }) => {
    const options = await extContext.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsLocale(options, 'zh-CN');
    await advancedSettings(options);
    await options.locator('#addProviderBtn').click();
    const choice = options.locator('#providerPicker [data-provider-id="ark-agent-plan"]');
    await expect(choice).toContainText('Agent Plan 专属 API Key');
    await choice.click();
    await expect(options.locator('#providerName')).toHaveValue('火山方舟 Agent Plan');
    await expect(options.locator('#apiBase')).toHaveValue('https://ark.cn-beijing.volces.com/api/plan/v3');
    await expect(options.locator('#model')).toHaveValue('ark-code-latest');
    await expect(options.locator('#apiKey')).toHaveValue('');
    const icon = options.locator('#currentProviderIcon');
    await expect(icon).toHaveAttribute('src', 'icons/providers/volcengine.svg');
    expect(await icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

    const onboarding = await extContext.newPage();
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await onboarding.locator('#providerPicker .provider-picker-trigger').click();
    await onboarding.locator('#providerPicker [data-provider-id="ark-agent-plan"]').click();
    await expect(onboarding.locator('#apiBase')).toHaveValue('https://ark.cn-beijing.volces.com/api/plan/v3');
    await expect(onboarding.locator('#model')).toHaveValue('ark-code-latest');
    await expect(onboarding.locator('#providerPresetHint')).toContainText('Agent Plan');
  });

  test('keeps independent drafts, activates a model, saves and survives reload', async ({ extContext, extensionId }) => {
    const options = await extContext.newPage();
    const errors: string[] = [];
    options.on('pageerror', (error) => errors.push(error.message));
    options.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await options.setViewportSize({ width: 1440, height: 1050 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#currentModel option')).toHaveCount(1);
    await optionsLocale(options, 'en');
    await advancedSettings(options);
    await showServiceField(options, '#providerName');
    await options.locator('#providerName').fill('Research API');
    await showServiceField(options, '#apiBase');
    await options.locator('#apiBase').fill('http://127.0.0.1:8080/v1');
    await showServiceField(options, '#apiKey');
    await options.locator('#apiKey').fill('provider-one-secret');
    await showServiceField(options, '#temperature');
    await options.locator('#temperature').fill('0.15');
    await expect(options.locator('#section-reading #maxConcurrent')).toHaveCount(0);
    await expect(options.locator('#section-reading #batchSize')).toHaveCount(0);
    await showServiceField(options, '.model-settings #maxConcurrent');
    await options.locator('.model-settings #maxConcurrent').fill('2');
    await showServiceField(options, '.model-settings #batchSize');
    await options.locator('.model-settings #batchSize').fill('4');
    await options.locator('#addModelBtn').click();
    await expect(options.locator('#maxConcurrent')).toHaveValue('3');
    await expect(options.locator('#batchSize')).toHaveValue('6');
    await showServiceField(options, '#model');
    await options.locator('#model').fill('research-model');
    await showServiceField(options, '#temperature');
    await options.locator('#temperature').fill('0.75');
    await showServiceField(options, '#maxConcurrent');
    await options.locator('#maxConcurrent').fill('5');
    await showServiceField(options, '#batchSize');
    await options.locator('#batchSize').fill('12');
    await showServiceField(options, '#maxTokens');
    await options.locator('#maxTokens').fill('4096');
    await showServiceField(options, '#systemPrompt');
    await options.locator('#systemPrompt').fill('Use academic terminology.');
    await expect(options.locator('#currentModel option:checked')).toContainText('research-model');
    await chooseModel(options, 0);
    await expect(options.locator('#temperature')).toHaveValue('0.15');
    await expect(options.locator('#maxConcurrent')).toHaveValue('2');
    await expect(options.locator('#batchSize')).toHaveValue('4');
    await options.locator('#addProviderBtn').click();
    await options.locator('#providerPicker [data-provider-id="minimax"]').click();
    await expect(options.locator('#apiBase')).toHaveValue('https://api.minimax.cn/v1');
    await showServiceField(options, '#apiKey');
    await options.locator('#apiKey').fill('provider-two-secret');
    await showServiceField(options, '#rememberApiKey');
    await options.locator('#rememberApiKey input').uncheck();
    await chooseModel(options, 1);
    await expect(options.locator('#model')).toHaveValue('research-model');
    await expect(options.locator('#temperature')).toHaveValue('0.75');
    await expect(options.locator('#maxConcurrent')).toHaveValue('5');
    await expect(options.locator('#batchSize')).toHaveValue('12');
    await expect(options.locator('#apiKey')).toHaveValue('provider-one-secret');
    expect(await options.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('#optionsForm input:invalid')).map((input) => ({ id: input.id, message: input.validationMessage })))).toEqual([]);
    await options.locator('#saveBtn').click();
    expect(errors).toEqual([]);
    await expect(options.locator('#saveStatus')).toHaveText(/Saved/i);
    const stored = await options.evaluate(async () => ({
      sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null),
    }));
    expect(JSON.stringify(stored.sync)).not.toContain('provider-one-secret');
    expect(JSON.stringify(stored.sync)).not.toContain('provider-two-secret');
    expect(JSON.stringify(stored.local)).not.toContain('provider-two-secret');
    expect(stored.sync).toMatchObject({ maxConcurrent: 5, batchSize: 12 });
    await options.reload();
    await expect(options.locator('#model')).toHaveValue('research-model');
    await expect(options.locator('#modelAdvanced')).not.toHaveAttribute('open', '');
    await advancedSettings(options);
    await expect(options.locator('#maxTokens')).toHaveValue('4096');
    await expect(options.locator('#maxConcurrent')).toHaveValue('5');
    await expect(options.locator('#batchSize')).toHaveValue('12');
    await expect(options.locator('#systemPrompt')).toHaveValue('Use academic terminology.');
    await expect(options.locator('#currentModel optgroup')).toHaveCount(2);
    await chooseModel(options, -1);
    await expect(options.locator('#apiKey')).toHaveValue('provider-two-secret');
    await chooseModel(options, 1);
    await showServiceField(options, '#removeModelBtn');
    await options.locator('#removeModelBtn').click();
    await expect(options.locator('#currentModel option')).toHaveCount(2);
    await options.locator('#discardBtn').click();
    await expect(options.locator('#currentModel option')).toHaveCount(3);
    await chooseModel(options, -1);
    await showServiceField(options, '#removeProviderBtn');
    await options.locator('#removeProviderBtn').click();
    await expect(options.locator('#currentModel optgroup')).toHaveCount(1);
    await options.locator('#discardBtn').click();
    await expect(options.locator('#currentModel optgroup')).toHaveCount(2);
    await expect(options).toHaveTitle(/TapTranslate/);
    await optionsLocale(options, 'zh-CN');
    await advancedSettings(options);
    await expect(options.locator('label[for="frequencyPenalty"]')).toHaveText('Frequency Penalty');
    await expect(options.locator('label[for="presencePenalty"]')).toHaveText('Presence Penalty');
    await expect(options.locator('.model-settings h3')).toHaveText('模型参数');
    await expect(options.locator('label[for="reasoningEffort"]')).toHaveText('推理强度');
    await expect(options.locator('label[for="maxConcurrent"]')).toHaveText('最大并发批次数');
    await expect(options.locator('label[for="batchSize"]')).toHaveText('每批段落数');
    await expect(options.locator('#thinking option[value="disabled"]')).toHaveText('禁用');
    await options.locator('#section-connection').scrollIntoViewIfNeeded();
    await options.evaluate(() => window.scrollTo(0, 0));
    if (process.env.TAP_TRANSLATE_QA_DIR) await options.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'services-desktop.png'), fullPage: false });
    if (process.env.TAP_TRANSLATE_QA_DIR) await options.locator('.model-settings').screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'services-parameters.png'), style: '#stickyActions { visibility: hidden; }' });
    await options.setViewportSize({ width: 390, height: 844 });
    await options.evaluate(() => window.scrollTo(0, 0));
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(options.locator('#addProviderBtn')).toBeVisible();
    if (process.env.TAP_TRANSLATE_QA_DIR) await options.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'services-mobile.png'), fullPage: false });
    await chooseModel(options, -1);
    await expect(options.locator('#apiBase')).toHaveValue('https://api.minimax.cn/v1');
    await showServiceField(options, '#maxConcurrent');
    await options.locator('#maxConcurrent').fill('9');
    expect(await options.locator('#maxConcurrent').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await chooseModel(options, 1);
    expect(await options.locator('#maxConcurrent').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
    await showServiceField(options, '#resetModelBtn');
    await options.locator('#resetModelBtn').click();
    await expect(options.locator('#maxConcurrent')).toHaveValue('3');
    await expect(options.locator('#batchSize')).toHaveValue('6');
    await options.locator('#discardBtn').click();
    await expect(options.locator('#maxConcurrent')).toHaveValue('5');
    await expect(options.locator('#batchSize')).toHaveValue('12');
    expect(errors).toEqual([]);
  });
});
