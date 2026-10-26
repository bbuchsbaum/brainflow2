/**
 * SliceSlider — the viewport rail scrubber.
 *
 * A thin rail (3px track, 6px on hover/drag/focus) under the slice with a
 * light-neutral thumb that grows on hover/focus. The track is a mid neutral
 * (text-muted mixed 56% into the canvas, ≈3:1 on black) so the scrubber's
 * extent is perceptible at rest and never reads as the #292929 splitter; the
 * thumb (primary, ≈14:1) stays clearly distinct from it. The hit area is the whole
 * 24px strip (WCAG 2.5.8 target size); the visual stays thin. The rail marks a position, not a
 * quantity, so there is no fill. A transparent native range input carries
 * semantics: accessible name ("Axial slice position"), value text
 * ("z = 17.5 mm").
 *
 * The input uses step="any" so its value (aria-valuenow) is the continuous
 * crosshair position, never a voxel-snapped copy. Keys are handled here:
 * arrows move exactly one step (one voxel spacing) from the current value,
 * PageUp/PageDown ten steps, Home/End the bounds. Pointer drags snap to the
 * voxel grid anchored at `min`.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ViewType } from '@/types/coordinates';
import { useDragSourceStore } from '@/stores/dragSourceStore';
import { formatWorldMmAscii } from '@/utils/valueFormat';

interface SliceSliderProps {
  viewType: ViewType;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Accessible name; defaults to "<Plane> slice position". Compare adds the panel's layer. */
  ariaLabel?: string;
}

export const PAGE_STEPS = 10;

function clampToRange(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function SliceSlider({
  viewType,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  ariaLabel,
}: SliceSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const { setDraggingSource } = useDragSourceStore();

  const axisLabel = viewType === 'axial' ? 'z' : viewType === 'sagittal' ? 'x' : 'y';
  const viewName = `${viewType.charAt(0).toUpperCase()}${viewType.slice(1)}`;
  // aria-valuetext stays ASCII so assistive tech and parsers read "-0.5".
  const displayValue = formatWorldMmAscii(value);

  const emit = (next: number) => {
    // Prevent feedback loops - only update if value actually changed
    if (Math.abs(next - value) < 0.01) return;
    onChange(next);
  };

  const snap = (raw: number) =>
    clampToRange(step > 0 ? min + Math.round((raw - min) / step) * step : raw, min, max);

  // Native changes come only from the pointer (keys are handled below).
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    if (Number.isFinite(raw)) emit(snap(raw));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = value + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = value - step;
        break;
      case 'PageUp':
        next = value + step * PAGE_STEPS;
        break;
      case 'PageDown':
        next = value - step * PAGE_STEPS;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    emit(clampToRange(next, min, max));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    draggingRef.current = true;
    setIsDragging(true);
    setDraggingSource('slider');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const endDrag = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    setDraggingSource(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? clampToRange((e.clientX - rect.left) / rect.width, 0, 1) : 0;
    emit(snap(min + (max - min) * fraction));
  };

  // Clean up drag state on unmount
  useEffect(() => {
    return () => {
      if (draggingRef.current) setDraggingSource(null);
    };
  }, [setDraggingSource]);

  const percentage = max > min ? ((value - min) / (max - min)) * 100 : 50;
  const clamped = clampToRange(percentage, 0, 100);

  return (
    <div
      className="group relative h-full bg-[var(--bf-bg-canvas)] px-2"
      data-dragging={isDragging ? 'true' : undefined}
    >
      <div className="absolute inset-y-0 left-2 right-2">
        {/* Track: position rail, no fill */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-text-muted)_56%,var(--bf-bg-canvas))] transition-[height] group-hover:h-1.5 group-data-[dragging=true]:h-1.5 group-focus-within:h-1.5"
        />
        {/* Native input: transparent, full-strip hit area, carries semantics */}
        <input
          type="range"
          min={min}
          max={max}
          step="any"
          value={value}
          disabled={disabled}
          aria-label={ariaLabel ?? `${viewName} slice position`}
          aria-valuetext={`${axisLabel} = ${displayValue} mm`}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerMove={handlePointerMove}
          className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        {/* Thumb: light neutral; grows on hover/drag; focus ring per HYBRID */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-bf-xs bg-primary transition-[width,height] group-hover:h-3.5 group-hover:w-1.5 group-data-[dragging=true]:h-3.5 group-data-[dragging=true]:w-1.5 peer-focus-visible:h-3.5 peer-focus-visible:w-1.5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--bf-border-focus)] peer-disabled:opacity-50"
          style={{ left: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
