import React, { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';
import { LABEL_WIDTH, splitUnit, type LabelWidth } from './helpers';

/**
 * Facts as a description list (`<dl>`): Data card shape/range/voxel size,
 * image header fields, Studio summaries.
 *
 * - `layout="grid"` (default): label over value, in 1 or 2 columns; a long
 *   value (> `wideAfter` characters) takes the full row instead of truncating.
 * - `layout="rows"`: fixed label column on the left, value on the right.
 *
 * Mono rule: every number and machine identifier (paths, file names, space
 * ids such as "MNI152NLin2009cAsym", codes such as "4 (MNI)") is mono +
 * tabular, which is the default. Only prose ("Linked to the volume
 * crosshair") passes `mono: false`. A trailing unit is kept with its number:
 * the number may truncate (full text in `title`), the unit never wraps away
 * from it. Pass `unit` explicitly, or let a string value ending in a known
 * unit be split. Labels are 11px regular muted (grid) or 12px (rows) and carry
 * a `title` when they are strings, so a truncated label is recoverable.
 */

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  mono?: boolean;
  /** Take the full row in the grid layout. */
  wide?: boolean;
  /** Wrap instead of truncating (overrides the list's `wrap`). */
  wrap?: boolean;
  key?: string;
}

export interface KeyValueProps extends React.HTMLAttributes<HTMLDListElement> {
  items: readonly KeyValueItem[];
  layout?: 'grid' | 'rows';
  columns?: 1 | 2;
  /** Label column for `rows`: `narrow` 96px (default) or `wide` 148px (image header). */
  labelWidth?: LabelWidth;
  /** Bordered sunken box (the Data card) or flush. */
  boxed?: boolean;
  wideAfter?: number;
  /**
   * Values wrap onto further lines instead of truncating: long prose, paths,
   * or a list of {@link Chip}s / other nodes (laid out as a wrapping row with
   * a 4px gap). Per item: `KeyValueItem.wrap`.
   */
  wrap?: boolean;
}

const listVariants = cva('m-0 min-w-0 text-bf-sm', {
  variants: {
    layout: { grid: 'grid gap-x-4 gap-y-2', rows: 'grid gap-x-3 gap-y-1' },
    columns: { 1: '', 2: '' },
    boxed: {
      true: 'rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken p-3',
      false: '',
    },
  },
  compoundVariants: [
    { layout: 'grid', columns: 1, className: 'grid-cols-1' },
    { layout: 'grid', columns: 2, className: 'grid-cols-2' },
  ],
  defaultVariants: { layout: 'grid', columns: 2, boxed: false },
});

function Value({ item, wrap: listWrap }: { item: KeyValueItem; wrap?: boolean }) {
  const mono = item.mono ?? true;
  if (item.wrap ?? listWrap) {
    const text = typeof item.value === 'string' || typeof item.value === 'number';
    return (
      <span
        className={cn(
          'flex min-w-0 flex-wrap gap-1 text-foreground [overflow-wrap:anywhere]',
          text ? 'items-baseline' : 'items-center',
          mono && 'font-mono tabular-nums',
        )}
      >
        {/* Text wraps in one span; a node list (Chips) becomes the wrapping row's items. */}
        {text ? <span className="min-w-0">{item.value}</span> : item.value}
        {item.unit ? <span className="shrink-0 text-muted-foreground">{item.unit}</span> : null}
      </span>
    );
  }
  let number: React.ReactNode = item.value;
  let unit: string | null = item.unit ?? null;
  if (unit === null && typeof item.value === 'string') [number, unit] = splitUnit(item.value);
  const title =
    typeof item.value === 'string' || typeof item.value === 'number'
      ? `${item.value}${item.unit ? ` ${item.unit}` : ''}`
      : undefined;
  return (
    <span
      className={cn(
        'flex min-w-0 items-baseline gap-1 whitespace-nowrap text-foreground',
        mono && 'font-mono tabular-nums',
      )}
      title={title}
    >
      <span className="min-w-0 truncate">{number}</span>
      {unit ? <span className="shrink-0 text-muted-foreground">{unit}</span> : null}
    </span>
  );
}

export const KeyValue = forwardRef<HTMLDListElement, KeyValueProps>(function KeyValue(
  {
    items,
    layout = 'grid',
    columns = 2,
    labelWidth = 'narrow',
    boxed = false,
    wideAfter = 14,
    wrap = false,
    className,
    style,
    ...rest
  },
  ref,
) {
  if (layout === 'rows') {
    return (
      <dl
        ref={ref}
        className={cn(listVariants({ layout, boxed }), className)}
        style={{ gridTemplateColumns: `${LABEL_WIDTH[labelWidth]}px minmax(0, 1fr)`, ...style }}
        {...rest}
      >
        {items.map((item, i) => (
          <React.Fragment key={item.key ?? i}>
            <dt
              className="min-w-0 truncate text-muted-foreground"
              title={typeof item.label === 'string' ? item.label : undefined}
            >
              {item.label}
            </dt>
            <dd className="m-0 min-w-0">
              <Value item={item} wrap={wrap} />
            </dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return (
    <dl
      ref={ref}
      className={cn(listVariants({ layout, columns, boxed }), className)}
      style={style}
      {...rest}
    >
      {items.map((item, i) => {
        const text = typeof item.value === 'string' ? item.value : '';
        const wide = item.wide ?? (columns === 2 && text.length > wideAfter);
        return (
          <div key={item.key ?? i} className={cn('min-w-0', wide && columns === 2 && 'col-span-2')}>
            <dt
              className="truncate text-bf-xs text-muted-foreground"
              title={typeof item.label === 'string' ? item.label : undefined}
            >
              {item.label}
            </dt>
            <dd className="m-0 min-w-0">
              <Value item={item} wrap={wrap} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
});
