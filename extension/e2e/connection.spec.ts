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

      await showServiceField(options, '#apiBase input');
      await options.locator('#apiBase input').fill(mock.apiBase);
      await showServiceField(options, '#model input');
      await options.locator('#model input').fill('e2e-mock');
      await showServiceField(options, '#apiKey input');
      await options.locator('#apiKey input').fill('e2e-test-key');

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
      await showServiceField(options, '#apiBase input');
      await options.locator('#apiBase input').fill(mock.apiBase);
      await showServiceField(options, '#model input');
      await options.locator('#model input').fill('e2e-mock');
      await showServiceField(options, '#apiKey input');
      await options.locator('#apiKey input').fill('bad-key');

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
      await options.locator('#confirmProviderBtn').click();
      await showServiceField(options, '#apiBase input');
      await options.locator('#apiBase input').fill(mock.apiBase);
      await showServiceField(options, '#model input');
      await options.locator('#model input').fill('e2e-mock');
      await showServiceField(options, '#apiKey input');
      await options.locator('#apiKey input').fill('');

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
    await options.locator('#confirmProviderBtn').click();
    await expect(options.locator('#providerName input')).toHaveValue('火山方舟 Agent Plan');
    await expect(options.locator('#apiBase input')).toHaveValue('https://ark.cn-beijing.volces.com/api/plan/v3');
    await expect(options.locator('#model input')).toHaveValue('ark-code-latest');
    await expect(options.locator('#apiKey input')).toHaveValue('');
    const icon = options.locator('#currentProviderIcon');
    await expect(icon).toHaveAttribute('src', 'icons/providers/volcengine.svg');
    expect(await icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

    const onboarding = await extContext.newPage();
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await onboarding.locator('#providerPreset').click();
    await onboarding.getByRole('option', { name: /火山方舟 Agent Plan/ }).click();
    await expect(onboarding.locator('#apiBase input')).toHaveValue('https://ark.cn-beijing.volces.com/api/plan/v3');
    await expect(onboarding.locator('#model input')).toHaveValue('ark-code-latest');
    await expect(onboarding.locator('#providerPresetHint')).toContainText('Agent Plan');
  });

  test('keeps independent drafts, activates a model, saves and survives reload', async ({ extContext, extensionId }) => {
    const options = await extContext.newPage();
    const errors: string[] = [];
    options.on('pageerror', (error) => errors.push(error.message));
    options.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await options.setViewportSize({ width: 1440, height: 1050 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('[data-service-model]')).toHaveCount(1);
    await optionsLocale(options, 'en');
    await advancedSettings(options);
    await showServiceField(options, '#providerName input');
    await options.locator('#providerName input').fill('Research API');
    await showServiceField(options, '#apiBase input');
    await options.locator('#apiBase input').fill('http://127.0.0.1:8080/v1');
    await showServiceField(options, '#apiKey input');
    await options.locator('#apiKey input').fill('provider-one-secret');
    await showServiceField(options, '#temperature input');
    await options.locator('#temperature input').fill('0.15');
    await expect(options.locator('#section-reading #maxConcurrent input')).toHaveCount(0);
    await expect(options.locator('#section-reading #batchSize input')).toHaveCount(0);
    await showServiceField(options, '.model-settings #maxConcurrent input');
    await options.locator('.model-settings #maxConcurrent input').fill('2');
    await showServiceField(options, '.model-settings #batchSize input');
    await options.locator('.model-settings #batchSize input').fill('4');
    await options.locator('#addModelBtn').click();
    await expect(options.locator('#maxConcurrent input')).toHaveValue('3');
    await expect(options.locator('#batchSize input')).toHaveValue('6');
    await showServiceField(options, '#model input');
    await options.locator('#model input').fill('research-model');
    await showServiceField(options, '#temperature input');
    await options.locator('#temperature input').fill('0.75');
    await showServiceField(options, '#maxConcurrent input');
    await options.locator('#maxConcurrent input').fill('5');
    await showServiceField(options, '#batchSize input');
    await options.locator('#batchSize input').fill('12');
    await showServiceField(options, '#maxTokens input');
    await options.locator('#maxTokens input').fill('4096');
    await showServiceField(options, '#systemPrompt textarea');
    await options.locator('#systemPrompt textarea').fill('Use academic terminology.');
    await expect(options.locator('[data-service-model][aria-pressed="true"]')).toContainText('research-model');
    await chooseModel(options, 0);
    await expect(options.locator('#temperature input')).toHaveValue('0.15');
    await expect(options.locator('#maxConcurrent input')).toHaveValue('2');
    await expect(options.locator('#batchSize input')).toHaveValue('4');
    await options.locator('#addProviderBtn').click();
    await options.locator('#providerPicker [data-provider-id="minimax"]').click();
    await options.locator('#confirmProviderBtn').click();
    await expect(options.locator('#apiBase input')).toHaveValue('https://api.minimax.cn/v1');
    await showServiceField(options, '#apiKey input');
    await options.locator('#apiKey input').fill('provider-two-secret');
    await showServiceField(options, '#rememberApiKey');
    await options.locator('#rememberApiKey input').uncheck();
    await chooseModel(options, 1);
    await expect(options.locator('#model input')).toHaveValue('research-model');
    await expect(options.locator('#temperature input')).toHaveValue('0.75');
    await expect(options.locator('#maxConcurrent input')).toHaveValue('5');
    await expect(options.locator('#batchSize input')).toHaveValue('12');
    await expect(options.locator('#apiKey input')).toHaveValue('provider-one-secret');
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
    await expect(options.locator('#model input')).toHaveValue('research-model');
    await expect(options.locator('#modelAdvanced')).not.toHaveAttribute('open', '');
    await advancedSettings(options);
    await expect(options.locator('#maxTokens input')).toHaveValue('4096');
    await expect(options.locator('#maxConcurrent input')).toHaveValue('5');
    await expect(options.locator('#batchSize input')).toHaveValue('12');
    await expect(options.locator('#systemPrompt textarea')).toHaveValue('Use academic terminology.');
    await expect(options.locator('#serviceList .workspace-group')).toHaveCount(2);
    await chooseModel(options, -1);
    await expect(options.locator('#apiKey input')).toHaveValue('provider-two-secret');
    await chooseModel(options, 1);
    await showServiceField(options, '#removeModelBtn');
    await options.locator('#removeModelBtn').click();
    await expect(options.locator('[data-service-model]')).toHaveCount(2);
    await options.locator('#discardBtn').click();
    await expect(options.locator('[data-service-model]')).toHaveCount(3);
    await chooseModel(options, -1);
    await showServiceField(options, '#removeProviderBtn');
    await options.locator('#removeProviderBtn').click();
    await expect(options.locator('#serviceList .workspace-group')).toHaveCount(1);
    await options.locator('#discardBtn').click();
    await expect(options.locator('#serviceList .workspace-group')).toHaveCount(2);
    await expect(options).toHaveTitle(/TapTranslate/);
    await optionsLocale(options, 'zh-CN');
    await advancedSettings(options);
    await expect(options.locator('#frequencyPenalty label')).toHaveText('Frequency Penalty ∙ 必填');
    await expect(options.locator('#presencePenalty label')).toHaveText('Presence Penalty ∙ 必填');
    await expect(options.locator('.model-settings h3')).toHaveText('模型参数');
    await expect(options.locator('label[for="reasoningEffort"]')).toHaveText('推理强度');
    await expect(options.locator('#maxConcurrent label')).toHaveText('最大并发批次数 ∙ 必填');
    await expect(options.locator('#batchSize label')).toHaveText('每批段落数 ∙ 必填');
    await options.locator('#thinking').click();
    await expect(options.getByRole('option', { name: '禁用', exact: true })).toBeVisible();
    await options.locator('#thinking').press('Escape');
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
    await expect(options.locator('#apiBase input')).toHaveValue('https://api.minimax.cn/v1');
    await showServiceField(options, '#maxConcurrent input');
    await options.locator('#maxConcurrent input').fill('9');
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toHaveClass(/is-error/);
    await expect(options.locator('#maxConcurrent input')).toBeFocused();
    await chooseModel(options, 1);
    await expect(options.locator('#maxConcurrent input')).toHaveValue('5');
    // Saving from another model still reveals and rejects the invalid draft.
    await options.locator('#saveBtn').click();
    await expect(options.locator('#saveStatus')).toHaveClass(/is-error/);
    await expect(options.locator('#maxConcurrent input')).toHaveValue('9');
    await expect(options.locator('#maxConcurrent input')).toBeFocused();
    await chooseModel(options, 1);
    await showServiceField(options, '#resetModelBtn');
    await options.locator('#resetModelBtn').click();
    await expect(options.locator('#maxConcurrent input')).toHaveValue('3');
    await expect(options.locator('#batchSize input')).toHaveValue('6');
    await options.locator('#discardBtn').click();
    await expect(options.locator('#maxConcurrent input')).toHaveValue('5');
    await expect(options.locator('#batchSize input')).toHaveValue('12');
    expect(errors).toEqual([]);
  });
});
