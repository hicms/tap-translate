import { useContext } from 'react';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { PROVIDER_PRESETS, type ProviderPresetId } from '../lib/provider/presets';
import { useLocale } from './locale';
import { FormDisabled, Select } from './fields';

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
  const locked = useContext(FormDisabled);
  const choose = (value: string) => onSelect(value as ProviderPresetId);
  const options = PROVIDER_PRESETS.map((item) => ({
    value: item.id,
    label: t(item.labelKey),
    description: <span className="provider-option-description">{t(item.hintKey)}</span>,
    icon: <img className="provider-picker-icon" src={item.iconPath} alt="" />,
  }));
  return (
    <div id="providerPicker" className="provider-picker">
      {inline ? (
        <RadioList
          label={t('providerPreset')}
          isLabelHidden
          value={selected}
          onChange={choose}
          isDisabled={locked}
          width="100%"
        >
          {PROVIDER_PRESETS.map((item, index) => (
            <RadioListItem
              key={item.id}
              value={item.id}
              label={options[index]!.label}
              description={options[index]!.description}
              startContent={options[index]!.icon}
              data-provider-id={item.id}
            />
          ))}
        </RadioList>
      ) : (
        <Select
          id="providerPreset"
          label={t('simpleService')}
          value={selected}
          onChange={choose}
          placement="below"
          options={[...new Set(PROVIDER_PRESETS.map((item) => item.groupKey))].map((group) => ({
            type: 'section',
            title: t(group),
            options: options.filter((_, index) => PROVIDER_PRESETS[index]!.groupKey === group),
          }))}
        />
      )}
    </div>
  );
}
