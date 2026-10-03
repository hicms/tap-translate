import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { getProviderPreset, PROVIDER_PRESETS, type ProviderPresetId } from '../lib/provider/presets';
import { useLocale } from './locale';

export function ProviderPicker({
  selected,
  onSelect,
  inline = false,
}: {
  selected: ProviderPresetId;
  onSelect: (id: ProviderPresetId) => void;
  inline?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(inline);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const preset = getProviderPreset(selected);
  useEffect(() => {
    if (!open || inline) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', outside);
    root.current?.querySelector<HTMLElement>(`[data-provider-id="${selected}"]`)?.focus();
    return () => document.removeEventListener('click', outside);
  }, [open, inline, selected]);
  return (
    <div
      id="providerPicker"
      className={`provider-picker ${inline ? 'provider-picker-inline' : ''}`}
      ref={root}
    >
      <Button
        ref={trigger}
        className="provider-picker-trigger"
        label={t(preset.labelKey)}
        hidden={inline}
        aria-expanded={open}
        aria-haspopup="listbox"
        icon={<img className="provider-picker-icon" src={preset.iconPath} alt="" />}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <div
        className="provider-picker-menu"
        role="listbox"
        aria-label={t('providerPreset')}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !inline) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
          }
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-provider-id]')];
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }}
      >
        {PROVIDER_PRESETS.map((item, index) => (
          <div key={item.id}>
            {PROVIDER_PRESETS[index - 1]?.groupKey !== item.groupKey ? (
              <div className="provider-picker-group" aria-hidden="true">
                {t(item.groupKey)}
              </div>
            ) : null}
            <Button
              className="provider-picker-option"
              variant="ghost"
              label={t(item.labelKey)}
              data-provider-id={item.id}
              role="option"
              aria-selected={selected === item.id}
              onClick={() => {
                if (!inline) setOpen(false);
                onSelect(item.id);
              }}
            >
              <img className="provider-picker-icon" src={item.iconPath} alt="" />
              <span className="provider-picker-copy">
                <strong>{t(item.labelKey)}</strong>
                <small>{t(item.hintKey)}</small>
              </span>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
