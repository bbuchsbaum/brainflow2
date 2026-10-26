import React, { forwardRef, useId, useRef } from 'react';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { tabIds } from './helpers';
import { DISABLED, EDGE_ACCENT, EDGE_NEUTRAL, FOCUS_RING, H_TAB, HOVER_FILL, SELECTED_FILL } from './states';

/**
 * Flat tabs (V5 navigation kind 1): switch a pane's content. GoldenLayout
 * stacks, the Files view, the dock and BIDS all use this one form.
 *
 * 28px strip (`H_TAB`). Active = the selected fill + a 2px inset bottom
 * edge. The edge is neutral (`--bf-text-muted`) everywhere except the active
 * tab of the FOCUSED GoldenLayout stack, which passes `edge="accent"`. Focus
 * is the outer ring (offset 1); a neutral edge stays visible under it, an
 * amber edge hides (one amber band at a time).
 *
 * Keyboard (WAI-ARIA tabs): one tab stop (roving tabindex); Left/Right move,
 * Home/End jump; with `activation="automatic"` (default) moving also selects.
 * A closable tab closes with Delete (or Backspace) while focused, and focus
 * moves to its neighbour. The close glyph is a 24px pointer target that is
 * hidden from assistive tech (`aria-hidden`, not focusable), so the tablist
 * owns only tabs; the keyboard path is announced with `aria-keyshortcuts`.
 * Panels are rendered by the caller with {@link TabPanel} (or the ids from
 * {@link tabIds}); no context provider is needed.
 */

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Shows a close button; called with the tab's value. */
  onClose?: (value: string) => void;
  title?: string;
  /** `data-testid` on the tab button. */
  testId?: string;
  /** Extra `data-*` attributes on the tab button (e.g. `{ 'data-kind': 'plot' }`). */
  data?: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>;
}

export interface TabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Active-edge colour; 'accent' only for the focused GoldenLayout stack. */
  edge?: 'neutral' | 'accent';
  /** Equal-width cells filling the strip (Files view), or content width. */
  fill?: boolean;
  /**
   * Side padding of each tab: `default` 12px, `compact` 4px (narrow
   * equal-width strips such as the Files view in a 220px rail).
   */
  density?: 'default' | 'compact';
  /** Arrow keys select (automatic) or only move focus (manual). */
  activation?: 'automatic' | 'manual';
  /** Base for tab/panel ids (defaults to a generated id). */
  idBase?: string;
  'aria-label'?: string;
}

