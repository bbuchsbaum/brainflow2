import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SimilarityGlyphShape } from '@/services/studio/similarityGroupingView';
import { stripLayout } from './similarityStripLayout';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';
import { type MontageGroupRow } from './montageModel';
import { formatReadoutValue } from '@/utils/valueFormat';
import { MontageFooter, type MontageFooterProps } from './MontageFooter';
import { MontageGroupRows } from './MontageGroupRows';
import { MontageSelectionBar, type MontageSelectionBarProps } from './MontageSelectionBar';
import { MontageGrid, MontageSurface } from './MontageTiles';
import {
  montageSelectionHint,
  createMontageCropMemory,
  montageSprites,
  type MontageSprites,
} from './montageTileSupport';

export interface PopulationMontageProps {
  /** The result whose tiles are drawn; an earlier one stays up while the next evaluates. */
  display: PopulationSliceDisplay | null;
  mirrorX: boolean;
  /** Tiles are shown at or above their sampled size, so drawn pixel for pixel. */
  pixelated?: boolean;
  /**
   * The tiles' sprites, made by the owner that also fits the tiles to them
   * (one crop for both). Without them the montage makes its own.
   */
  sprites?: MontageSprites | null;
  /** Ungrouped: the subjects of the page, in order. */
  ids: readonly string[];
  /** Grouped: this page's rows, one per group, every member shown. Null when ungrouped. */
  groups: readonly MontageGroupRow[] | null;
  /** The prefix every ID in the set shares ("sub-"), stripped from the labels. */
  idPrefix?: string;
  onShowMean?: (groupId: string) => void;
  /** Leave a view narrowed to one group. */
  onShowAllGroups?: () => void;
  columns: number;
  onWidth: (width: number) => void;
  /** The grid's visible height (the shared tile size is fitted to it). */
  onHeight?: (height: number) => void;
  focusedId: string | null;
  selectedIds: ReadonlySet<string>;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  /** Open a subject in the single-subject view (a tile's double-click). */
  onOpen?: (id: string) => void;
  onSelect: (ids: string[], additive: boolean) => void;
  onClearSelection: () => void;
  onHoverWorld?: (world: [number, number, number]) => void;
  footer: Omit<MontageFooterProps, 'hover'>;
  /** Shown between the grid and the footer (a calculation's error). */
  notice?: ReactNode;
  /** What the empty ground says before any tile exists. */
  emptyText: string;
  height: number;
  /** A sort or grouping is being computed: the tiles dim under a progress bar. */
  pending?: boolean;
  /** A subject pointed at on the similarity map: its tile is outlined. */
  linkedId?: string | null;
  /** The subject under the pointer in the grid, or null when it leaves. */
  onHoverSubject?: (id: string | null) => void;
  /**
   * The pointer entered (true) or left (false) the tiles' area. A live order
   * holds still meanwhile: tiles never move under the pointer.
   */
  onPointerOverTiles?: (over: boolean) => void;
  /** Select a group's subjects from its header. */
  onSelectGroup?: (groupId: string) => void;
  /** Each similarity group's mark. */
  glyphs?: ReadonlyMap<string, SimilarityGlyphShape>;
  /**
   * The similarity strip to the right of the grid: inline at
   * min(320 px, 40 % of the row), or a sheet over the grid's right edge
   * when the row is narrower than `STRIP_SHEET_BELOW_PX`; a 24 px rail when collapsed.
   */
  strip?: {
    collapsed: boolean;
    render: (layout: { mode: 'inline' | 'sheet'; width: number }) => ReactNode;
  } | null;
  /**
   * What can be done with the selected subjects. Given, the montage keeps a
   * line of its own above the tiles: "8 selected · Save as group… · Compare
   * with the rest · ✕" while any are selected, else a quiet line saying how
   * to select. The line is always there, so selecting never moves the tiles.
   */
  selection?: MontageSelectionBarProps | null;
}

/**
 * The Montage arrangement: the subjects' tiles filling the pane (and
 * scrolling when the set cannot fit), and a footer with the shared colour
 * scale. What can be done with a selection sits on its own line between the
 * toolbar and the tiles: nothing floats over the tiles, and the toolbar row
 * keeps its width for Sort, Group and Slice.
 */
