import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { DISABLED, FOCUS_RING, H_CONTROL } from './states';

/**
 * Text entry and choice controls at the 24px control height (`H_CONTROL`):
 * {@link TextField}, {@link NumberField}, {@link Select}. All take the
 * FieldRow wiring (`id`, `aria-describedby`, `aria-invalid`, `disabled`) as
 * plain props, so `<FieldRow label="Origin x"><NumberField … /></FieldRow>`
 * is fully labelled and described with no extra code.
 *
 * Invalid = danger border + `aria-invalid`; pair it with a message (FieldRow
 * `error`). Units are never typed into a field: NumberField renders `unit` as
 * a muted suffix outside the editable text.
 */

/**
 * The one border of every field-like control (TextField, NumberField, Select,
 * TextArea, ColorInput): `--bf-border-field` (>= 3:1 against the panel and the
 * field ground, WCAG 1.4.11, so an empty field is still identifiable), and the
 * brighter `--bf-text-muted` on hover.
 */
export const FIELD_BORDER = 'border border-bf-border-field hover:border-bf-text-muted';

const BOX = cn(
  'min-w-0 rounded-sm bg-bf-bg-input text-bf-xs text-foreground transition-colors',
  FIELD_BORDER,
  H_CONTROL,
);

const INVALID = 'border-bf-danger hover:border-bf-danger';

// ── TextField ───────────────────────────────────────────────────────────────

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  /** Mono text (paths, ids). */
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { invalid, mono = false, className, type = 'text', 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const isInvalid = Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true');
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={isInvalid || undefined}
      className={cn(
        BOX,
        'w-full px-1.5 placeholder:text-bf-text-faint',
        FOCUS_RING,
        DISABLED,
        mono && 'font-mono',
        isInvalid && INVALID,
        className,
      )}
      {...rest}
    />
  );
});

// ── NumberField ─────────────────────────────────────────────────────────────

