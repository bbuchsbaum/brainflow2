import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { StudioToolbarSlotContext } from './studioToolbarSlots';

/** Floating layers (dialogs, listboxes, menus, Radix poppers) rendered outside the DOM tree that opened them. */
const FLOATING_LAYER =
  '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]';

/** The outermost floating layer holding `node`, if any. */
function floatingLayerOf(node: Node | null): Element | null {
  let layer: Element | null = null;
  let at = node instanceof Element ? node : (node?.parentElement ?? null);
  while (at) {
    const found: Element | null = at.closest(FLOATING_LAYER);
    if (!found) break;
    layer = found;
    at = found.parentElement;
  }
  return layer;
}

/**
 * The active lens's controls, portalled into the toolbar row's slot
 * (`StudioToolbarSlotContext`); in place without one.
 */
export function StudioToolbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(StudioToolbarSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="flex flex-wrap items-center gap-2 text-bf-sm">{children}</div>;
}

/**
 * A small popover on a native disclosure: its summary is the trigger, its
 * panel opens under it (or above it, on a footer). Its controls stay in the
 * DOM (and the accessibility tree) while closed; its trigger, Escape or a
 * press outside it closes it, and like the app's other disclosures it stays
 * open while its controls are used.
 *
 * The panel stays anchored to its trigger and inside the Studio column
 * (`[data-studio-column]`, else the window): opened, it is shifted sideways
 * only as far as it must be to fit, and never taller than the room on its
 * side of the trigger.
 */
