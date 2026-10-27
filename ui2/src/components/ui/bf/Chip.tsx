import React, { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { IconButton } from '../IconButton';
import { DISABLED, FOCUS_GAP, FOCUS_RING, H_CONTROL, H_TAG, ON_FILL } from './states';

/**
 * Two deliberately different chip forms, so a static tag can never be
 * mistaken for a control:
 *
 * - `Chip`: a static tag ("Sidecar", "v1.2.0", "volume", "Demo data").
 *   20px, filled `--bf-bg-panel-raised`, NO border, not focusable.
 * - `FilterChip`: an interactive toggle ("sub-01", "control", "Linear Y").
 *   24px, bordered, `aria-pressed`; pressed = the one "on" look shared with
 *   the active segment (light `--primary` fill, dark text, no bottom edge:
 *   the bottom edge is a tab cue only); focus = the outer square ring with a
 *   dark gap so it reads against the light fill.
 *   The accessible name separates label and count ("control, 12").
 */

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Mono text (versions, ids, extensions). */
  mono?: boolean;
  icon?: React.ReactNode;
  /**
   * Adds a remove button after the tag: a 24px ghost IconButton (the chip
   * itself stays a static, unfocusable tag). Named "Remove <label>".
   */
  onRemove?: () => void;
  /** Text naming the chip in the remove button ("Remove <removeLabel>"); default: string children. */
  removeLabel?: string;
  /** Full accessible name of the remove button; overrides "Remove <label>". */
  removeAriaLabel?: string;
}

const chipVariants = cva(
  cn(
    'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-bf-bg-panel-raised px-1.5 text-bf-xs text-bf-text-secondary',
    H_TAG,
  ),
  {
    variants: { mono: { true: 'font-mono tabular-nums', false: '' } },
    defaultVariants: { mono: false },
  },
);

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { mono = false, icon, className, children, title, onRemove, removeLabel, removeAriaLabel, ...rest },
  ref,
) {
  const textChildren =
    typeof children === 'string' || typeof children === 'number' ? String(children) : undefined;
  const autoTitle = title ?? textChildren;
  const tag = (
    <span
      ref={onRemove ? undefined : ref}
      title={autoTitle}
      className={cn(chipVariants({ mono }), className)}
      {...(onRemove ? {} : rest)}
    >
      {icon ? (
        <span aria-hidden className="flex shrink-0 text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
  if (!onRemove) return tag;
  const name = removeLabel ?? textChildren ?? title ?? 'item';
  // The tag and its 24px remove target side by side; the wrapper takes the
  // ref and any extra attributes (data-*, aria-*).
  return (
    <span ref={ref} className="inline-flex min-w-0 max-w-full shrink-0 items-center" {...rest}>
      {tag}
      <IconButton
        size="xs"
        icon={<X />}
        aria-label={removeAriaLabel ?? `Remove ${name}`}
        title={removeAriaLabel ?? `Remove ${name}`}
        onClick={onRemove}
      />
    </span>
  );
});

export interface FilterChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
  /** Trailing count ("42"), mono. */
  count?: React.ReactNode;
  icon?: React.ReactNode;
}

const filterVariants = cva(
  [
    'relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-bf-xs transition-colors',
    H_CONTROL,
    FOCUS_RING,
    FOCUS_GAP,
    DISABLED,
  ],
  {
    variants: {
      pressed: {
        true: cn(
          'border-primary font-medium hover:border-[hsl(var(--foreground))] data-[force-hover]:border-[hsl(var(--foreground))]',
          ON_FILL,
        ),
        false:
          'border-bf-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground data-[force-hover]:bg-accent data-[force-hover]:text-foreground',
      },
    },
    defaultVariants: { pressed: false },
  },
);

export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { pressed, onPressedChange, count, icon, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  // Name = "label, count" (never "control12"); text children get an explicit name.
  const textLabel =
    typeof children === 'string' || typeof children === 'number' ? String(children) : null;
  const name =
    count !== undefined && textLabel !== null && (typeof count === 'string' || typeof count === 'number')
      ? `${textLabel}, ${count}`
      : undefined;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={rest['aria-label'] ?? name}
      aria-pressed={pressed}
      data-state={pressed ? 'on' : 'off'}
      className={cn(filterVariants({ pressed }), className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onPressedChange?.(!pressed);
      }}
      {...rest}
    >
      {icon ? (
        <span aria-hidden className="flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
      {count !== undefined ? (
        <>
          <span className="sr-only">, </span>
          <span
            className={cn(
              'font-mono tabular-nums',
              pressed ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
          >
            {count}
          </span>
        </>
      ) : null}
    </button>
  );
});
