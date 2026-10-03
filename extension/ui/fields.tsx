import {
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { Field, inputWrapperStyles } from '@astryxdesign/core/Field';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import * as stylex from '@stylexjs/stylex';

type LabelProps = { label: string; hint?: string; error?: string; hideLabel?: boolean };
// Astryx's Field/input primitives retain native URL/number/select semantics,
// including incomplete numeric drafts, browser validation and option disabling.
export function Input({
  label,
  hint,
  error,
  hideLabel,
  ...props
}: LabelProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  const appearance = stylex.props(inputWrapperStyles.base);
  return (
    <div className="field">
      <Field label={label} inputID={id} isLabelHidden={hideLabel}>
        <input
          {...appearance}
          {...props}
          id={id}
          className={`${appearance.className} native-control ${props.className ?? ''}`}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={hint ? `${id}-hint` : props['aria-describedby']}
        />
      </Field>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="is-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  hideLabel,
  children,
  ...props
}: LabelProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <div className="field">
      <Field label={label} inputID={id} isLabelHidden={hideLabel}>
        <select
          {...props}
          id={id}
          className={`native-control ${props.className ?? ''}`}
          aria-invalid={error ? true : props['aria-invalid']}
        >
          {children}
        </select>
      </Field>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  ...props
}: LabelProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <div className="field">
      <Field label={label} inputID={id} isLabelHidden={hideLabel}>
        <textarea
          {...props}
          id={id}
          className={`native-control ${props.className ?? ''}`}
          aria-invalid={error ? true : props['aria-invalid']}
        />
      </Field>
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
  return (
    <div className="field" id={id}>
      <CheckboxInput label={label} value={checked} onChange={onChange} />
      {hint ? <p className="hint">{hint}</p> : null}
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
