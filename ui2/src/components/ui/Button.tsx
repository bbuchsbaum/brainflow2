import React, { forwardRef } from 'react';
import { cn } from '@/utils/cn';
import { FOCUS_GAP, FOCUS_RING } from './bf/states';

/**
 * The product button (also exported from `ui/bf`). Variants: primary (light
 * neutral `--primary` fill, dark text), secondary (raised + bordered), ghost
 * (text, hover fill), danger (soft danger), link (underlined light neutral,
 * HYBRID rule 5; no fill, no fixed height).
 *
 * Sizes: `sm` is the 24px control height (`H_CONTROL`) and the size for
 * panels, toolbars, section actions and dialogs footers alike; `md` / `lg`
 * are 28px (legacy call sites). Focus is the shared outer ring (2px, offset 1,
 * square corners). Any other button attribute (aria-*, data-*, id, form…)
 * passes through, and the ref reaches the `<button>`.
 */
export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  /**
   * Let the label wrap: long link-style actions (an import issue message, a
   * BIDS file path) wrap onto further lines, left-aligned, breaking long
   * unspaced paths anywhere. A non-link button grows from 24px instead of
   * clipping.
   */
  wrap?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

const BASE = cn(
  'inline-flex items-center justify-center whitespace-nowrap font-medium rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  FOCUS_RING,
  // The same dark 1px gap under the ring as segments and chips (one rule,
  // one implementation): the primary fill is light, so amber needs the gap.
  FOCUS_GAP,
);

const BUTTON_VARIANT_CLASSES = {
  // Disabled primary drops the light fill: at 50% opacity the dark label on
  // the light fill measured 1.16:1. It reads as a quiet raised button with
  // muted text instead (about 6:1), never as an "on" state.
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-100 disabled:bg-bf-bg-panel-raised disabled:border disabled:border-border disabled:text-bf-text-muted disabled:hover:bg-bf-bg-panel-raised',
  secondary: 'bg-bf-bg-panel-raised border border-border text-foreground hover:bg-accent',
  danger: 'bg-bf-danger-soft border border-destructive/40 text-bf-danger hover:bg-destructive/25',
  ghost: 'text-bf-text-secondary hover:text-foreground hover:bg-accent',
  // HYBRID rule 5: links are light neutral with a visible underline, never
  // amber. No fill, no fixed height: the link sits on the text baseline.
  link: 'text-foreground underline underline-offset-2 decoration-[var(--bf-border-strong)] hover:decoration-current',
} as const;

const SIZE_CLASSES = {
  sm: 'h-6 gap-1 px-2 text-bf-xs',
  md: 'h-7 gap-1.5 px-2.5 text-bf-sm',
  lg: 'h-7 gap-1.5 px-4 text-bf-md',
} as const;

const WRAP_CLASSES =
  'h-auto whitespace-normal justify-start text-left [overflow-wrap:anywhere]';
const WRAP_PADDED_CLASSES = 'min-h-6 py-0.5';

const LINK_SIZE_CLASSES = {
  sm: 'h-auto px-0 text-bf-xs',
  md: 'h-auto px-0 text-bf-sm',
  lg: 'h-auto px-0 text-bf-md',
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    icon,
    iconPosition = 'left',
    wrap = false,
    className = '',
    type = 'button',
    ...rest
  },
  ref,
) {
  // cn (tailwind-merge) lets a caller's className override base classes of the
  // same group (e.g. `disabled:opacity-100` beats the base `disabled:opacity-50`).
  const classes = cn(
    BASE,
    BUTTON_VARIANT_CLASSES[variant],
    variant === 'link' ? LINK_SIZE_CLASSES[size] : SIZE_CLASSES[size],
    wrap && WRAP_CLASSES,
    wrap && variant !== 'link' && WRAP_PADDED_CLASSES,
    className,
  );

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <svg
            className="-ml-0.5 h-3.5 w-3.5 motion-safe:animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading...
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' ? (
            <span aria-hidden className="flex shrink-0">
              {icon}
            </span>
          ) : null}
          {children}
          {icon && iconPosition === 'right' ? (
            <span aria-hidden className="flex shrink-0">
              {icon}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
});
