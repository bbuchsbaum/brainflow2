import React from 'react';
import { Pager, Select, Slider } from '@/components/ui/bf';
import { cn } from '@/utils/cn';

// Export toolbar height for consistent spacing
export const MOSAIC_TOOLBAR_HEIGHT = 40; // px

const AXIS_OPTIONS = [
  { value: 'axial', label: 'Axial' },
  { value: 'sagittal', label: 'Sagittal' },
  { value: 'coronal', label: 'Coronal' },
] as const;
const GRID_OPTIONS = [
  { value: '2x2', label: '2×2' },
  { value: '3x3', label: '3×3' },
  { value: '4x4', label: '4×4' },
  { value: '5x5', label: '5×5' },
] as const;

interface MosaicToolbarProps {
  axis: 'axial' | 'sagittal' | 'coronal';
  onAxisChange: (v: 'axial' | 'sagittal' | 'coronal') => void;
  grid: string;
  onGridChange: (v: string) => void;
  /** Label of the Auto option, naming the grid it chose ("Auto (3×6)"). */
  autoGridLabel?: string;
  page: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  currentSlice: number;
  totalSlices: number;
  onSliceChange: (slice: number) => void;
  /**
   * Label for a slider position (0-based within the shown range): the
   * slice's world position, "z 50.5", as on the tiles. Without it the slider
   * shows the 0-based index, like the ijk readout.
   */
  sliceLabel?: (slice: number) => string;
  /** World range of the tiles on this page ("z 24.5–54.5"), beside the pager. */
  pageRange?: string;
  className?: string;
}

export function MosaicToolbar({
  axis,
  onAxisChange,
  grid,
  onGridChange,
  autoGridLabel = 'Auto',
  page,
  pageCount,
  canPrev,
  canNext,
  onPrev,
  onNext,
  currentSlice,
  totalSlices,
  onSliceChange,
  sliceLabel,
  pageRange,
  className
}: MosaicToolbarProps) {
  const label = (v: number) => (sliceLabel ? sliceLabel(Math.round(v)) : String(Math.round(v)));
  return (
    <header
      className={cn(
        "sticky top-0 z-30", // Stays visible, doesn't overlap content
        "flex items-center gap-3",
        "h-10 px-4",
        "bg-[var(--app-bg-secondary)]",
        "border-b border-[var(--app-border)]",
        "shadow-[var(--app-shadow-sm)]",
        className
      )}
      style={{ height: MOSAIC_TOOLBAR_HEIGHT }}
    >
      {/* Axis and grid: bf Select (native, 24px control height). */}
      <Select
        aria-label="Mosaic plane"
        className="w-[100px]"
        value={axis}
        options={AXIS_OPTIONS}
        onValueChange={(v) => onAxisChange(v as MosaicToolbarProps['axis'])}
      />
      <Select
        aria-label="Mosaic grid"
        className="w-auto"
        value={grid}
        options={[
          // Auto (default): the grid with the largest tiles for the pane.
          { value: 'auto', label: autoGridLabel },
          ...(GRID_OPTIONS.some((o) => o.value === grid) || grid === 'auto'
            ? GRID_OPTIONS
            : [...GRID_OPTIONS, { value: grid, label: grid.replace('x', '×') }]),
        ]}
        onValueChange={onGridChange}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Slice slider: bf Slider (index 0..n-1, one step per slice). */}
      {/* Never collapses to a stub: the slider keeps a usable track. */}
      <div className="flex min-w-[176px] max-w-[300px] flex-1 items-center gap-2">
        <span className="whitespace-nowrap text-bf-xs text-muted-foreground" aria-hidden>
          Crosshair
        </span>
        <Slider
          className="min-w-[72px] flex-1"
          label="Crosshair slice"
          min={0}
          max={Math.max(0, totalSlices - 1)}
          step={1}
          snap={1}
          fill={false}
          value={currentSlice}
          disabled={totalSlices <= 1}
          showValue
          // The crosshair slice's world position ("z 50.5"), as on its tile;
          // the page follows it.
          format={(v) => label(v)}
          valueText={(v) => `${label(v)} mm`}
          onValueChange={(v) => {
            const next = Math.round(v);
            if (next !== currentSlice) onSliceChange(next);
          }}
        />
      </div>

      {pageRange ? (
        <span
          // Clear of the slider's own value.
          className="ml-3 whitespace-nowrap border-l border-bf-border-subtle pl-3 font-mono text-bf-xs tabular-nums text-muted-foreground"
          data-testid="mosaic-page-range"
        >
          {pageRange}
        </span>
      ) : null}

      {/* Page navigation: bf Pager ("Previous page" / "Next page"). */}
      <Pager
        className="ml-2"
        noun="page"
        showNoun
        page={page + 1}
        count={pageCount}
        disabled={!canPrev && !canNext}
        onPageChange={(next) => {
          if (next < page + 1) {
            if (canPrev) onPrev();
          } else if (canNext) {
            onNext();
          }
        }}
      />
    </header>
  );
}