const tabVariants = cva(
  [
    'relative inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap px-3 text-bf-sm transition-colors',
    H_TAB,
    FOCUS_RING,
    DISABLED,
  ],
  {
    variants: {
      active: {
        true: cn(SELECTED_FILL, 'font-medium text-foreground'),
        false: cn(
          'text-muted-foreground hover:text-foreground data-[force-hover]:text-foreground',
          HOVER_FILL,
        ),
      },
      edge: {
        neutral: '',
        accent: '',
      },
      fill: {
        true: 'flex-1 justify-center',
        false: '',
      },
      density: {
        default: '',
        compact: 'px-1',
      },
    },
    compoundVariants: [
      { active: true, edge: 'neutral', className: EDGE_NEUTRAL },
      { active: true, edge: 'accent', className: EDGE_ACCENT },
    ],
    defaultVariants: { active: false, edge: 'neutral', fill: false, density: 'default' },
  },
);

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    items,
    value,
    onValueChange,
    edge = 'neutral',
    fill = false,
    density = 'default',
    activation = 'automatic',
    idBase,
    className,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const base = idBase ?? `bf-tabs${generated.replace(/:/g, '')}`;
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((t) => !t.disabled);
  // The tab stop is the selected tab, or the first enabled one if none is selected.
  const stop = enabled.some((t) => t.value === value) ? value : enabled[0]?.value;

  const move = (from: string, key: string): string | null => {
    if (enabled.length === 0) return null;
    const i = enabled.findIndex((t) => t.value === from);
    switch (key) {
      case 'ArrowRight':
        return enabled[(i + 1) % enabled.length].value;
      case 'ArrowLeft':
        return enabled[(i - 1 + enabled.length) % enabled.length].value;
      case 'Home':
        return enabled[0].value;
      case 'End':
        return enabled[enabled.length - 1].value;
      default:
        return null;
    }
  };

  const closeTab = (item: TabItem) => {
    if (!item.onClose) return;
    // Focus the neighbour (next, else previous) once the caller has removed the tab.
    const i = enabled.findIndex((t) => t.value === item.value);
    const neighbour = enabled[i + 1] ?? enabled[i - 1];
    item.onClose(item.value);
    if (neighbour) {
      requestAnimationFrame(() => tabRefs.current.get(neighbour.value)?.focus());
    }
  };

  const onKeyDown = (current: string) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const item = items.find((t) => t.value === current);
      if (item?.onClose && !item.disabled) {
        e.preventDefault();
        closeTab(item);
      }
      return;
    }
    const next = move(current, e.key);
    if (next === null) {
      if ((e.key === 'Enter' || e.key === ' ') && activation === 'manual') {
        e.preventDefault();
        onValueChange(current);
      }
      return;
    }
    e.preventDefault();
    tabRefs.current.get(next)?.focus();
    if (activation === 'automatic' && next !== value) onValueChange(next);
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation="horizontal"
      className={cn('flex min-w-0 items-stretch', fill && 'w-full', className)}
      {...rest}
    >
      {items.map((item) => {
        const active = item.value === value;
        const ids = tabIds(base, item.value);
        return (
          <span
            key={item.value}
            role="none"
            className={cn('relative flex min-w-0', fill && 'flex-1')}
          >
            <button
              ref={(el) => {
                if (el) tabRefs.current.set(item.value, el);
                else tabRefs.current.delete(item.value);
              }}
              {...item.data}
              data-testid={item.testId}
              type="button"
              role="tab"
              id={ids.tab}
              aria-controls={ids.panel}
              aria-selected={active}
              data-state={active ? 'active' : 'inactive'}
              tabIndex={item.value === stop ? 0 : -1}
              disabled={item.disabled}
              title={item.title}
              aria-keyshortcuts={item.onClose ? 'Delete' : undefined}
              onClick={() => onValueChange(item.value)}
              onKeyDown={onKeyDown(item.value)}
              className={cn(tabVariants({ active, edge, fill, density }), item.onClose && 'pr-7')}
            >
              {item.icon ? (
                <span aria-hidden className="flex shrink-0 text-muted-foreground">
                  {item.icon}
                </span>
              ) : null}
              <span className="truncate">{item.label}</span>
            </button>
            {item.onClose ? (
              // Pointer-only 24px target; keyboard users press Delete on the tab.
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                data-tab-close={item.value}
                title={`Close ${typeof item.label === 'string' ? item.label : item.value} (Delete)`}
                disabled={item.disabled}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(item);
                }}
                className="group/close absolute right-0.5 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-bf-xs group-hover/close:bg-bf-bg-hover">
                  <X className="h-3 w-3" aria-hidden />
                </span>
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
});

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  idBase: string;
  value: string;
  /** The tablist's current value; the panel is hidden unless it matches. */
  selected: string;
  /**
   * Make the panel itself a tab stop (default true, per APG for panels
   * without focusable content). Pass false when the panel starts with a
   * control (Files tree, plot toolbar) to avoid a redundant stop.
   */
  focusable?: boolean;
}

/** A tab's panel, labelled by its tab. Pass the same `idBase` as the Tabs. */
export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { idBase, value, selected, focusable = true, children, ...rest },
  ref,
) {
  const ids = tabIds(idBase, value);
  const active = value === selected;
  return (
    <div
      ref={ref}
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      hidden={!active}
      tabIndex={focusable ? 0 : undefined}
      {...rest}
    >
      {active ? children : null}
    </div>
  );
});
