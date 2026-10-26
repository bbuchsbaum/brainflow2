import React, { forwardRef, useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { IconButton } from '../IconButton';
import { wireFieldControl, type FieldControlProps } from './helpers';
import { H_CONTROL } from './states';

// ── Pager ───────────────────────────────────────────────────────────────────

/**
 * Step through an ordered set: "‹ 3 of 6 ›". One form for the Studio member
 * strip ("Previous / Next 3 of 6") and the mosaic pages ("← 4 / 6 →").
 * Two 24px icon buttons named "Previous <noun>" / "Next <noun>" around a
 * mono "3 of 6" readout (a polite live region, so the new position is read
 * after a step). Ends disable the buttons unless `loop`. `page` is 1-based.
 */
export interface PagerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  page: number;
  count: number;
  onPageChange: (page: number) => void;
  /**
   * The step unit, singular ("member", "image", "page"): names the buttons
   * ("Previous page") and, without `label`, the group ("Member 3 of 6").
   */
  noun?: string;
  /**
   * What the pager pages through ("Observations"), when that is not the step
   * unit: the group is then "<label>, <noun> 3 of 6" ("Observations, page 3
   * of 6") while the buttons stay "Previous <noun>" / "Next <noun>". Saves
   * passing a plural as `noun`.
   */
  label?: string;
  loop?: boolean;
  disabled?: boolean;
  /**
   * Show the noun in the readout ("Page 4 of 6"), for a toolbar where a
   * neighbouring readout is also "n of m" ("Slice 49 of 96").
   */
  showNoun?: boolean;
}

export const Pager = forwardRef<HTMLDivElement, PagerProps>(function Pager(
  {
    page,
    count,
    onPageChange,
    noun = 'page',
    label,
    loop = false,
    disabled = false,
    showNoun = false,
    className,
    ...rest
  },
  ref,
) {
  const has = count > 0;
  const atStart = !loop && page <= 1;
  const atEnd = !loop && page >= count;
  const go = (delta: number) => {
    if (!has) return;
    let next = page + delta;
    if (loop) next = ((((next - 1) % count) + count) % count) + 1;
    next = Math.max(1, Math.min(count, next));
    if (next !== page) onPageChange(next);
  };
  return (
    <div
      ref={ref}
      role="group"
      aria-label={
        label
          ? `${label}, ${noun} ${page} of ${count}`
          : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${page} of ${count}`
      }
      className={cn('inline-flex items-center gap-0.5', H_CONTROL, className)}
      {...rest}
    >
      <IconButton
        size="xs"
        icon={<ChevronLeft />}
        aria-label={`Previous ${noun}`}
        disabled={disabled || !has || atStart}
        onClick={() => go(-1)}
      />
      <span
        aria-live="polite"
        className="min-w-[6ch] px-1 text-center font-mono text-bf-xs tabular-nums text-foreground"
      >
        {showNoun ? (
          <span className="font-sans text-muted-foreground">
            {`${noun.charAt(0).toUpperCase()}${noun.slice(1)} `}
          </span>
        ) : null}
        {has ? page : 0}
        <span className="text-muted-foreground"> of </span>
        {count}
      </span>
      <IconButton
        size="xs"
        icon={<ChevronRight />}
        aria-label={`Next ${noun}`}
        disabled={disabled || !has || atEnd}
        onClick={() => go(1)}
      />
    </div>
  );
});

// ── Toolbar ─────────────────────────────────────────────────────────────────

/**
 * A row of labelled controls (the plot dock's Mark / X / Y selects plus
 * toggles): 32px row, 24px controls, sentence-case muted labels BEFORE their
 * control, groups separated by a hairline. Named with `aria-label`.
 *
 * Rendered as `role="group"`, not `role="toolbar"`: its items are selects and
 * fields whose own arrow keys must keep working, so there is no roving focus;
 * Tab moves through the controls in order.
 */
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  'aria-label': string;
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      className={cn('flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1', className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface ToolbarFieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
  /** One control element (wired with id/label) or a render function. */
  children: React.ReactElement | ((props: FieldControlProps) => React.ReactNode);
  controlId?: string;
}

/** "Label control" pair inside a {@link Toolbar}; the label is a real `<label for>`. */
export const ToolbarField = forwardRef<HTMLDivElement, ToolbarFieldProps>(function ToolbarField(
  { label, children, controlId, className, ...rest },
  ref,
) {
  const generated = `bf-tool-${useId().replace(/:/g, '')}`;
  const ownId =
    typeof children !== 'function' && React.isValidElement(children)
      ? ((children.props as { id?: string }).id ?? undefined)
      : undefined;
  const id = controlId ?? ownId ?? generated;
  return (
    <div ref={ref} className={cn('flex min-w-0 items-center gap-1.5', className)} {...rest}>
      <label htmlFor={id} className="shrink-0 text-bf-xs text-muted-foreground">
        {label}
      </label>
      {wireFieldControl(children, { id })}
    </div>
  );
});

/** Hairline between toolbar groups. */
export function ToolbarSeparator() {
  return (
    <span role="separator" aria-orientation="vertical" className="h-4 w-px bg-bf-border-subtle" />
  );
}
