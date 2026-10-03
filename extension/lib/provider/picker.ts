import type { ProviderPreset, ProviderPresetId } from './presets';
import { getProviderPreset, PROVIDER_PRESETS } from './presets';

export interface ProviderPickerController {
  setSelected(id: ProviderPresetId): void;
  refreshLabels(): void;
}

export function mountProviderPicker(
  root: HTMLElement,
  labelFor: (key: string) => string,
  onSelect: (id: ProviderPresetId) => void,
  options: { inline?: boolean } = {},
): ProviderPickerController {
  let selected = getProviderPreset('custom');
  let open = Boolean(options.inline);
  root.classList.toggle('provider-picker-inline', open);

  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = Boolean(options.inline);
  button.className = 'provider-picker-trigger';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('img');
  icon.className = 'provider-picker-icon';
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'provider-picker-label';
  const chevron = document.createElement('span');
  chevron.className = 'provider-picker-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  button.append(icon, label, chevron);

  const menu = document.createElement('div');
  menu.className = 'provider-picker-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = !open;

  function setOpen(next: boolean): void {
    if (options.inline) return;
    open = next;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
    if (open) focusOption(selected.id);
  }

  function focusOption(id: ProviderPresetId): void {
    const option = menu.querySelector<HTMLElement>(`[data-provider-id="${id}"]`);
    option?.focus();
  }

  function optionElement(preset: ProviderPreset): HTMLButtonElement {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'provider-picker-option';
    option.dataset.providerId = preset.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(preset.id === selected.id));
    option.title = labelFor(preset.hintKey);

    const optionIcon = document.createElement('img');
    optionIcon.className = 'provider-picker-icon';
    optionIcon.src = preset.iconPath;
    optionIcon.alt = '';
    optionIcon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'provider-picker-copy';
    const name = document.createElement('strong');
    name.textContent = labelFor(preset.labelKey);
    const hint = document.createElement('small');
    hint.textContent = labelFor(preset.hintKey);
    copy.append(name, hint);
    option.append(optionIcon, copy);
    option.addEventListener('click', () => {
      selected = preset;
      setOpen(false);
      render();
      onSelect(preset.id);
    });
    return option;
  }

  function render(): void {
    menu.setAttribute('aria-label', labelFor('providerPreset'));
    root.replaceChildren(button, menu);
    icon.src = selected.iconPath;
    label.textContent = labelFor(selected.labelKey);
    button.title = labelFor(selected.hintKey);
    menu.replaceChildren();
    let previousGroup = '';
    for (const preset of PROVIDER_PRESETS) {
      if (preset.groupKey !== previousGroup) {
        const group = document.createElement('div');
        group.className = 'provider-picker-group';
        group.textContent = labelFor(preset.groupKey);
        group.setAttribute('aria-hidden', 'true');
        menu.appendChild(group);
        previousGroup = preset.groupKey;
      }
      menu.appendChild(optionElement(preset));
    }
  }

  button.addEventListener('click', () => setOpen(!open));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      focusOption(selected.id);
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[data-provider-id]'));
    const current = document.activeElement as HTMLButtonElement | null;
    const index = current ? items.indexOf(current) : -1;
    if (event.key === 'Escape') {
      if (options.inline) return;
      event.preventDefault();
      setOpen(false);
      button.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      current?.click();
    }
  });
  document.addEventListener('click', (event) => {
    if (open && !root.contains(event.target as Node)) setOpen(false);
  });

  render();
  return {
    setSelected(id) {
      selected = getProviderPreset(id);
      render();
    },
    refreshLabels() {
      render();
    },
  };
}
