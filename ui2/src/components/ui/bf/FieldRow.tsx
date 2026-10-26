import React, { forwardRef, useId } from 'react';
import { cva } from 'class-variance-authority';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  childControlId,
  fieldRowIds,
  isLabelableChild,
  LABEL_WIDTH,
  wireFieldControl,
  type FieldControlProps,
  type LabelWidth,
} from './helpers';

export type { FieldControlProps };

/**
 * Label + control row. `layout="inline"` (default): fixed label column on the
 * left, control starting right after it, so every control in a section shares
 * one left x. `layout="stacked"`: label above the control (narrow panes, long
 * controls). Controls are 24px (`H_CONTROL`).
 *
 * The row wires accessibility onto its control, so callers cannot forget it:
 * - the label is always a real `<label for>`; without `controlId` an id is
 *   generated and given to the control;
 * - `hint` / `error` ids go into the control's `aria-describedby` (merged
 *   with any the control already has); `error` sets `aria-invalid`;
 * - `disabled` disables the control, not just the label.
 *
 * Children are either ONE element (the props above are cloned onto it, unless
 * it already sets them) or a render function receiving
 * {@link FieldControlProps} to spread where they belong (e.g. onto the input
 * inside a composite). The error line sits in a polite live region that is
 * present from mount, so an error that appears after an edit is announced.
 *
 * Numeric fields: use {@link NumberField} (`type="number"`) or set
 * `data-numeric="true"` so the document guard normalises pasted "−37.5".
 * Never type units into a field; pass `unit` (a muted suffix outside the
 * editable text).
 */

export interface FieldRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  children: React.ReactElement | ((props: FieldControlProps) => React.ReactNode);
  /** Id of the control; generated when omitted. */
  controlId?: string;
  layout?: 'inline' | 'stacked';
  /** Label column for the inline layout: `narrow` 96px (default) or `wide` 148px. */
  labelWidth?: LabelWidth;
  /** Muted unit suffix after the control ("mm"), never inside the editable text. */
  unit?: React.ReactNode;
  /** Secondary value shown right of the label (stacked) or after the control (inline), mono. */
  meta?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  /**
   * Whether the control can be named by `<label for>`. Detected for a single
   * element child (native tags; Slider/RangeSlider/SegmentedControl are not);
   * pass `false` for a render function whose control is a `<div>` composite.
   * Non-labelable controls get `aria-labelledby` (the label's id) instead.
   */
  labelable?: boolean;
}

const rowVariants = cva('min-w-0 py-1 text-bf-sm', {
  variants: {
    layout: {
      inline: 'grid items-center gap-x-3',
      stacked: 'flex flex-col gap-1',
    },
    disabled: { true: '', false: '' },
  },
  defaultVariants: { layout: 'inline', disabled: false },
});

export const FieldRow = forwardRef<HTMLDivElement, FieldRowProps>(function FieldRow(
  {
    label,
    children,
    controlId,
    layout = 'inline',
    labelWidth = 'narrow',
    unit,
    meta,
    hint,
    error,
    disabled = false,
    labelable,
    className,
    style,
    ...rest
  },
  ref,
) {
  const fallback = useId().replace(/:/g, '');
  // A single child that already has an id keeps it.
  const childId = childControlId(children);
  const id = controlId ?? childId ?? `bf-field-${fallback}`;
  const ids = fieldRowIds(id);
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined;
  const labelId = `${id}-label`;
  const canLabelFor = labelable ?? isLabelableChild(children);
  const control: FieldControlProps = {
    id,
    'aria-labelledby': canLabelFor ? undefined : labelId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    disabled: disabled || undefined,
  };
  const labelTitle = typeof label === 'string' ? label : undefined;
  const labelNode = (
    <label
      htmlFor={canLabelFor ? id : undefined}
      id={labelId}
      title={labelTitle}
      className={cn('min-w-0 truncate text-muted-foreground', disabled && 'opacity-50')}
    >
      {label}
    </label>
  );
  const notes = (
    <>
      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <div id={ids.errorId} className="flex items-center gap-1 text-bf-xs text-bf-danger">
            <AlertCircle aria-hidden className="h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      {hint && !error ? (
        <div id={ids.hintId} className="text-bf-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </>
  );
  const unitNode = unit ? (
    <span className="shrink-0 font-mono text-bf-xs text-muted-foreground">{unit}</span>
  ) : null;
  const metaNode = meta ? (
    <span className="shrink-0 font-mono text-bf-xs tabular-nums text-muted-foreground">{meta}</span>
  ) : null;
  const wired = wireFieldControl(children, control);

  if (layout === 'stacked') {
    return (
      <div
        ref={ref}
        data-invalid={error ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        className={cn(rowVariants({ layout, disabled }), className)}
        style={style}
        {...rest}
      >
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          {labelNode}
          {metaNode}
        </div>
        <div className="flex min-h-6 min-w-0 items-center gap-2">
          {wired}
          {unitNode}
        </div>
        {notes}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-invalid={error ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      className={cn(rowVariants({ layout, disabled }), className)}
      style={{ gridTemplateColumns: `${LABEL_WIDTH[labelWidth]}px minmax(0, 1fr)`, ...style }}
      {...rest}
    >
      {labelNode}
      <div className="flex min-h-6 min-w-0 items-center justify-start gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-start gap-2">
          {wired}
          {unitNode}
        </div>
        {metaNode}
      </div>
      <div className="col-start-2 min-w-0 empty:hidden">{notes}</div>
    </div>
  );
});
