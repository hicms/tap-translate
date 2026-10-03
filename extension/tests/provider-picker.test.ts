// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountProviderPicker } from '../lib/provider/picker';

describe('provider picker', () => {
  it('exposes inline choices immediately and leaves Escape to the containing dialog', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const select = vi.fn();
    mountProviderPicker(root, key => key, select, { inline: true });
    const trigger = root.querySelector<HTMLButtonElement>('.provider-picker-trigger')!;
    const menu = root.querySelector<HTMLElement>('.provider-picker-menu')!;
    expect(trigger.hidden).toBe(true);
    expect(menu.hidden).toBe(false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-provider-id="minimax"]')!.click();
    expect(select).toHaveBeenCalledWith('minimax');
    expect(select).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders grouped icon options and selects MiniMax', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onSelect = vi.fn();
    const picker = mountProviderPicker(root, (key) => key, onSelect);

    expect(root.querySelectorAll('[data-provider-id]')).toHaveLength(8);
    expect(root.querySelector('[data-provider-id="minimax"] img')?.getAttribute('src'))
      .toBe('icons/providers/minimax.svg');

    (root.querySelector('[data-provider-id="minimax"]') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith('minimax');
    picker.setSelected('minimax');
    expect(root.querySelector('.provider-picker-label')?.textContent).toBe('presetMiniMax');
  });

  it('opens from the trigger and supports Escape', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountProviderPicker(root, (key) => key, vi.fn());
    const trigger = root.querySelector('.provider-picker-trigger') as HTMLButtonElement;
    trigger.click();
    expect((root.querySelector('.provider-picker-menu') as HTMLElement).hidden).toBe(false);
    const menu = root.querySelector('.provider-picker-menu') as HTMLElement;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((root.querySelector('.provider-picker-menu') as HTMLElement).hidden).toBe(true);
  });
});
