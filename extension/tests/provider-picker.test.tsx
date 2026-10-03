// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderPicker } from '../ui/provider-picker';

vi.mock('../lib/i18n', () => ({ getUiMessage: (key: string) => key }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
function mount(inline = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const select = vi.fn();
  root = createRoot(container);
  act(() => root.render(<ProviderPicker selected="custom" onSelect={select} inline={inline} />));
  return { container, select };
}
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe('React provider picker', () => {
  it('exposes grouped presets and invokes selection once', () => {
    const { container, select } = mount(true);
    expect(container.querySelectorAll('[data-provider-id]')).toHaveLength(8);
    expect(container.querySelector<HTMLButtonElement>('.provider-picker-trigger')!.hidden).toBe(true);
    const choice = container.querySelector<HTMLButtonElement>('[data-provider-id="minimax"]')!;
    expect(choice.querySelector('img')?.getAttribute('src')).toBe('icons/providers/minimax.svg');
    act(() => choice.click());
    expect(select).toHaveBeenCalledWith('minimax');
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('returns focus on Escape and removes outside-click listener on unmount', () => {
    const { container } = mount();
    const trigger = container.querySelector<HTMLButtonElement>('.provider-picker-trigger')!;
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>('.provider-picker-menu')!;
    expect(menu.hidden).toBe(false);
    act(() => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    const remove = vi.spyOn(document, 'removeEventListener');
    act(() => trigger.click());
    act(() => root.render(null));
    expect(remove.mock.calls.some(([type]) => type === 'click')).toBe(true);
    remove.mockRestore();
  });
  it('lets a containing modal handle Escape for inline choices', () => {
    const { container } = mount(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => container.querySelector('.provider-picker-menu')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  });
});
