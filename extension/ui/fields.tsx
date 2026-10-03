import {
  createContext,
  useContext,
  useCallback,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Selector, type SelectorProps, type SelectorOptionType } from '@astryxdesign/core/Selector';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';

// The transaction owner also disables controls rendered in Astryx portals.
export const FormDisabled = createContext(false);
type LabelProps = {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
};
type ValueProps = { value: string; onChange: (value: string) => void };

export function focusField(id: string): void {
  const field = document.getElementById(id);
  const control = field?.matches('input, textarea, button')
    ? field
    : field?.querySelector<HTMLElement>('input, textarea, button');
  control?.focus();
}

export function Input({
  label,
  hint,
  error,
  hideLabel,
  id,
  type = 'text',
  disabled,
  required,
  readOnly,
  autoFocus,
  className,
  onChange,
  ...props
}: LabelProps &
  ValueProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type'> & {
    type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'search';
  }) {
  const locked = useContext(FormDisabled);
  return (
    <div className="field" id={id}>
      <TextInput
        {...props}
        label={label}
        isLabelHidden={hideLabel}
        size="lg"
        width="100%"
        type={type === 'number' || type === 'url' || type === 'search' ? 'text' : type}
        role={type === 'search' ? 'searchbox' : undefined}
        {...{
          required,
          inputMode: type === 'number' ? 'decimal' : type === 'url' ? 'url' : props.inputMode,
        }}
        isRequired={required}
        isDisabled={locked || disabled}
        isReadOnly={readOnly}
        hasAutoFocus={autoFocus}
        status={error || props['aria-invalid'] ? { type: 'error', message: error } : undefined}
        statusVariant="detached"
        className={`ui-control ${className ?? ''}`}
        onChange={onChange}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function selectPresentation(): 'popover' | 'bottom-sheet' {
  // Firefox 140–146 does not implement the anchor positioning used by Astryx.
  return CSS.supports('position-anchor', '--control') ? 'popover' : 'bottom-sheet';
}

export function Select({
  label,
  hint,
  error,
  hideLabel,
  disabled,
  ...props
}: LabelProps &
  Omit<SelectorProps<SelectorOptionType>, 'label' | 'hasClear' | 'value' | 'onChange'> &
  ValueProps & { disabled?: boolean }) {
  const locked = useContext(FormDisabled);
  return (
    <div className="field">
      {/* Astryx 0.6.5 disables the trigger but leaves an already open surface.
        Reset its private open state when a transaction locks the field. */}
      <Selector
        {...props}
        key={locked || disabled ? 'disabled' : 'enabled'}
        label={label}
        isLabelHidden={hideLabel}
        isDisabled={locked || disabled}
        size="lg"
        width="100%"
        presentation={selectPresentation()}
        status={error || props['aria-invalid'] ? { type: 'error', message: error } : undefined}
        statusVariant="detached"
        className={`ui-control ${props.className ?? ''}`}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  id,
  disabled,
  required,
  readOnly,
  autoFocus,
  spellCheck,
  maxLength,
  className,
  onChange,
  ...props
}: LabelProps & ValueProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const locked = useContext(FormDisabled);
  const limit = useCallback(
    (element: HTMLTextAreaElement | null) => {
      // Astryx maxLength is a soft grapheme counter; these editors retain their
      // existing hard UTF-16 limit as well as parser/schema validation on save.
      if (element && maxLength !== undefined) element.maxLength = maxLength;
    },
    [maxLength],
  );
  return (
    <div className="field" id={id}>
      <TextArea
        {...props}
        ref={limit}
        label={label}
        isLabelHidden={hideLabel}
        size="lg"
        width="100%"
        {...{ required }}
        isRequired={required}
        isDisabled={locked || disabled}
        isReadOnly={readOnly}
        hasAutoFocus={autoFocus}
        hasSpellCheck={spellCheck === undefined ? true : spellCheck === true || spellCheck === 'true'}
        status={error || props['aria-invalid'] ? { type: 'error', message: error } : undefined}
        statusVariant="detached"
        className={`ui-control ${className ?? ''}`}
        onChange={onChange}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Check({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  const locked = useContext(FormDisabled);
  return (
    <div className="field" id={id}>
      <CheckboxInput
        label={label}
        value={checked}
        onChange={onChange}
        isDisabled={locked}
        description={hint}
        width="100%"
      />
    </div>
  );
}

export function Brand({ children }: { children?: ReactNode }) {
  return (
    <div className="brand">
      <img src="icons/icon128.png" alt="" />
      <strong>TapTranslate</strong>
      {children}
    </div>
  );
}
