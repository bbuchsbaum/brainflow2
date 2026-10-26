/**
 * SliceSlider — the viewport rail scrubber, on the bf `Slider variant="rail"`.
 *
 * A thin rail (3px track, 6px on hover/drag/focus) on the canvas ground with a
 * light-neutral rect thumb that grows on hover/focus. The hit area is the
 * whole 24px strip (WCAG 2.5.8); the rail marks a position, not a quantity,
 * so there is no fill. The thumb is the `role="slider"`: accessible name
 * ("Axial slice position"), value text ("z = 17.5 mm").
 *
 * Values are continuous (the equivalent of the old `step="any"` input):
 * aria-valuenow is the crosshair position, never a voxel-snapped copy. Arrows
 * move exactly one step (one voxel spacing) from the current value,
 * PageUp/PageDown ten steps, Home/End the bounds. Pointer drags snap to the
 * voxel grid anchored at `min`. Pointer drags (only) mark `dragSourceStore`
 * as 'slider'; `onCommit` receives the final value of each gesture.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ViewType } from '@/types/coordinates';
import { useDragSourceStore } from '@/stores/dragSourceStore';
import { formatWorldMmAscii } from '@/utils/valueFormat';
import { Slider } from '@/components/ui/bf';

interface SliceSliderProps {
  viewType: ViewType;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Final value of a gesture (pointer release, key release). */
  onCommit?: (value: number) => void;
  /** Accessible name; defaults to "<Plane> slice position". Compare adds the panel's layer. */
  ariaLabel?: string;
}

export const PAGE_STEPS = 10;

export function SliceSlider({
  viewType,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  onCommit,
  ariaLabel,
}: SliceSliderProps) {
  const setDraggingSource = useDragSourceStore((state) => state.setDraggingSource);
  const dragging = useRef(false);

  const axisLabel = viewType === 'axial' ? 'z' : viewType === 'sagittal' ? 'x' : 'y';
  const viewName = `${viewType.charAt(0).toUpperCase()}${viewType.slice(1)}`;

  const handleChange = (next: number) => {
    // Prevent feedback loops - only update if value actually changed
    if (Math.abs(next - value) < 0.01) return;
    onChange(next);
  };

  const handleDragChange = useCallback(
    (isDragging: boolean) => {
      dragging.current = isDragging;
      setDraggingSource(isDragging ? 'slider' : null);
    },
    [setDraggingSource],
  );

  // Clean up drag state on unmount
  useEffect(
    () => () => {
      if (dragging.current) setDraggingSource(null);
    },
    [setDraggingSource],
  );

  return (
    <Slider
      variant="rail"
      className="h-full"
      label={ariaLabel ?? `${viewName} slice position`}
      min={min}
      max={max}
      step={step > 0 ? step : undefined}
      snap={step > 0 ? step : undefined}
      value={value}
      disabled={disabled}
      // aria-valuetext stays ASCII so assistive tech and parsers read "-0.5".
      valueText={(v) => `${axisLabel} = ${formatWorldMmAscii(v)} mm`}
      onValueChange={handleChange}
      onValueCommit={onCommit}
      onDragChange={handleDragChange}
    />
  );
}
