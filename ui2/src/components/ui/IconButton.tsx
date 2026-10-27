import React, { forwardRef } from 'react';
import { cn } from '@/utils/cn';
import { FOCUS_RING } from './bf/states';

/**
 * Icon-only button (also exported from `ui/bf`). `aria-label` is required.
 *
 * Sizes: `xs` is the 24×24 control (`H_CONTROL`, 14px glyph) used in panels,
 * toolbars, pagers and section actions; `sm` (28px), `md` and `lg` remain for
 * existing call sites. `pressed` makes it a toggle (`aria-pressed`, selected
 * fill + neutral bottom edge). Other button attributes pass through.
 */
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  /** Toggle state; omit for a plain action button. */
  pressed?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label': string;
}

const BASE = cn(
  'relative inline-flex shrink-0 items-center justify-center font-medium rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  FOCUS_RING,
);

const VARIANT_CLASSES = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-bf-bg-panel-raised border border-border text-foreground hover:bg-accent',
  danger: 'bg-bf-danger-soft border border-destructive/40 text-bf-danger hover:bg-destructive/25',
  ghost: 'text-bf-text-secondary hover:text-foreground hover:bg-accent',
} as const;

const SIZE_CLASSES = {
  xs: 'h-6 w-6 p-0',
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
} as const;

const ICON_SIZE_CLASSES = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
} as const;

const PRESSED =
  "bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)] forced-colors:after:absolute forced-colors:after:inset-x-0 forced-colors:after:bottom-0 forced-colors:after:h-[3px] forced-colors:after:bg-[Highlight] forced-colors:after:content-[''] forced-colors:after:[forced-color-adjust:none]";

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    variant = 'ghost',
    size = 'md',
    disabled = false,
    loading = false,
    pressed,
    className = '',
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = cn(
    BASE,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    pressed && PRESSED,
    className,
  );

  const iconElement = React.isValidElement(icon)
    ? React.cloneElement(
        icon as React.ReactElement<{ className?: string; 'aria-hidden'?: boolean }>,
        {
          className: ICON_SIZE_CLASSES[size],
          'aria-hidden': true,
        },
      )
    : icon;

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <svg
          className={cn('motion-safe:animate-spin', ICON_SIZE_CLASSES[size])}
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
      ) : (
        iconElement
      )}
    </button>
  );
});