export interface NumberFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'size' | 'value' | 'defaultValue'
  > {
  value?: number | string | null;
  defaultValue?: number | string;
  /** Parsed value on every edit: a finite number, or null when empty / not a number. */
  onValueChange?: (value: number | null, event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Muted unit suffix outside the editable text ("mm"). */
  unit?: React.ReactNode;
  invalid?: boolean;
  /** Width of the whole field (box + suffix); default fills the row. */
  fieldClassName?: string;
}

/**
 * `<input type="number">` (native stepping, `validity.badInput`) with
 * `data-numeric="true"`, so the document guard turns a pasted "−37.5" into
 * -37.5 instead of +37.5. Text the browser cannot parse ("abc", "12 mm")
 * reports `badInput`, which marks the field invalid (`aria-invalid`,
 * `data-bad-input`) until the next valid edit. Mono, tabular digits.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    value,
    defaultValue,
    onValueChange,
    onChange,
    unit,
    invalid,
    className,
    fieldClassName,
    disabled,
    onBlur,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
) {
  const [badInput, setBadInput] = useState(false);
  const isInvalid = Boolean(invalid || badInput || ariaInvalid === true || ariaInvalid === 'true');
  // No wheel stepping: Chrome nudges a FOCUSED, hovered number input on
  // wheel (−0.5 → −0.3 in Go-to after two ticks, with no cue). The guard
  // cancels the wheel only while this input has focus, so over an unfocused
  // field the page/panel still scrolls. React's onWheel is passive, hence a
  // native non-passive listener.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    },
    [ref],
  );
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.ownerDocument.activeElement === el) event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return (
    <span
      className={cn(
        BOX,
        'relative inline-flex w-full items-center focus-within:z-10 focus-within:rounded-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--bf-border-focus)]',
        isInvalid && INVALID,
        disabled && 'cursor-not-allowed opacity-50',
        fieldClassName,
      )}
      data-bad-input={badInput ? '' : undefined}
    >
      <input
        ref={setRefs}
        type="number"
        inputMode="decimal"
        data-numeric="true"
        // Numbers are never words: no macOS autocorrect bubble (Go-to).
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        value={value === null ? '' : value}
        defaultValue={defaultValue}
        onChange={(e) => {
          const bad = e.currentTarget.validity.badInput;
          if (bad !== badInput) setBadInput(bad);
          onChange?.(e);
          const n = e.currentTarget.valueAsNumber;
          onValueChange?.(Number.isFinite(n) ? n : null, e);
        }}
        onBlur={(e) => {
          const bad = e.currentTarget.validity.badInput;
          if (bad !== badInput) setBadInput(bad);
          onBlur?.(e);
        }}
        className={cn(
          // One ring only: the wrapper draws it (:focus-within), so the input
          // suppresses the global :focus-visible outline (which would otherwise
          // be a second, inner ring crossing the unit suffix). Native spinners
          // are hidden: ArrowUp/Down already step, and the spinner sat on the unit.
          'h-full min-w-0 flex-1 bg-transparent px-1.5 font-mono tabular-nums border-0 text-foreground outline-0 focus:[outline:none] focus-visible:[outline:none] disabled:cursor-not-allowed',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none',
          className,
        )}
        {...rest}
      />
      {unit ? (
        <span aria-hidden className="shrink-0 pr-1.5 font-mono text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </span>
  );
});

// ── Select ──────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'onChange'> {
  options?: readonly SelectOption[];
  onValueChange?: (value: string, event: React.ChangeEvent<HTMLSelectElement>) => void;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  invalid?: boolean;
}

/**
 * Native single-choice select with the app's `bf-select` look (flat dark box,
 * chevron gutter) at 24px. Native keeps platform keyboard/typeahead and works
 * inside GoldenLayout roots without a portal. Pass `options` or `<option>`
 * children.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    options,
    children,
    onValueChange,
    onChange,
    invalid,
    className,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
) {
  const isInvalid = Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true');
  return (
    <select
      ref={ref}
      aria-invalid={isInvalid || undefined}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.currentTarget.value, e);
      }}
      className={cn(
        'bf-select w-full min-w-0 text-bf-xs',
        H_CONTROL,
        FOCUS_RING,
        DISABLED,
        // The global `select.bf-select` rule (theme.css) outranks a plain
        // utility, so the field border is applied with `.bf-select` in the
        // selector: the same token as every other field.
        isInvalid
          ? '[&.bf-select]:border-bf-danger [&.bf-select:hover]:border-bf-danger'
          : '[&.bf-select]:border-bf-border-field [&.bf-select:hover]:border-bf-text-muted',
        className,
      )}
      {...rest}
    >
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
});

// ── Switch ──────────────────────────────────────────────────────────────────

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label after the switch (part of the 24px target). Else pass aria-label. */
  children?: React.ReactNode;
}

/**
 * On/off switch (`role="switch"`). 24px target; a 28×14 track with a square
 * 10px thumb (2px radii, instrument look). On = light-neutral `--primary`
 * track (HYBRID rule 2), dark thumb at the right; off = sunken track with a
 * muted thumb at the left. Position, not only colour, carries the state, so
 * it survives forced colors.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, children, className, onClick, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'on' : 'off'}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        'group/switch inline-flex shrink-0 items-center gap-2 rounded-sm text-bf-sm text-foreground',
        H_CONTROL,
        FOCUS_RING,
        DISABLED,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-block h-3.5 w-7 shrink-0 rounded-sm border transition-colors forced-colors:border-[ButtonText]',
          checked
            ? 'border-primary bg-primary'
            : 'border-bf-border-strong bg-bf-bg-panel-sunken group-hover/switch:border-bf-text-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[1px] transition-[left] forced-colors:bg-[ButtonText] forced-colors:[forced-color-adjust:none]',
            checked
              ? 'left-[calc(100%-12px)] bg-primary-foreground'
              : 'left-[1px] bg-bf-text-muted',
          )}
        />
      </span>
      {children ? <span className="min-w-0 truncate">{children}</span> : null}
    </button>
  );
});

// ── TextArea ────────────────────────────────────────────────────────────────

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Mono text (JSON, code, paths). */
  mono?: boolean;
}

