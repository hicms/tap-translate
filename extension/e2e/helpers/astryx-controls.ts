import { expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Tests choose the same visible, localized options a user sees. No native
// selectOption or synthetic change event can exercise Astryx's popup behavior.
async function trigger(locator: Locator): Promise<Locator> {
  return (await locator.evaluate((element) => element.matches('button')))
    ? locator
    : locator.getByRole('combobox');
}

async function optionLabel(control: Locator, value: string): Promise<string> {
  const state = await control.evaluate((element) => ({
    locale: document.documentElement.lang.replace('-', '_'),
    field: element.getAttribute('data-field') || element.id || '',
    builtin: !!element.closest('[data-builtin]'),
  }));
  const catalog = JSON.parse(
    readFileSync(
      new URL(`../../public/_locales/${state.locale || 'en'}/messages.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, { message: string }>;
  const field = state.field;
  const names: Record<string, string> = {
    direct: 'directApi',
    proxy: 'connectionModeProxy',
    bilingual: 'modeBilingual',
    replace: 'modeReplace',
    global: 'sitePolicyGlobal',
    never: 'sitePolicyNever',
    enabled: 'enabled',
    disabled: 'disabled',
    low: 'effortLow',
    medium: 'effortMedium',
    high: 'effortHigh',
    xhigh: 'effortXhigh',
    max: 'effortMax',
    auto: /policy/i.test(field)
      ? 'sitePolicyAuto'
      : field === 'thinkingAdapter'
        ? 'thinkingAdapterAuto'
        : 'automatic',
    custom: field === 'thinkingAdapter' ? 'thinkingAdapterCustom' : 'contentCustom',
    inherit: state.builtin ? 'contentInheritBuiltin' : 'contentInheritGeneric',
    '': 'siteUseGlobal',
  };
  let key = names[value] ?? value;
  if (field === 'uiLocale' || /targetLang/.test(field)) {
    const code = value.replace('-', '');
    key = value
      ? `${field === 'uiLocale' ? 'uiLanguage' : 'targetLanguage'}${code[0]!.toUpperCase()}${code.slice(1)}`
      : 'siteUseGlobal';
  }
  return catalog[key]?.message ?? value;
}

export async function selectOption(locator: Locator, value: string): Promise<void> {
  const control = await trigger(locator);
  const label = await optionLabel(control, value);
  await control.click();
  const listbox = control.page().locator(`[id="${await control.getAttribute('aria-controls')}"]`);
  await listbox.getByRole('option', { name: label, exact: true }).click();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
}

export async function expectSelection(locator: Locator, value: string): Promise<void> {
  const control = await trigger(locator);
  await expect(control).toHaveText(await optionLabel(control, value));
}

export async function expectDisabledOption(locator: Locator, label: string): Promise<void> {
  await locator.click();
  const listbox = locator.page().locator(`[id="${await locator.getAttribute('aria-controls')}"]`);
  await expect(
    listbox.getByRole('option', {
      name: await optionLabel(locator, label),
      exact: true,
    }),
  ).toHaveAttribute('aria-disabled', 'true');
  await locator.press('Escape');
}
