import { selectOption } from './astryx-controls';
import { expect, type Page } from '@playwright/test';

export async function settingsTab(page: Page, section: 'connection' | 'reading' | 'sites' | 'data'): Promise<void> {
  await page.locator(`[data-section-nav="section-${section}"]`).click();
  await expect(page.locator(`#section-${section}`)).toBeVisible();
}

export async function optionsLocale(page: Page, locale: string): Promise<void> {
  await settingsTab(page, 'reading');
  await selectOption(page.locator('#uiLocale'), locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await settingsTab(page, 'connection');
}

export async function advancedSettings(page: Page): Promise<void> {
  await page.locator('#serviceEditor [data-editor-tab="advanced"]').click();
}

export async function showServiceField(page: Page, selector: string): Promise<void> {
  const panel = await page.locator(selector).evaluate(element => element.closest<HTMLElement>('[data-editor-panel]')?.dataset.editorPanel);
  if (panel) await page.locator(`#serviceEditor [data-editor-tab="${panel}"]`).click();
}

export async function chooseModel(page: Page, index: number): Promise<void> {
  if (await page.locator('#serviceList').isHidden()) await page.locator('#serviceEditor .workspace-back').click();
  const option = index < 0 ? page.locator('[data-service-model]').last() : page.locator('[data-service-model]').nth(index);
  await option.click();
}