/**
 * Multi-line text entry (analysis parameter JSON, notes). Same box, hover,
 * invalid and focus treatment as {@link TextField}; height comes from `rows`
 * or a `min-h-*` class and the user can resize vertically. Takes the FieldRow
 * wiring as plain props.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, mono = false, className, 'aria-invalid': ariaInvalid, rows = 4, ...rest },
  ref,
) {
  const isInvalid = Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true');
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={isInvalid || undefined}
      className={cn(
        'block min-w-0 w-full resize-y rounded-sm bg-bf-bg-input px-2 py-1.5 text-bf-sm text-foreground transition-colors placeholder:text-bf-text-faint',
        FIELD_BORDER,
        FOCUS_RING,
        DISABLED,
        mono && 'font-mono',
        isInvalid && INVALID,
        className,
      )}
      {...rest}
    />
  );
});

// ── Checkbox ────────────────────────────────────────────────────────────────

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'children'> {
  /** Called with the new checked state (after `onChange`). */
  onCheckedChange?: (checked: boolean, event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Visible label; the whole row is the click target. Omit inside a FieldRow. */
  children?: React.ReactNode;
  /** Class of the outer `<label>` (or the 24px box wrapper without children). */
  className?: string;
}

/**
 * A native checkbox (`<input type="checkbox">`, so forms, `checked`,
 * `indeterminate` and assistive tech behave natively) drawn in the token
 * style: 14px box in a 24px target, `--primary` fill + check when checked,
 * the outer focus ring on the box. With `children` the label text sits after
 * the box (wrapping text aligns to the first line) and clicking it toggles.
 * Takes the FieldRow wiring (`id`, `aria-describedby`, `disabled`) as props;
 * the ref reaches the input.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { onCheckedChange, onChange, children, className, disabled, ...rest },
  ref,
) {
  const box = (
    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        onChange={(e) => {
          onChange?.(e);
          onCheckedChange?.(e.target.checked, e);
        }}
        className={cn(
          'peer m-0 h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none rounded-[2px] border border-bf-border-strong bg-bf-bg-panel-sunken transition-colors',
          'hover:border-bf-text-muted checked:border-primary checked:bg-primary',
          'forced-colors:appearance-auto',
          'disabled:cursor-not-allowed disabled:opacity-50',
          FOCUS_RING,
        )}
        {...rest}
      />
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute hidden h-2.5 w-2.5 text-primary-foreground peer-checked:block forced-colors:!hidden"
      >
        <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    </span>
  );
  if (children === undefined || children === null) {
    return <span className={cn('inline-flex shrink-0', className)}>{box}</span>;
  }
  return (
    <label
      className={cn(
        'inline-flex min-w-0 items-start gap-1 text-bf-sm text-foreground',
        // The box already dims itself; the label text only goes muted (no double fade).
        disabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer',
        className,
      )}
    >
      {box}
      <span className="min-w-0 py-1 leading-4">{children}</span>
    </label>
  );
});

// ── ColorInput ──────────────────────────────────────────────────────────────

export interface ColorInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'size' | 'value' | 'onChange'
  > {
  /** `#rrggbb`. */
  value: string;
  onValueChange?: (value: string, event: React.ChangeEvent<HTMLInputElement>) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Show the hex value after the swatch, mono. */
  showValue?: boolean;
  /** Class of the swatch input. */
  className?: string;
}

/**
 * A native colour picker (`<input type="color">`) at the 24px control height:
 * bordered swatch on the input ground, hover border, the outer focus ring.
 * `showValue` adds the mono hex readout after it. Takes the FieldRow wiring
 * as props; the ref reaches the input. Name it with a FieldRow label or
 * `aria-label`.
 */
export const ColorInput = forwardRef<HTMLInputElement, ColorInputProps>(function ColorInput(
  { value, onValueChange, onChange, showValue = false, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      type="color"
      value={value}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value, e);
      }}
      className={cn(
        'h-6 w-10 shrink-0 cursor-pointer rounded-sm bg-bf-bg-input p-0.5 transition-colors',
        FIELD_BORDER,
        '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[1px] [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:border-0',
        FOCUS_RING,
        DISABLED,
        className,
      )}
      {...rest}
    />
  );
  if (!showValue) return input;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {input}
      <span className="font-mono text-bf-xs tabular-nums text-muted-foreground">{value}</span>
    </span>
  );
});
