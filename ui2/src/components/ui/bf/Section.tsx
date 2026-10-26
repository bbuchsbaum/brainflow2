import React, { forwardRef, useId, useState } from 'react';
import { cva } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import { FOCUS_RING_INSET, H_SECTION_HEADER, HOVER_FILL } from './states';
import { isNumericText } from './helpers';

/**
 * One section form for the Inspector, dialogs, Studio and the workbench.
 * Header (32px, `H_SECTION_HEADER`) = optional icon + sentence-case title +
 * optional meta + chevron, a full-width hairline above, and a padded body.
 *
 * - `variant="collapsible"` (default) makes the header a button with
 *   `aria-expanded` / `aria-controls`; open state is uncontrolled
 *   (`defaultOpen`) or controlled (`open` + `onOpenChange`).
 * - `variant="static"` renders the same header as a plain heading (no
 *   chevron), for sections that are always open.
 * - Chevron convention (app-wide): pointing DOWN = open, pointing RIGHT =
 *   closed. Migrated sections that used chevron-up for open flip in one pass.
 * - `actions` (a ghost `Button size="sm"` or a link) sit at the header's
 *   right, inside its content box, vertically centred on the title, outside
 *   the toggle button (never nested interactive content).
 * - `meta` that states a quantity ("91 × 109 × 91") is mono; words stay sans.
 *   Override with `metaMono`.
 * - `keepMounted`: a collapsed body stays mounted (hidden), so drafts, mid-edit
 *   fields and fetched data survive collapse. Default false: collapsed bodies
 *   unmount (no hidden effects, e.g. histogram fetches).
 * - Not a landmark by default (`role="group"` labelled by the title): an
 *   Inspector with ten sections must not flood the landmark list. Pass
 *   `landmark` for a top-level `<section>` region.
 */

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  /** Force mono / sans meta (default: mono when the meta is numeric text). */
  metaMono?: boolean;
  actions?: React.ReactNode;
  variant?: 'collapsible' | 'static';
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keep the body mounted (hidden) while collapsed. */
  keepMounted?: boolean;
  /** Render as a `<section>` region landmark instead of a group. */
  landmark?: boolean;
  /** Hairline above the section (default true; the first section in a stack drops it). */
  divider?: boolean;
  /** Heading level for the title (default 3). */
  level?: 2 | 3 | 4;
  bodyClassName?: string;
}

const headerVariants = cva(
  cn('flex w-full min-w-0 items-center gap-2 px-3 text-left text-foreground', H_SECTION_HEADER),
  {
    variants: {
      interactive: {
        true: cn('transition-colors', HOVER_FILL, FOCUS_RING_INSET),
        false: '',
      },
    },
    defaultVariants: { interactive: false },
  },
);

export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  {
    title,
    icon,
    meta,
    metaMono,
    actions,
    variant = 'collapsible',
    defaultOpen = true,
    open: openProp,
    onOpenChange,
    keepMounted = false,
    landmark = false,
    divider = true,
    level = 3,
    className,
    bodyClassName,
    children,
    ...rest
  },
  ref,
) {
  const [openState, setOpenState] = useState(defaultOpen);
  const reactId = useId().replace(/:/g, '');
  const titleId = `bf-section-${reactId}-title`;
  const bodyId = `bf-section-${reactId}-body`;
  const collapsible = variant === 'collapsible';
  const open = collapsible ? (openProp ?? openState) : true;
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';
  const mono = metaMono ?? (typeof meta === 'string' && isNumericText(meta));

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const label = (
    <>
      {icon ? (
        <span aria-hidden className="flex shrink-0 text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span id={titleId} className="min-w-0 flex-1 truncate text-bf-sm font-semibold">
        {title}
      </span>
      {meta ? (
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-bf-xs tabular-nums text-muted-foreground',
            mono && 'font-mono',
          )}
        >
          {meta}
        </span>
      ) : null}
    </>
  );

  const Root = (landmark ? 'section' : 'div') as 'section';
  return (
    <Root
      ref={ref as React.Ref<HTMLElement>}
      role={landmark ? undefined : 'group'}
      aria-labelledby={titleId}
      data-state={open ? 'open' : 'closed'}
      className={cn(divider && 'border-t border-bf-border-subtle', className)}
      {...rest}
    >
      <div className={cn('flex min-w-0 items-center', H_SECTION_HEADER)}>
        <Heading className="m-0 flex h-full min-w-0 flex-1 items-center border-0 p-0">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={toggle}
              className={headerVariants({ interactive: true })}
            >
              {label}
              <ChevronDown
                aria-hidden
                className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', !open && '-rotate-90')}
              />
            </button>
          ) : (
            <div className={headerVariants({ interactive: false })}>{label}</div>
          )}
        </Heading>
        {actions ? (
          <div className="flex h-full shrink-0 items-center gap-1 pr-2">{actions}</div>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open} className={cn('px-3 pb-3', bodyClassName)}>
        {open || keepMounted ? children : null}
      </div>
    </Root>
  );
});
