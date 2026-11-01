/**
 * Compare pane header (QA features 2026-10-31 §6): the pane's letter, a
 * picker for its layer and the slice position, over the canvas's top-left
 * margin like the viewport header. The name never disappears: the picker
 * truncates with the full name in its tooltip, and the position is the part
 * dropped when the pane is narrow.
 */
import type { ReactNode } from 'react';
import { Select } from '@/components/ui/bf';
import type { FramePlane } from './viewportFrame/frameFormat';
import { PANE_PICKER_MIN_PX, paneHeaderLayout } from './comparePaneLayout';

export interface ComparePaneHeaderProps {
  letter: string | null;
  /** The pane receives unlinked Inspector edits (accent edge on the letter). */
  active?: boolean;
  plane: FramePlane;
  positionMm: number;
  /** The pane's own layer, or null for an empty pane. */
  layerId: string | null;
  /** Layers the pane can show (loaded volumes), in stack order. */
  options: ReadonlyArray<{ id: string; name: string }>;
  onChoose: (layerId: string) => void;
  /** Canvas area size (CSS px). */
  width: number;
  /** Slice range: the layout fits its widest position. */
  rangeMm?: readonly [number, number] | null;
  /** Width the pane's right slot (value, link glyph) takes. */
  rightReservePx?: number;
  /**
   * Pane controls (plane, remove) shown in place of the position on hover or
   * keyboard focus, so they take the position's room, never the name's.
   */
  controls?: ReactNode;
  controlsPx?: number;
  /** Accessible pane name ("A, zmap") for the picker label. */
  paneLabel: string;
  elementRef?: (el: HTMLDivElement | null) => void;
}

export function ComparePaneHeader({
  letter,
  active = false,
  plane,
  positionMm,
  layerId,
  options,
  onChoose,
  width,
  paneLabel,
  elementRef,
  rangeMm = null,
  rightReservePx = 0,
  controls = null,
  controlsPx = 0,
}: ComparePaneHeaderProps) {
  const { position, pickerMax, trailingPx } = paneHeaderLayout(width, positionMm, plane, !!letter, rangeMm, {
    rightReservePx,
    controlsPx: controls ? controlsPx : 0,
  });
  const current = options.find((o) => o.id === layerId);
  return (
    <div
      ref={elementRef}
      data-testid="compare-pane-header"
      className="group/header absolute left-1.5 top-1 z-10 flex min-w-0 select-none items-center gap-1.5 whitespace-nowrap rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)] px-1 text-bf-xs text-bf-text-secondary"
    >
      {letter && (
        <span
          data-testid="viewport-header-letter"
          data-active={active ? 'true' : undefined}
          className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-bf-xs border px-1 font-semibold leading-none text-bf-text-primary ${
            active
              ? 'border-bf-accent shadow-[inset_0_-2px_0_0_hsl(var(--ring))]'
              : 'border-bf-border-strong'
          }`}
        >
          {letter}
        </span>
      )}
      <Select
        className="h-5 w-auto truncate"
        style={{ maxWidth: pickerMax, minWidth: PANE_PICKER_MIN_PX }}
        aria-label={`Layer of panel ${paneLabel}`}
        title={current?.name ?? 'Choose a layer'}
        value={current ? current.id : ''}
        options={[
          ...(current ? [] : [{ value: '', label: 'Choose a layer…', disabled: true }]),
          ...options.map((o) => ({ value: o.id, label: o.name })),
        ]}
        onValueChange={(id) => {
          if (id && id !== layerId) onChoose(id);
        }}
        data-testid="compare-pane-picker"
      />
      {(position && current) || controls ? (
        // One cell for the position and the controls: hover or focus swaps
        // them; the picker (the name) keeps its width either way.
        <span
          className="grid shrink-0 items-center overflow-hidden"
          style={{ width: trailingPx }}
          data-testid="compare-pane-trailing"
        >
          {position && current && (
            <span
              className="pointer-events-none font-mono tabular-nums transition-opacity [grid-area:1/1] motion-reduce:transition-none group-focus-within/header:opacity-0 group-hover/panel:opacity-0"
              data-testid="compare-pane-position"
            >
              {position}
            </span>
          )}
          {controls && (
            <span
              className="flex items-center gap-1 opacity-0 transition-opacity [grid-area:1/1] motion-reduce:transition-none focus-within:opacity-100 group-hover/panel:opacity-100"
              data-testid="compare-pane-controls"
            >
              {controls}
            </span>
          )}
        </span>
      ) : null}
    </div>
  );
}