export function StudioPopover({
  summary,
  label,
  placement = 'below',
  align = 'end',
  summaryClassName,
  panelClassName,
  testId,
  children,
}: {
  /** What the closed trigger shows. */
  summary: ReactNode;
  /** The trigger's name and tooltip. */
  label: string;
  placement?: 'below' | 'above';
  align?: 'start' | 'end';
  summaryClassName?: string;
  panelClassName?: string;
  /** `data-testid` on the panel. */
  testId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Floating layers opened from inside this popover: portalled out of its
  // DOM, but React's focus events still bubble to it through the portal, and
  // opening a dialog, listbox or menu moves focus into it.
  const ownLayers = useRef(new Set<Element>());
  // A press anywhere outside the popover closes it. Floating layers that its
  // own controls opened (dialogs, listboxes, menus) are not "outside": using
  // them keeps it open. Another component's layer is outside.
  useEffect(() => {
    const layers = ownLayers.current;
    if (!open) {
      layers.clear();
      return;
    }
    const owns = (layer: Element) => {
      if ([...layers].some((own) => own === layer || layer.contains(own))) return true;
      // A layer whose trigger (aria-controls) is inside the popover.
      const ids = new Set([layer, ...layer.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean));
      const triggers = ref.current?.querySelectorAll('[aria-controls]') ?? [];
      return [...triggers].some((trigger) =>
        (trigger.getAttribute('aria-controls') ?? '').split(/\s+/).some((id) => ids.has(id)),
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      const target = event.target;
      if (!details?.open || !(target instanceof Node) || details.contains(target)) return;
      const layer = floatingLayerOf(target);
      if (layer && owns(layer)) return;
      details.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);
  const onFocus = (event: FocusEvent<HTMLDetailsElement>) => {
    const target = event.target;
    if (ref.current?.contains(target)) return;
    const layer = floatingLayerOf(target);
    if (layer) ownLayers.current.add(layer);
  };
  // Keep the open panel on its trigger and inside the column.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = summaryRef.current;
    if (!open || !panel || !trigger) return;
    const place = () => {
      panel.style.translate = '';
      panel.style.maxHeight = '';
      const area = (ref.current?.closest('[data-studio-column]') ??
        null) as HTMLElement | null;
      const view = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const box = area?.getBoundingClientRect();
      const bounds =
        box && box.width > 0 && box.height > 0
          ? {
              left: Math.max(view.left, box.left),
              top: Math.max(view.top, box.top),
              right: Math.min(view.right, box.right),
              bottom: Math.min(view.bottom, box.bottom),
            }
          : view;
      const rect = panel.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      // Nothing laid out (a test DOM): leave the panel where CSS puts it.
      if (rect.width === 0 || bounds.right - bounds.left <= 0) return;
      const gap = 4;
      let dx = 0;
      if (rect.right > bounds.right - gap) dx = bounds.right - gap - rect.right;
      if (rect.left + dx < bounds.left + gap) dx = bounds.left + gap - rect.left;
      if (dx !== 0) panel.style.translate = `${Math.round(dx)}px 0`;
      const room =
        placement === 'above' ? anchor.top - bounds.top - gap : bounds.bottom - anchor.bottom - gap;
      panel.style.maxHeight = `${Math.round(Math.max(160, Math.min(window.innerHeight * 0.7, room)))}px`;
    };
    place();
    // A scroll of any ancestor (capture: scroll does not bubble) moves the
    // trigger as surely as a resize does.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement]);
  // Escape closes only the popover it was pressed in (focus inside it), and
  // goes no further: the montage's own Escape (clear the selection) does
  // not also fire. Focus returns to the trigger. An Escape from a portalled
  // layer opened inside it (a listbox closing itself) bubbles here through
  // React, but is that layer's, not the popover's; so is one already handled.
  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape' || !ref.current?.open || event.defaultPrevented) return;
    if (!(event.target instanceof Node) || !ref.current.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    ref.current.open = false;
    summaryRef.current?.focus();
  };
  return (
    <details
      ref={ref}
      className="relative shrink-0"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        ref={summaryRef}
        className={`cursor-pointer list-none [&::-webkit-details-marker]:hidden ${
          summaryClassName ??
          'inline-flex h-6 items-center gap-1 rounded-sm border border-border px-2 text-bf-xs text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title={label}
        aria-label={label}
      >
        {summary}
      </summary>
      {/* Never taller than the window allows: a long form scrolls inside the panel. */}
      <div
        ref={panelRef}
        data-testid={testId}
        className={`absolute z-30 flex max-h-[70vh] max-w-[80vw] flex-col gap-2 overflow-y-auto overscroll-contain rounded-sm border border-border bg-card p-3 text-bf-sm shadow-md ${
          placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
        } ${align === 'end' ? 'right-0' : 'left-0'} ${panelClassName ?? 'w-[22rem]'}`}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * Overflow for rarely used toolbar controls: a "More" button opening a panel
 * under it (a {@link StudioPopover}).
 */
export function StudioToolbarMore({
  label = 'More',
  icon = true,
  iconOnly = false,
  children,
}: {
  /** Show the glyph alone; the label still names the button. */
  iconOnly?: boolean;
  label?: string;
  /** Show the ⋯ glyph before the label (the generic overflow). */
  icon?: boolean;
  children: ReactNode;
}) {
  return (
    <StudioPopover
      label={label}
      testId="studio-toolbar-menu-panel"
      summary={
        <>
          {icon ? <MoreHorizontal aria-hidden className="h-3.5 w-3.5" /> : null}
          <span className={iconOnly ? 'sr-only' : 'whitespace-nowrap'}>{label}</span>
        </>
      }
    >
      {children}
    </StudioPopover>
  );
}

/**
 * One labelled part of the Studio's ⋯ menu ("View", "Data"): a quiet heading
 * over its items, with a hairline above every part but the first. A part
 * whose body is empty (a lens slot nothing was portalled into) is hidden.
 */
export function StudioMenuSection({
  title,
  children,
  testId,
  bodyRef,
}: {
  title: string;
  children?: ReactNode;
  testId?: string;
  /** The body element itself, for a part that is a portal slot. */
  bodyRef?: (element: HTMLDivElement | null) => void;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex flex-col gap-2 border-t border-bf-border-subtle pt-2 first:border-t-0 first:pt-0 [&:has(>[data-menu-body]:empty)]:hidden"
    >
      <h3 className="m-0 text-bf-2xs font-medium text-bf-text-muted">{title}</h3>
      <div ref={bodyRef} data-menu-body className="flex flex-col gap-2">
        {children}
      </div>
    </section>
  );
}
