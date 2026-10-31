import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * The Set studio column has one compact toolbar row (QA N13): the lens
 * switcher, then the active lens's own controls, portalled into this slot.
 * Without a slot (a lens rendered on its own, tests) the controls render in
 * place.
 */
export const StudioToolbarSlotContext = createContext<HTMLElement | null>(null);

/**
 * Height (px) the active lens's maps may fill: the column's visible height
 * below the toolbar. Null when unknown (a lens rendered on its own).
 */
export const StudioViewportHeightContext = createContext<number | null>(null);

/** Minimum height of one Studio map view (QA N13). */
export const STUDIO_MIN_VIEW_PX = 240;

export function StudioToolbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(StudioToolbarSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="flex flex-wrap items-center gap-2 text-bf-sm">{children}</div>;
}

/**
 * Overflow for rarely used toolbar controls: a "More" button opening a panel
 * under it. A native disclosure, so its controls stay in the DOM (and the
 * accessibility tree) while closed; its button or Escape closes it.
 */
export function StudioToolbarMore({
  label = 'More',
  icon = true,
  children,
}: {
  label?: string;
  /** Show the ⋯ glyph before the label (the generic overflow). */
  icon?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // Escape closes it; like the app's other disclosures it stays open while
  // its controls are used (a form such as Save calculation).
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current) ref.current.open = false;
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <details
      ref={ref}
      className="relative shrink-0"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className="inline-flex h-6 cursor-pointer list-none items-center gap-1 rounded-sm border border-border px-2 text-bf-xs text-muted-foreground hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden"
        title={label}
      >
        {icon ? <MoreHorizontal aria-hidden className="h-3.5 w-3.5" /> : null}
        <span className="whitespace-nowrap">{label}</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 flex w-[22rem] max-w-[80vw] flex-col gap-2 rounded-sm border border-border bg-card p-3 text-bf-sm shadow-md">
        {children}
      </div>
    </details>
  );
}
