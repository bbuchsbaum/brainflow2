/**
 * ComparisonPanel Component
 *
 * Renders a single comparison panel as a viewport frame: the shared
 * SliceViewport on canvas black, the frame header (the panel's own layer,
 * plane, slice mm), orientation letters, a rail scrubber, a colorbar for a
 * scalar-overlay panel, and panel actions in a hover/focus-revealed slot.
 * Uses tag-based rendering (same pattern as MosaicCell).
 */

import { useCallback, useEffect, useRef, useMemo, useState, type FocusEvent } from 'react';
import { SliceViewport, type SliceViewportPlacement } from './SliceViewport';
import { SLIDER_HEIGHT } from './constants';
import { SliceSlider } from '@/components/ui/SliceSlider';
import { X } from 'lucide-react';
import { IconButton, Select } from '@/components/ui/bf';
import { useLayerStore } from '@/stores/layerStore';
import { sliceRangeForMetadata } from '@/services/SliceNavigationService';
import { useLayerValueAtWorld } from '@/hooks/useLayerValueAtWorld';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import { formatLayerValue } from '@/utils/valueFormat';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { buildActiveCrosshairStyle, type CrosshairStyle } from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { comparisonTag, getComparisonRenderService } from '@/services/ComparisonRenderService';
import type { ComparisonPanelConfig } from '@/types/comparison';
import { useViewportDropTarget } from './viewport/useViewportDropTarget';
import { createDebugLogger } from '@/utils/debug';
import {
  OrientationLabels,
  PLANE_AXIS_INDEX,
  ViewportColorbar,
  ViewportHeader,
  shortLayerLabel,
  useLayerColorbar,
  orientationLabelKey as buildOrientationLabelKey,
  useOrientationLabelKnockouts,
} from './viewportFrame';

const debug = createDebugLogger('comparison-render');

const PANEL_PLANE_OPTIONS = [
  { value: 'axial', label: 'Axial' },
  { value: 'sagittal', label: 'Sagittal' },
  { value: 'coronal', label: 'Coronal' },
] as const;

interface ComparisonPanelProps {
  workspaceId: string;
  panel: ComparisonPanelConfig;
  width: number;
  height: number;
  layerNames: Map<string, string>;
  onRemoveLayer: (panelId: string, layerId: string) => void;
  onRemovePanel: (panelId: string) => void;
  onViewTypeChange: (panelId: string, viewType: 'axial' | 'sagittal' | 'coronal') => void;
  /** Called when a layer is dropped onto this panel */
  onLayerDrop?: (panelId: string, layerId: string) => void;
  /** Called when a file path is dropped onto this panel */
  onFileDrop?: (panelId: string, path: string) => void | Promise<void>;
  /** Called when a native file is dropped onto this panel */
  onNativeFileDrop?: (panelId: string, file: File) => void | Promise<void>;
}

/** Space the colorbar keeps clear at the top-right for the panel actions slot. */
const PANEL_ACTIONS_RESERVE = 28;
/**
 * Outer voxel-edge box of a volume: voxel-centre `worldBounds` widened by half
 * a voxel on each axis (spacing from bounds and dimensions, else `spacing`).
 */
export function volumeEdgeBounds(
  metadata:
    | { worldBounds?: { min: [number, number, number]; max: [number, number, number] }; dimensions?: [number, number, number]; spacing?: [number, number, number] }
    | null
    | undefined,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const b = metadata?.worldBounds;
  if (!b) return null;
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a += 1) {
    const lo = Math.min(b.min[a], b.max[a]);
    const hi = Math.max(b.min[a], b.max[a]);
    const n = metadata?.dimensions?.[a];
    const sp = n && n > 1 ? (hi - lo) / (n - 1) : (metadata?.spacing?.[a] ?? 0);
    const half = Number.isFinite(sp) && sp > 0 ? sp / 2 : 0;
    min[a] = lo - half;
    max[a] = hi + half;
  }
  return { min, max };
}

