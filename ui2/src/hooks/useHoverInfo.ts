/**
 * useHoverInfo Hook
 *
 * Provides hover information handling for view components.
 * Coordinates with HoverInfoService to collect entries from all enabled providers,
 * then dispatches to tooltip, status bar, and returns local state for in-canvas overlay.
 */

import { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import { throttle } from 'lodash';
import { hoverInfoService } from '@/services/HoverInfoService';
import { useHoverSettingsStore, selectThrottleMs } from '@/stores/hoverSettingsStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useTooltipStore, type ViewId, type ViewTooltipEntry } from '@/stores/tooltipStore';
import type { HoverContext, HoverInfoEntry } from '@/types/hoverInfo';

export interface UseHoverInfoOptions {
  /** View identifier for this component */
  viewId: string;
  /** ID of the primary/active layer (if any) */
  activeLayerId?: string;
  /** ID of the active atlas layer (if any) */
  activeAtlasId?: string;
  /** Callback to convert canvas coordinates to world coordinates */
  canvasToWorld: (canvasX: number, canvasY: number) => [number, number, number] | null;
  /** Called when hover starts/updates (for marking view as active) */
  onHoverStart?: () => void;
}

export interface UseHoverInfoResult {
  /** Call this on mouse move with the event */
  handleMouseMove: (event: React.MouseEvent) => void;
  /** Call this on mouse leave */
  handleMouseLeave: () => void;
  /** Current intensity value for in-canvas overlay (null if not available) */
  hoverValue: number | null;
  /** All current hover entries (for custom rendering) */
  hoverEntries: HoverInfoEntry[];
}

/**
 * Format world coordinates for display.
 */
function formatCoord(coord: [number, number, number]): string {
  return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
}

/**
 * Convert HoverInfoEntry to ViewTooltipEntry for the tooltip store.
 */
function toTooltipEntry(entry: HoverInfoEntry): ViewTooltipEntry {
  return {
    kind: 'custom',
    label: entry.label,
    value: entry.value,
    priority: (entry.priority ?? 50) < 30 ? 'high' : 'normal',
  };
}

export function useHoverInfo(options: UseHoverInfoOptions): UseHoverInfoResult {
  const { viewId, activeLayerId, activeAtlasId, canvasToWorld, onHoverStart } = options;

  // Local state for in-canvas hover overlay
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [hoverEntries, setHoverEntries] = useState<HoverInfoEntry[]>([]);

  // Get throttle setting
  const throttleMs = useHoverSettingsStore(selectThrottleMs);

  // Keep refs for values that change frequently but shouldn't recreate the handler
  const activeLayerIdRef = useRef(activeLayerId);
  const activeAtlasIdRef = useRef(activeAtlasId);
  const canvasToWorldRef = useRef(canvasToWorld);
  const onHoverStartRef = useRef(onHoverStart);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);
  useEffect(() => {
    activeAtlasIdRef.current = activeAtlasId;
  }, [activeAtlasId]);
  useEffect(() => {
    canvasToWorldRef.current = canvasToWorld;
  }, [canvasToWorld]);
  useEffect(() => {
    onHoverStartRef.current = onHoverStart;
  }, [onHoverStart]);

  type HoverMouseSample = {
    clientX: number;
    clientY: number;
    rectLeft: number;
    rectTop: number;
  };

  // Create throttled handler (do not capture React's pooled event object)
  const throttledMouseMove = useMemo(() => {
    return throttle(
      async (sample: HoverMouseSample) => {
        try {
          onHoverStartRef.current?.();

          const canvasX = sample.clientX - sample.rectLeft;
          const canvasY = sample.clientY - sample.rectTop;

          const worldCoord = canvasToWorldRef.current(canvasX, canvasY);
          if (!worldCoord) {
            setHoverValue(null);
            setHoverEntries([]);
            return;
          }

          const ctx: HoverContext = {
            worldCoord,
            viewId,
            screenPos: { x: sample.clientX, y: sample.clientY },
            activeLayerId: activeLayerIdRef.current,
            activeAtlasId: activeAtlasIdRef.current,
          };

          const entries = await hoverInfoService.getHoverInfo(ctx);
          setHoverEntries(entries);

          const mouseStore = useMouseCoordinateStore.getState();
          mouseStore.setMousePositionThrottled(worldCoord, viewId);

          const statusStore = useStatusBarStore.getState();
          const settings = useHoverSettingsStore.getState();

          if (settings.showInStatusBar) {
            statusStore.setValue('mouse', formatCoord(worldCoord));
            const intensityEntry = entries.find(
              (e) => e.group === 'intensity' || e.label === 'Value'
            );
            statusStore.setValue('value', intensityEntry ? intensityEntry.value : '--');
          }

          if (settings.showInTooltip && entries.length > 0) {
            const tooltipStore = useTooltipStore.getState();
            tooltipStore.setTooltip({
              viewId: viewId as ViewId,
              screen: { x: sample.clientX, y: sample.clientY },
              world: worldCoord,
              entries: entries.map(toTooltipEntry),
            });
          }

          const intensityEntry = entries.find(
            (e) => e.group === 'intensity' || e.label === 'Value'
          );
          if (intensityEntry) {
            const value = parseFloat(intensityEntry.value);
            setHoverValue((prev) =>
              Number.isFinite(value) && prev !== null && Math.abs(prev - value) < 1e-6
                ? prev
                : Number.isFinite(value)
                  ? value
                  : null
            );
          } else {
            setHoverValue(null);
          }
        } catch (err) {
          console.error('[useHoverInfo] Error handling mouse move:', err);
          setHoverValue(null);
          setHoverEntries([]);
        }
      },
      throttleMs,
      { leading: true, trailing: true }
    );
  }, [viewId, throttleMs]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const target = event.currentTarget as HTMLElement | null;
      if (!target || typeof target.getBoundingClientRect !== 'function') {
        return;
      }
      const rect = target.getBoundingClientRect();
      throttledMouseMove({
        clientX: event.clientX,
        clientY: event.clientY,
        rectLeft: rect.left,
        rectTop: rect.top,
      });
    },
    [throttledMouseMove]
  );

  // Cleanup throttled handler on unmount
  useEffect(() => {
    return () => {
      (throttledMouseMove as ReturnType<typeof throttle>).cancel?.();
    };
  }, [throttledMouseMove]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setHoverValue(null);
    setHoverEntries([]);

    const mouseStore = useMouseCoordinateStore.getState();
    mouseStore.clearMousePosition();

    const statusStore = useStatusBarStore.getState();
    statusStore.setValue('mouse', '--');
    statusStore.setValue('value', '--');

    const tooltipStore = useTooltipStore.getState();
    tooltipStore.clearTooltip();
  }, []);

  return {
    handleMouseMove,
    handleMouseLeave,
    hoverValue,
    hoverEntries,
  };
}
