import React, { forwardRef, useEffect, useRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';
import { NON_LABELABLE } from './helpers';
import { DISABLED, EDGE_ACCENT, FOCUS_GAP, FOCUS_RING, HOVER_FILL, SEGMENT_ACTIVE, SELECTED_FILL } from './states';

/**
 * Joined segmented group (V5 navigation kind 2): switches a view's MODE.
 * Top bar workspace switcher, Studio lens, plot modes, Go-to World/Voxel,
 * crosshair styles. One bordered group of 24px items (26px overall with the
 * 1px border), 1px internal dividers; every item is at least 24px wide, so a
 * one-letter segment ("X") is still a 24px target.
 *
 * Single-select radio semantics (`role="radiogroup"` / `role="radio"`): one
 * tab stop on the checked item, Home/End jump. `activation="automatic"`
 * (default): arrows move AND select. `activation="manual"`: arrows move focus
 * only and Enter/Space select (use it when a change is expensive, e.g. the
 * top-bar workspace switcher, which mounts a whole layout per mode).
 * A group with one option has nothing to choose and renders nothing
 * (`hideWhenSingle`, default true); `singleLabel` renders the one option's
 * label as plain text instead (a caller that still wants the mode named).
 *
 * Active = the light-neutral `--primary` fill with dark text, no outline and
 * no bottom edge (user decision 2026-10-26, HYBRID rule 2; the same "on" as a
 * pressed FilterChip and an on Switch). Flat tabs keep the bottom edge, so a
 * value choice and a navigation tab differ in form at a glance. The focus
 * ring keeps a dark 1px gap (`FOCUS_GAP`) so amber never sits on the light
 * fill. `edge="accent"` is reserved for the top-bar workspace switcher, which
 * keeps the raised fill + amber bottom edge (hidden under keyboard focus).
 * `size="md"` (28px group, `text-bf-sm`) is for that switcher only: app-level
 * navigation outranks in-panel segmented controls.
 *
 * A name is required: pass `aria-label` or `aria-labelledby` (enforced by the
 * type, and warned about in development).
 */

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  /** Accessible name when `label` is icon-only or abbreviated. */
  'aria-label'?: string;
  /** `data-testid` on the segment button. */
  testId?: string;
  /** Extra `data-*` attributes on the segment button (e.g. `{ 'data-active': 'true' }`). */
  data?: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>;
}

interface SegmentedControlBaseProps
  extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    'onChange' | 'defaultValue' | 'aria-label' | 'aria-labelledby'
  > {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  edge?: 'neutral' | 'accent';
  /** Items share the group width equally. */
  fullWidth?: boolean;
  /** Render nothing when there is a single option (default true). */
  hideWhenSingle?: boolean;
  /**
   * With a single option, render its label as plain text (no group, no
   * radio) instead of nothing. Takes precedence over `hideWhenSingle`.
   */
  singleLabel?: boolean;
  /**
   * `automatic` (default): arrow keys move focus and select.
   * `manual`: arrow keys move focus only; Enter / Space (or a click) select.
   */
  activation?: 'automatic' | 'manual';
  /** `sm` (default): 24px group. `md`: 28px group, `text-bf-sm` (top-bar switcher only). */
  size?: 'sm' | 'md';
  disabled?: boolean;
  /**
   * Called when the already-checked item is clicked: for choices that are
   * also actions (a camera preset re-applied after the user orbits).
   */
  onReselect?: (value: string) => void;
}

/** A radiogroup must be named: `aria-label` or `aria-labelledby` is required. */
export type SegmentedControlProps = SegmentedControlBaseProps &
  (
    | { 'aria-label': string; 'aria-labelledby'?: string }
    | { 'aria-label'?: string; 'aria-labelledby': string }
  );