export function PopulationMontage({
  display,
  mirrorX,
  pixelated = true,
  sprites: given,
  ids,
  groups,
  idPrefix,
  onShowMean,
  onShowAllGroups,
  columns,
  onWidth,
  onHeight,
  focusedId,
  selectedIds,
  onFocus,
  onToggle,
  onOpen,
  onSelect,
  onClearSelection,
  onHoverWorld,
  footer,
  notice,
  emptyText,
  height,
  pending = false,
  linkedId = null,
  onHoverSubject,
  onPointerOverTiles,
  onSelectGroup,
  glyphs,
  strip = null,
  selection = null,
}: PopulationMontageProps) {
  const [hover, setHover] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!row.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setRowWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);
  const layout = strip ? stripLayout(rowWidth || 1024, strip.collapsed) : null;
  // One crop across the pages of a request (the largest seen), so a page
  // turn never rescales or shifts the brains.
  const [cropMemory] = useState(createMontageCropMemory);
  const own = useMemo(
    () => (given === undefined ? montageSprites(display, mirrorX, pixelated, cropMemory) : null),
    [given, display, mirrorX, pixelated, cropMemory],
  );
  const sprites = given === undefined ? own : given;
  const handlers = {
    focusedId,
    selectedIds,
    onFocus,
    onToggle,
    onOpen,
    onHover: (
      point: { id: string; value: number | null; world: [number, number, number] } | null,
    ) => {
      const text = point
        ? `${point.id}  ${point.value === null ? 'no value' : formatReadoutValue(point.value)}`
        : null;
      setHover((previous) => (previous === text ? previous : text));
      onHoverSubject?.(point?.id ?? null);
      if (point) onHoverWorld?.(point.world);
    },
    linkedId,
  };
  const count = groups ? groups.reduce((n, row) => n + row.shown.length, 0) : ids.length;
  const cellIds = useMemo(
    () => (groups ? groups.flatMap((row) => row.shown) : [...ids]),
    [groups, ids],
  );
  return (
    <div
      aria-label="Montage of subjects"
      role="region"
      aria-busy={pending || undefined}
      className="flex min-w-0 shrink-0 flex-col"
      style={{ height }}
    >
      {/* Under the toolbar's hairline: something is being worked out for the grid. */}
      <div className="h-0.5 shrink-0 overflow-hidden">
        {pending && (
          <div
            role="progressbar"
            aria-label="Computing"
            data-testid="montage-progress"
            className="h-full w-full bg-primary motion-safe:animate-pulse"
          />
        )}
      </div>
      {selection ? (
        <div
          data-testid="montage-selection-line"
          className="flex h-7 min-w-0 shrink-0 items-center overflow-hidden"
        >
          {selection.count > 0 ? (
            <MontageSelectionBar {...selection} />
          ) : (
            <p
              data-testid="montage-selection-hint"
              title={montageSelectionHint()}
              className="m-0 min-w-0 truncate text-bf-2xs text-bf-text-muted"
            >
              {montageSelectionHint()}
            </p>
          )}
        </div>
      ) : null}
      <div ref={row} className="relative flex min-h-0 min-w-0 flex-1">
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${pending ? 'opacity-50 transition-opacity' : ''}`}
        data-pending={pending || undefined}
        data-testid="montage-tiles-area"
        onPointerEnter={onPointerOverTiles ? () => onPointerOverTiles(true) : undefined}
        onPointerLeave={onPointerOverTiles ? () => onPointerOverTiles(false) : undefined}
      >
        <MontageSurface
          columns={columns}
          cellIds={cellIds}
          activeId={focusedId}
          scope={display?.query.key ?? ''}
          onSelect={onSelect}
          onClearSelection={onClearSelection}
          hasSelection={selectedIds.size > 0}
          onWidth={onWidth}
          onHeight={onHeight}
          onHoverEnd={() => {
            setHover(null);
            onHoverSubject?.(null);
          }}
        >
          {count === 0 ? (
            <p className="m-0 py-6 text-center text-bf-sm text-bf-text-muted">{emptyText}</p>
          ) : groups ? (
            <MontageGroupRows
              rows={groups}
              columns={columns}
              idPrefix={idPrefix}
              onShowMean={onShowMean}
              onShowAllGroups={onShowAllGroups}
              onSelectGroup={onSelectGroup}
              glyphs={glyphs}
              sprites={sprites}
              {...handlers}
            />
          ) : (
            <MontageGrid
              ids={ids}
              columns={columns}
              sprites={sprites}
              idPrefix={idPrefix}
              {...handlers}
            />
          )}
        </MontageSurface>
      </div>
      {strip && layout ? (
        <div
          data-testid="similarity-strip-slot"
          data-mode={layout.mode}
          data-collapsed={strip.collapsed || undefined}
          className={
            layout.mode === 'inline'
              ? 'flex min-h-0 shrink-0 border-l border-bf-border-subtle'
              : 'absolute inset-y-0 right-0 z-20 flex min-h-0 border-l border-bf-border bg-bf-bg-panel shadow-[var(--bf-shadow-panel)]'
          }
          style={{ width: layout.width }}
        >
          {strip.render(layout)}
        </div>
      ) : null}
      </div>
      {notice ? <div className="shrink-0 pb-2">{notice}</div> : null}
      {/* Ungrouped, the stripped ID prefix is said on the footer; grouped, in the first group's heading. */}
      <MontageFooter {...footer} hover={hover} idPrefix={groups ? undefined : idPrefix} />
    </div>
  );
}
