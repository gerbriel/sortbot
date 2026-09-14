import { forwardRef, useId } from 'react';
import type {
  InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';
import './base.css';
import './Field.css';

/**
 * Props a `Field` hands to its control. Spread them onto the input so the
 * label, hint and error are all wired without the caller inventing ids.
 */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
  className: string;
}

export interface FieldProps {
  /** Visible label text. Always rendered — a placeholder is not a label. */
  label: string;
  /** Helper text under the control. Announced via `aria-describedby`. */
  hint?: ReactNode;
  /**
   * Validation message. When set, the control gets `aria-invalid` and the
   * message joins `aria-describedby`, so it is read WITH the field rather than
   * discovered later.
   */
  error?: ReactNode;
  /** Marks the field required (visual asterisk + `aria-required`). */
  required?: boolean;
  /** Uppercases the label, matching the app's dense section-label style. */
  caps?: boolean;
  /** Label beside the control instead of above (for a checkbox or a short numeric input). */
  inline?: boolean;
  /** Character counter, e.g. for the Shopify 70-char SEO title limit. */
  counter?: { value: number; max: number };
  /** Hides the label visually but keeps it for assistive tech. */
  labelHidden?: boolean;
  className?: string;
  /**
   * The control. Pass a function to receive the wired props
   * (`{(f) => <input {...f} />}`); pass an element for a custom control you
   * will label yourself.
   */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

/**
 * Label + control + hint + error, with the id wiring done once.
 *
 * WHY A RENDER CALLBACK instead of cloning children: cloning silently drops
 * props when the child is a wrapper component, and `React.cloneElement` cannot
 * be type-checked against an unknown child. The callback form makes the
 * contract explicit and type-safe, and `TextField` / `TextareaField` /
 * `SelectField` below hide it for the 95% case.
 *
 * ```tsx
 * <Field label="Store domain" hint="myshop.myshopify.com" error={err} required>
 *   {(f) => <input {...f} value={domain} onChange={(e) => setDomain(e.target.value)} />}
 * </Field>
 * ```
 */
export function Field({
  label, hint, error, required = false, caps = false, inline = false,
  counter, labelHidden = false, className, children,
}: FieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  // Error first: it is the more urgent of the two and screen readers read
  // aria-describedby in order.
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
    className: 'ui-input',
  };

  const overCounter = counter ? counter.value > counter.max : false;

  return (
    <div className={['ui-field', inline ? 'ui-field--inline' : '', className].filter(Boolean).join(' ')}>
      <label
        htmlFor={controlId}
        className={[
          labelHidden ? 'ui-sr-only' : 'ui-field__label',
          caps && !labelHidden ? 'ui-field__label--caps' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {label}
        {required && <span aria-hidden="true" className="ui-field__required">*</span>}
      </label>

      <div className="ui-field__control">
        {typeof children === 'function' ? children(control) : children}
      </div>

      {(hint || error || counter) && (
        <div className="ui-field__footer">
          <span className="ui-field__messages">
            {/* role=alert so a message that appears after a failed submit is
                announced without the user having to re-focus the field. Both
                nodes render when both exist — aria-describedby points at each
                by id, so neither may be dropped. */}
            {error && <span id={errorId} role="alert" className="ui-field__error">{error}</span>}
            {hint && <span id={hintId} className="ui-field__hint">{hint}</span>}
          </span>
          {counter && (
            <span className={['ui-field__counter', overCounter ? 'ui-field__counter--over' : ''].filter(Boolean).join(' ')}>
              {counter.value}/{counter.max}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type SharedFieldProps = Pick<
  FieldProps,
  'label' | 'hint' | 'error' | 'required' | 'caps' | 'inline' | 'counter' | 'labelHidden' | 'className'
>;

export interface TextFieldProps
  extends SharedFieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  /** Compact height for toolbar-density inputs. */
  inputSize?: 'sm' | 'md';
  /** Extra classes for the `<input>` itself (the outer wrapper takes `className`). */
  inputClassName?: string;
}

/** `Field` + `<input>`. The common case. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, required, caps, inline, counter, labelHidden, className,
    inputSize = 'md', inputClassName, ...inputProps },
  ref,
) {
  return (
    <Field
      label={label} hint={hint} error={error} required={required} caps={caps}
      inline={inline} counter={counter} labelHidden={labelHidden} className={className}
    >
      {(f) => (
        <input
          {...inputProps}
          {...f}
          ref={ref}
          required={required}
          className={[f.className, inputSize === 'sm' ? 'ui-input--sm' : '', inputClassName]
            .filter(Boolean)
            .join(' ')}
        />
      )}
    </Field>
  );
});

export interface TextareaFieldProps
  extends SharedFieldProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'> {
  inputClassName?: string;
}

/** `Field` + `<textarea>`. Vertical resize only, so it cannot break a grid. */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { label, hint, error, required, caps, inline, counter, labelHidden, className, inputClassName, ...textareaProps },
  ref,
) {
  return (
    <Field
      label={label} hint={hint} error={error} required={required} caps={caps}
      inline={inline} counter={counter} labelHidden={labelHidden} className={className}
    >
      {(f) => (
        <textarea
          {...textareaProps}
          {...f}
          ref={ref}
          required={required}
          className={[f.className, 'ui-input--textarea', inputClassName].filter(Boolean).join(' ')}
        />
      )}
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps
  extends SharedFieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id' | 'children'> {
  options: SelectOption[];
  /** Leading empty option, e.g. `'Choose a workspace…'`. */
  placeholder?: string;
  inputSize?: 'sm' | 'md';
  inputClassName?: string;
}

/** `Field` + native `<select>`. Native on purpose: it is the accessible default and free on mobile. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, required, caps, inline, labelHidden, className,
    options, placeholder, inputSize = 'md', inputClassName, ...selectProps },
  ref,
) {
  return (
    <Field
      label={label} hint={hint} error={error} required={required} caps={caps}
      inline={inline} labelHidden={labelHidden} className={className}
    >
      {(f) => (
        <select
          {...selectProps}
          {...f}
          ref={ref}
          required={required}
          className={[f.className, 'ui-input--select', inputSize === 'sm' ? 'ui-input--sm' : '', inputClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
});
