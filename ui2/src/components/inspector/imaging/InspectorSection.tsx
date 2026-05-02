import React, { useState } from 'react';

interface InspectorSectionProps {
  /** Section icon (small svg or character). */
  icon?: React.ReactNode;
  /** Uppercase section label, e.g. `RENDER`. */
  label: string;
  /** Whether the section is open by default. */
  defaultOpen?: boolean;
  /**
   * Optional right-aligned metadata rendered on the section header row,
   * before the chevron. Used for compact summary lines like
   * `2 items · volume` on the Scene section.
   */
  meta?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Collapsible section primitive used by every inspector body. Mirrors the
 * mockup chrome: thin divider, icon + uppercase label + chevron, padded
 * body. Caller owns the inner controls.
 */
export function InspectorSection({
  icon,
  label,
  defaultOpen = true,
  meta,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = `${label.replace(/\s+/g, '-').toLowerCase()}-heading`;

  return (
    <section className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${headingId}-body`}
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        <span id={headingId} className="flex items-center gap-2 text-foreground">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">
            {label}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {meta ? (
            <span className="text-[10px] text-muted-foreground/80">{meta}</span>
          ) : null}
          <svg
            viewBox="0 0 16 16"
            className={`h-3 w-3 text-muted-foreground transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div id={`${headingId}-body`} className="px-3 pb-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Compact two-column field row used by Render / Mapping sections (label on
 * the left, control on the right). Keeps every section visually consistent.
 */
export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 shrink-0 items-center gap-2">{children}</span>
    </div>
  );
}

/**
 * Compact 2-column facts grid used by Data sections (e.g. Shape / Range /
 * TR / Space). All values rendered tabular-mono.
 */
export function FactGrid({
  facts,
}: {
  facts: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-card/40 p-3 text-[12px]">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
            {fact.label}
          </div>
          <div
            className="truncate font-mono tabular-nums text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            title={fact.value}
          >
            {fact.value}
          </div>
        </div>
      ))}
    </div>
  );
}