const itemVariants = cva(
  [
    'relative inline-flex min-w-6 items-center justify-center gap-1 whitespace-nowrap border-r border-bf-border-subtle transition-colors last:border-r-0',
    FOCUS_RING,
    DISABLED,
  ],
  {
    variants: {
      checked: {
        true: 'font-medium',
        false: cn(
          'bg-transparent text-muted-foreground hover:text-foreground data-[force-hover]:text-foreground',
          HOVER_FILL,
        ),
      },
      edge: { neutral: '', accent: '' },
      fullWidth: { true: 'flex-1', false: '' },
      size: { sm: 'h-6 px-2 text-bf-xs', md: 'h-[26px] px-3 text-bf-sm' },
    },
    compoundVariants: [
      { edge: 'neutral', className: FOCUS_GAP },
      { checked: true, edge: 'neutral', className: SEGMENT_ACTIVE },
      { checked: true, edge: 'accent', className: cn(SELECTED_FILL, 'text-foreground', EDGE_ACCENT) },
    ],
    defaultVariants: { checked: false, edge: 'neutral', fullWidth: false, size: 'sm' },
  },
);

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(
    {
      options,
      value,
      onValueChange,
      edge = 'neutral',
      fullWidth = false,
      hideWhenSingle = true,
      singleLabel = false,
      activation = 'automatic',
      size = 'sm',
      disabled = false,
      onReselect,
      className,
      ...rest
    },
    ref,
  ) {
    const refs = useRef(new Map<string, HTMLButtonElement>());
    const named = Boolean(rest['aria-label'] || rest['aria-labelledby']);
    useEffect(() => {
      if (import.meta.env.DEV && !named) {
        console.warn(
          '[bf/SegmentedControl] unnamed radiogroup: pass aria-label or aria-labelledby.',
        );
      }
    }, [named]);
    if (singleLabel && options.length === 1) {
      const only = options[0];
      const {
        'aria-label': _label,
        'aria-labelledby': _labelledby,
        ...spanRest
      } = rest as React.HTMLAttributes<HTMLDivElement>;
      return (
        <span
          ref={ref as React.Ref<HTMLSpanElement>}
          data-single-label=""
          title={only.title}
          className={cn(
            'inline-flex h-6 items-center gap-1 whitespace-nowrap text-bf-xs text-muted-foreground',
            className,
          )}
          {...spanRest}
        >
          {only.icon ? (
            <span aria-hidden className="flex shrink-0">
              {only.icon}
            </span>
          ) : null}
          {only.label}
        </span>
      );
    }
    if (hideWhenSingle && options.length <= 1) return null;

    const enabled = options.filter((o) => !o.disabled && !disabled);
    const stop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

    const onKeyDown = (current: string) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (enabled.length === 0) return;
      const i = enabled.findIndex((o) => o.value === current);
      let next: string | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = enabled[(i + 1) % enabled.length].value;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = enabled[(i - 1 + enabled.length) % enabled.length].value;
          break;
        case 'Home':
          next = enabled[0].value;
          break;
        case 'End':
          next = enabled[enabled.length - 1].value;
          break;
        default:
          return;
      }
      e.preventDefault();
      refs.current.get(next)?.focus();
      if (activation === 'automatic' && next !== value) onValueChange(next);
    };

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-disabled={disabled || undefined}
        data-activation={activation}
        className={cn(
          'inline-flex items-stretch rounded-sm border border-bf-border',
          fullWidth && 'flex w-full',
          className,
        )}
        {...rest}
      >
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                if (el) refs.current.set(option.value, el);
                else refs.current.delete(option.value);
              }}
              {...option.data}
              data-testid={option.testId}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option['aria-label']}
              data-state={checked ? 'on' : 'off'}
              title={option.title}
              disabled={disabled || option.disabled}
              tabIndex={option.value === stop ? 0 : -1}
              onClick={() => {
                if (!checked) onValueChange(option.value);
                else onReselect?.(option.value);
              }}
              onKeyDown={onKeyDown(option.value)}
              className={itemVariants({ checked, edge, fullWidth, size })}
            >
              {option.icon ? (
                <span aria-hidden className="flex shrink-0">
                  {option.icon}
                </span>
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
    );
  },
);

// FieldRow: a radiogroup is named with aria-labelledby, not <label for>.
(SegmentedControl as unknown as Record<string, unknown>)[NON_LABELABLE] = true;
