import React, { forwardRef } from 'react';
import { cn } from '@/utils/cn';
import { rowVariants } from './rowVariants';
import { isFromNestedControl } from './helpers';

/**
 * A selectable row: Files tree rows, the scene stack, analysis list cards,
 * Studio strip cards. Enforces HYBRID rule 4 (focus ≠ selection in form):
 *
 * - selected = the selected fill (`--bf-bg-active`) + 2px inset amber LEFT edge;
 * - keyboard focus = 2px amber ring drawn INSIDE the row, border-aware, with
 *   a 2px gap from the selection edge on both forms:
 *   row  edge 0-1 · gap 2-3 · ring 4-5 (`outline-offset:-6px`);
 *   card border 0 · edge 1-2 · gap 3-4 · ring 5-6 (`outline-offset:-7px`);
 *   so focus + selection reads as edge, gap, ring and never fuses;
 * - hover = neutral hover fill (unselected rows only);
 * - forced colors: selection is a 3px `Highlight` bar, focus the outline
 *   (only the focused row has one: there is no base `outline-none`, whose
 *   transparent outline forced colors would paint on every row).
 *
 * The row is the focusable, clickable element. `role` defaults to `option`
 * (listbox); tree rows pass `role="treeitem"` (plus `aria-level`,
 * `aria-expanded`), cards in a plain list may pass `role="button"`. Rows that
 * contain their own controls (eye toggle, menu) should use `role="row"` with
 * `gridcell` children. `aria-selected` follows `selected` for
 * option/treeitem/row/gridcell.
 *
 * Enter and Space call `onSelect`. A click or key press that starts on a
 * nested interactive control (button, link, input, [role=button], …) does
 * NOT select the row. Roving focus across rows is the container's job: use
 * {@link useRovingFocus} (or pass `tabIndex` yourself: 0 for the active row,
 * -1 otherwise).
 */

export interface SelectableRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  selected?: boolean;
  disabled?: boolean;
  onSelect?: (event: React.SyntheticEvent<HTMLDivElement>) => void;
  variant?: 'row' | 'card';
  /** Tree indentation level (0-based), applied as left padding for `row`. */
  indent?: number;
  /**
   * `false`: the row is presentational chrome inside an element that owns
   * focus and selection (react-arborist's `treeitem` wrapper). No `tabIndex`,
   * no Enter/Space handling, and `aria-selected` only for a selectable
   * `role` (pass `role="none"`/`"presentation"` there). The focus ring is
   * then the owner's job (draw it on this row from the owner's `:focus`).
   */
  focusable?: boolean;
}

const ARIA_SELECTABLE = new Set(['option', 'treeitem', 'row', 'gridcell', 'tab']);

export const SelectableRow = forwardRef<HTMLDivElement, SelectableRowProps>(function SelectableRow(
  {
    selected = false,
    disabled = false,
    onSelect,
    variant = 'row',
    indent = 0,
    role = 'option',
    focusable = true,
    tabIndex,
    className,
    style,
    onClick,
    onKeyDown,
    children,
    ...rest
  },
  ref,
) {
  const ariaSelected = ARIA_SELECTABLE.has(role) ? selected : undefined;
  return (
    <div
      ref={ref}
      role={role}
      aria-selected={ariaSelected}
      aria-pressed={role === 'button' ? selected : undefined}
      aria-disabled={disabled || undefined}
      data-state={selected ? 'selected' : undefined}
      tabIndex={focusable ? (disabled ? -1 : (tabIndex ?? 0)) : tabIndex}
      className={cn(rowVariants({ variant, selected, disabled }), className)}
      style={variant === 'row' ? { paddingLeft: 8 + indent * 12, ...style } : style}
      onClick={(e) => {
        onClick?.(e);
        if (disabled || e.defaultPrevented) return;
        if (isFromNestedControl(e.target, e.currentTarget)) return;
        onSelect?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!focusable || disabled || e.defaultPrevented) return;
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect?.(e);
        }
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