export function ComparisonPanel({
  workspaceId,
  panel,
  width,
  height,
  layerNames,
  onRemoveLayer,
  onRemovePanel,
  onViewTypeChange,
  onLayerDrop,
  onFileDrop,
  onNativeFileDrop,
}: ComparisonPanelProps) {
  const tag = comparisonTag(panel.id, panel.viewType);
  const renderService = useMemo(() => getComparisonRenderService(), []);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const fallbackCanvasSize = useMemo(() => ({
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height - SLIDER_HEIGHT)),
  }), [width, height]);
  const [measuredCanvasSize, setMeasuredCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const canvasSize = measuredCanvasSize ?? fallbackCanvasSize;

  useEffect(() => {
    setMeasuredCanvasSize(null);
  }, [fallbackCanvasSize.width, fallbackCanvasSize.height]);

  useEffect(() => {
    const node = canvasContainerRef.current;
    if (!node) return;

    const publishSize = (nextSize: { width: number; height: number }) => {
      if (nextSize.width <= 0 || nextSize.height <= 0) return;

      setMeasuredCanvasSize(current =>
        current?.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      );
      debug(`[ComparisonPanel] measured canvas ${panel.id}`, {
        size: nextSize,
        layoutSize: { width, height },
        viewType: panel.viewType,
      });
    };

    const rect = node.getBoundingClientRect();
    publishSize({
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;

      publishSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [height, panel.id, panel.viewType, width]);

  const viewStateRevision = useViewStateStore(
    state => state.getWorkspaceViewStateRevisions(workspaceId).state
  );

  useEffect(() => {
    void renderService.renderPanel({
      workspaceId,
      panel,
      width: canvasSize.width,
      height: canvasSize.height,
    });

    return () => {
      renderService.cancelRenders([tag]);
    };
  }, [
    canvasSize.width,
    canvasSize.height,
    panel,
    renderService,
    tag,
    viewStateRevision,
    workspaceId,
  ]);

  const renderContext = useMemo(() => ({
    id: tag,
    type: 'comparison-panel' as const,
    dimensions: { width: canvasSize.width, height: canvasSize.height },
    metadata: {
      panelId: panel.id,
      viewType: panel.viewType,
    },
  }), [tag, canvasSize.width, canvasSize.height, panel.id, panel.viewType]);

  const workspaceCrosshairWorld = useViewStateStore(
    state => state.getWorkspaceViewState(workspaceId).crosshair.world_mm
  );
  const workspaceCrosshairVisible = useViewStateStore(
    state => state.getWorkspaceViewState(workspaceId).crosshair.visible
  );
  const crosshair = useMemo(() => ({
    visible: workspaceCrosshairVisible,
    world_mm: workspaceCrosshairWorld,
  }), [workspaceCrosshairVisible, workspaceCrosshairWorld]);
  const fallbackViewPlane = useViewStateStore(
    state => state.getWorkspaceViewState(workspaceId).views[panel.viewType]
  );
  const resolvedViewPlane = useComparisonStore(state => state.getPanelViewPlane(panel.id));
  const viewPlane = resolvedViewPlane ?? fallbackViewPlane;
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(panel.viewType));
  const setCrosshair = useRef(useViewStateStore.getState().setCrosshair).current;
  const crosshairStyle = useMemo<CrosshairStyle>(() => buildActiveCrosshairStyle({
    activeColor: crosshairSettings.activeColor,
    activeThickness: crosshairSettings.activeThickness,
    activeStyle: crosshairSettings.activeStyle,
    centerGap: crosshairSettings.centerGap,
  }), [
    crosshairSettings.activeColor,
    crosshairSettings.activeThickness,
    crosshairSettings.activeStyle,
    crosshairSettings.centerGap,
  ]);

  const handleWorldClick = useCallback((worldCoord: [number, number, number]) => {
    setCrosshair(worldCoord, true);
  }, [setCrosshair]);

  const { handleDragOver, handleDrop } = useViewportDropTarget({
    onLayerDrop: (layerId) => onLayerDrop?.(panel.id, layerId),
    onPathDrop: (path) => onFileDrop?.(panel.id, path),
    onNativeFileDrop: (file) => onNativeFileDrop?.(panel.id, file),
  });

  // ── Viewport frame ──────────────────────────────────────────────────────
  // The panel IS its frame: canvas + header overlay (the panel's own layer,
  // plane, slice mm) + letters + rail + colorbar. Plane select and close sit
  // in a header right slot revealed on hover or keyboard focus.
  const labelKey = buildOrientationLabelKey(viewPlane, true);
  const { refs: orientationLabelRefs, getKnockouts } = useOrientationLabelKnockouts(labelKey);
  const setHeaderElement = useCallback(
    (el: HTMLDivElement | null) => {
      orientationLabelRefs.current[4] = el;
    },
    [orientationLabelRefs],
  );

  const workspaceLayers = useViewStateStore(
    state => state.getWorkspaceViewState(workspaceId).layers
  );
  // The panel's own layer: its topmost layer in composite order.
  const panelLayer = useMemo(() => {
    for (let i = workspaceLayers.length - 1; i >= 0; i -= 1) {
      if (panel.visibleLayerIds.has(workspaceLayers[i].id)) return workspaceLayers[i];
    }
    return null;
  }, [workspaceLayers, panel.visibleLayerIds]);
  const panelLayerId = panelLayer?.id ?? null;
  const panelLayerName = panelLayerId ? (layerNames.get(panelLayerId) ?? panelLayer?.name ?? panelLayerId) : null;
  const panelMetadata = useLayerStore(state =>
    panelLayerId ? state.layerMetadata.get(panelLayerId) : undefined
  );
  const hasLayers = panel.visibleLayerIds.size > 0;

  // Rail scrubber: the panel layer's grid along the panel's slice axis.
  const axis = PLANE_AXIS_INDEX[panel.viewType];
  const sliceRange = useMemo(
    () => sliceRangeForMetadata(panelMetadata, axis, crosshair.world_mm[axis]),
    [panelMetadata, axis, crosshair.world_mm],
  );
  const handleSliderChange = useCallback(
    (value: number) => {
      const current = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm;
      const position = Math.max(sliceRange.min, Math.min(sliceRange.max, value));
      if (current[axis] === position) return;
      const next: [number, number, number] = [current[0], current[1], current[2]];
      next[axis] = position;
      setCrosshair(next, true);
    },
    [axis, setCrosshair, sliceRange.min, sliceRange.max, workspaceId],
  );

  // Header layout reserves the widest position of the scrub range.
  const headerRangeMm = useMemo<[number, number]>(
    () => [sliceRange.min, sliceRange.max],
    [sliceRange.min, sliceRange.max],
  );

  // Crosshair clip: the volume's outer voxel EDGES (voxel-centre bounds
  // widened by half a voxel per axis), so lines reach the image border.
  const crosshairEdgeBounds = useMemo(
    () => volumeEdgeBounds(panelMetadata),
    [panelMetadata],
  );

  // Per-pane value: the panel layer at the crosshair (nearest voxel), shown
  // in the header's right slot; the status bar follows the panel under the
  // pointer / last focused, so the two never disagree.
  const panelReading = useLayerValueAtWorld(panelLayerId, crosshair.world_mm);
  const panelValueText =
    panelLayerId && panelReading
      ? panelReading.value !== null
        ? formatLayerValue(panelReading.value)
        : '—'
      : null;
  const readoutSource = `compare:${workspaceId}:${panel.id}`;
  const claimReadout = useCallback(() => {
    if (!panelLayerId || !panelLayerName) return;
    useStatusReadoutStore.getState().claim({
      source: readoutSource,
      layerId: panelLayerId,
      name: panelLayerName,
    });
  }, [panelLayerId, panelLayerName, readoutSource]);
  // Keep an existing claim current when the panel's layer changes; release
  // it when the panel goes away.
  useEffect(() => {
    const cur = useStatusReadoutStore.getState().override;
    if (cur?.source !== readoutSource) return;
    if (panelLayerId && panelLayerName) claimReadout();
    else useStatusReadoutStore.getState().release(readoutSource);
  }, [claimReadout, panelLayerId, panelLayerName, readoutSource]);
  useEffect(
    () => () => useStatusReadoutStore.getState().release(readoutSource),
    [readoutSource],
  );
  // Leaving the panel hands the status bar back to the global active-layer
  // rule; a panel that still holds keyboard focus keeps its claim until focus
  // leaves it too.
  const releaseReadout = useCallback(() => {
    useStatusReadoutStore.getState().release(readoutSource);
  }, [readoutSource]);
  const handlePointerLeave = useCallback(() => releaseReadout(), [releaseReadout]);
  const handleBlurCapture = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return;
      if (e.currentTarget.matches(':hover')) return;
      releaseReadout();
    },
    [releaseReadout],
  );
  const panelLabel = panelLayerName
    ? shortLayerLabel(panelLayerName)
    : panel.label
      ? shortLayerLabel(panel.label)
      : `panel ${panel.id}`;

  // Colorbar keyed to the panel's own layer when it is a scalar overlay.
  const colorbarLayer = useLayerColorbar(panelLayerId, workspaceId);
  const colorbarReading = useLayerValueAtWorld(colorbarLayer?.layerId ?? null, crosshair.world_mm);
  const [placement, setPlacement] = useState<SliceViewportPlacement | null>(null);
  const handlePlacementChange = useCallback((next: SliceViewportPlacement) => {
    setPlacement(current =>
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next
    );
  }, []);
  const imageRect = useMemo(() => {
    const node = canvasContainerRef.current;
    const canvas = node?.querySelector('canvas');
    if (!placement || !canvas || canvas.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const k = rect.width > 0 ? rect.width / canvas.width : 1;
    return {
      left: placement.x * k,
      top: placement.y * k,
      right: (placement.x + placement.width) * k,
      bottom: (placement.y + placement.height) * k,
    };
  }, [placement, canvasSize.width, canvasSize.height]);

  const extraLayerIds = panel.visibleLayerIds.size > 1 ? Array.from(panel.visibleLayerIds) : [];

  return (
    <div
      className="group/panel relative h-full overflow-hidden bg-[var(--bf-bg-canvas)]"
      style={{ minHeight: `${height}px`, height: `${height}px` }}
      data-testid="comparison-panel"
      data-panel-id={panel.id}
      onPointerEnter={claimReadout}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={claimReadout}
      onBlurCapture={handleBlurCapture}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Canvas area (the rail strip below takes no image space from the fit) */}
      <div
        ref={canvasContainerRef}
        className="absolute inset-x-0 top-0"
        style={{ bottom: hasLayers ? SLIDER_HEIGHT : 0 }}
      >
        <SliceViewport
          width={canvasSize.width}
          height={canvasSize.height}
          context={renderContext}
          tag={tag}
          viewPlane={viewPlane}
          crosshair={crosshair}
          crosshairStyle={crosshairStyle}
          getCrosshairKnockouts={getKnockouts}
          crosshairWorldBounds={crosshairEdgeBounds}
          onPlacementChange={handlePlacementChange}
          onWorldClick={handleWorldClick}
          className="w-full h-full"
          canvasClassName="cursor-crosshair"
        />
        {hasLayers ? (
          <ViewportHeader
            plane={panel.viewType}
            positionMm={crosshair.world_mm[axis]}
            layerName={panelLayerName}
            width={canvasSize.width}
            height={canvasSize.height}
            elementRef={setHeaderElement}
            rangeMm={headerRangeMm}
            showPlane={false}
            requireName
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-bf-xs text-bf-text-muted">
            Drop a layer or file here
          </div>
        )}
        {colorbarLayer && (
          <ViewportColorbar
            layer={colorbarLayer}
            width={canvasSize.width}
            height={canvasSize.height}
            imageRect={imageRect}
            topReserve={PANEL_ACTIONS_RESERVE}
            value={colorbarReading?.value ?? null}
          />
        )}
        {viewPlane && hasLayers && <OrientationLabels viewPlane={viewPlane} refs={orientationLabelRefs} />}

        {/* Header right slot: the pane's value (always shown, mono) and the
            panel actions, revealed on hover / keyboard focus. */}
        <div className="absolute right-1.5 top-1 z-20 flex items-start gap-1">
          <div
            data-testid="comparison-panel-actions"
            className="flex items-center gap-1 rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)] px-0.5 py-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/panel:opacity-100 motion-reduce:transition-none"
          >
            {extraLayerIds.map(lid => (
              <span
                key={lid}
                className="inline-flex min-w-0 max-w-[120px] items-center gap-0.5 rounded-bf-xs border border-bf-border px-1 text-bf-2xs text-bf-text-secondary"
                title={layerNames.get(lid) ?? lid}
              >
                <span className="truncate">{layerNames.get(lid) ?? lid}</span>
                <IconButton
                  size="xs"
                  icon={<X />}
                  className="-mr-1 ml-0.5"
                  onClick={() => onRemoveLayer(panel.id, lid)}
                  title="Remove layer"
                  aria-label={`Remove ${layerNames.get(lid) ?? lid} from panel ${panelLabel}`}
                />
              </span>
            ))}
            <Select
              className="w-auto"
              aria-label={`Panel orientation, ${panelLabel}`}
              value={panel.viewType}
              options={PANEL_PLANE_OPTIONS}
              onValueChange={v => onViewTypeChange(panel.id, v as 'axial' | 'sagittal' | 'coronal')}
            />
            <IconButton
              size="xs"
              icon={<X />}
              onClick={() => onRemovePanel(panel.id)}
              title="Remove panel"
              aria-label={`Remove panel ${panelLabel}`}
            />
          </div>
          {panelValueText !== null && hasLayers && (
            <span
              data-testid="comparison-panel-value"
              // Same top, size and line height as the header on the left, so
              // the two sit on one baseline.
              className="pointer-events-none rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)] px-1 font-mono text-bf-xs tabular-nums text-bf-text-secondary"
              title={`Value at crosshair: nearest-voxel value of ${panelLayerName}`}
              role="note"
              aria-label={`Value at crosshair, ${panelLayerName}: ${panelValueText}`}
            >
              {/* Named on screen, like the status bar's "Value". */}
              <span className="mr-1 font-sans text-bf-text-muted">Value</span>
              {panelValueText}
            </span>
          )}
        </div>
      </div>

      {hasLayers && (
        <div className="absolute inset-x-0 bottom-0" style={{ height: SLIDER_HEIGHT }}>
          <SliceSlider
            viewType={panel.viewType}
            value={crosshair.world_mm[axis]}
            min={sliceRange.min}
            max={sliceRange.max}
            step={sliceRange.step}
            onChange={handleSliderChange}
            ariaLabel={`${panel.viewType.charAt(0).toUpperCase()}${panel.viewType.slice(1)} slice position, ${panelLabel}`}
          />
        </div>
      )}
    </div>
  );
}
