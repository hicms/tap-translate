// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderPicker } from '../ui/provider-picker';
import { FormDisabled } from '../ui/fields';

vi.mock('../lib/i18n', () => ({ getUiMessage: (key: string) => key }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
function mount(disabled = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const select = vi.fn();
  root = createRoot(container);
  act(() =>
    root.render(
      <FormDisabled value={disabled}>
        <ProviderPicker selected="local-api" onSelect={select} inline />
      </FormDisabled>,
    ),
  );
  return { container, select };
}
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe('component provider choices', () => {
  it('exposes every preset as a radio and invokes selection once', () => {
    const { container, select } = mount();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(8);
    const choice = container.querySelector('[data-provider-id="minimax"]')!;
    expect(choice.querySelector('img')?.getAttribute('src')).toBe('icons/providers/minimax.svg');
    act(() => choice.querySelector<HTMLInputElement>('input')!.click());
    expect(select).toHaveBeenCalledWith('minimax');
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('lets the custom preset be chosen when opening a new provider dialog', () => {
    const { container, select } = mount();
    act(() => container.querySelector<HTMLInputElement>('[data-provider-id="custom"] input')!.click());
    expect(select).toHaveBeenCalledWith('custom');
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('blocks every radio while the owning form transaction is busy', () => {
    const { container, select } = mount(true);
    const controls = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(controls.every((control) => control.disabled)).toBe(true);
    act(() => controls.forEach((control) => control.click()));
    expect(select).not.toHaveBeenCalled();
  });
});
