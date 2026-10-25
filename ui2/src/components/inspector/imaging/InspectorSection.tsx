import React, { useState } from 'react';

interface InspectorSectionProps {
  /** Section icon (small svg or character). */
  icon?: React.ReactNode;
  /** Sentence-case section label, e.g. `View behavior`. */
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
 * mockup chrome: thin divider, icon + sentence-case label + chevron, padded
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
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span id={headingId} className="flex items-center gap-2 text-foreground">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          <span className="text-bf-sm font-semibold">
            {label}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {meta ? (
            <span className="text-bf-xs tabular-nums text-muted-foreground">{meta}</span>
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
    <div className="flex items-center justify-between gap-3 py-1.5 text-bf-sm">
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
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-sm border border-border bg-card/40 p-3 text-bf-sm">
      {facts.map((fact) => {
        // Keep a trailing unit glued to its value: the number may shrink
        // to an ellipsis (full text in the title), the unit never wraps.
        const unitMatch = /^(.*\S)\s(mm|ms|s|Hz|%)$/.exec(fact.value);
        const number = unitMatch ? unitMatch[1] : fact.value;
        const unit = unitMatch ? unitMatch[2] : null;
        // Long readouts (e.g. anisotropic voxel size) take the full row so
        // they stay legible in a narrow Inspector instead of truncating.
        const wide = fact.value.length > 14;
        return (
          <div key={fact.label} className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
            <div className="text-bf-2xs font-medium text-muted-foreground">
              {fact.label}
            </div>
            <div
              className="flex min-w-0 items-baseline gap-1 whitespace-nowrap font-mono tabular-nums text-foreground"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              title={fact.value}
            >
              <span className="min-w-0 truncate">{number}</span>
              {unit ? <span className="shrink-0">{unit}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
