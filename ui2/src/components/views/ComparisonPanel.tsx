/**
 * ComparisonPanel Component
 *
 * Renders a single comparison panel with a shared SliceViewport
 * plus a comparison-specific header and drag/drop behavior.
 * Uses tag-based rendering (same pattern as MosaicCell).
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { SliceViewport } from './SliceViewport';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { comparisonTag, getComparisonRenderService } from '@/services/ComparisonRenderService';
import type { ComparisonPanelConfig } from '@/types/comparison';
import { useViewportDropTarget } from './viewport/useViewportDropTarget';
import { createDebugLogger } from '@/utils/debug';

const debug = createDebugLogger('comparison-render');

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

export const COMPARISON_PANEL_HEADER_HEIGHT = 28;

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
    height: Math.max(1, Math.floor(height - COMPARISON_PANEL_HEADER_HEIGHT)),
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
  const crosshairStyle = useMemo<CrosshairStyle>(() => ({
    color: crosshairSettings.activeColor,
    lineWidth: crosshairSettings.activeThickness,
    lineDash: getLineDash(crosshairSettings.activeStyle, crosshairSettings.activeThickness),
    opacity: 1,
  }), [
    crosshairSettings.activeColor,
    crosshairSettings.activeThickness,
    crosshairSettings.activeStyle,
  ]);

  const handleWorldClick = useCallback((worldCoord: [number, number, number]) => {
    setCrosshair(worldCoord, true);
  }, [setCrosshair]);

  const { handleDragOver, handleDrop } = useViewportDropTarget({
    onLayerDrop: (layerId) => onLayerDrop?.(panel.id, layerId),
    onPathDrop: (path) => onFileDrop?.(panel.id, path),
    onNativeFileDrop: (file) => onNativeFileDrop?.(panel.id, file),
  });

  const layerBadges = Array.from(panel.visibleLayerIds);
  const badgeLayerIds = layerBadges.length > 1 ? layerBadges : [];

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-appsm border border-border bg-card shadow-sm"
      style={{ minHeight: `${height}px`, height: `${height}px` }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Panel header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/10 px-3 select-none"
        style={{ height: COMPARISON_PANEL_HEADER_HEIGHT }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[11px] font-medium text-foreground" title={panel.label}>
            {panel.label}
          </span>

          {/* Extra layer badges only; single-layer panels use the title alone */}
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {badgeLayerIds.map(lid => (
              <span
                key={lid}
                className="inline-flex min-w-0 max-w-[132px] items-center gap-0.5 rounded-appsm border border-border bg-background px-1.5 text-[9px] text-muted-foreground"
                title={layerNames.get(lid) ?? lid}
              >
                <span className="truncate">{layerNames.get(lid) ?? lid}</span>
                <button
                  className="ml-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onRemoveLayer(panel.id, lid)}
                  title="Remove layer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {layerBadges.length === 0 && (
            <span className="text-[9px] italic text-muted-foreground">
              Drop a layer or file here
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Per-panel orientation override */}
          <select
            className="rounded-appsm border border-border bg-background px-1 py-0.5 text-[10px] text-foreground outline-none transition-colors hover:border-primary/60"
            value={panel.viewType}
            onChange={e => onViewTypeChange(panel.id, e.target.value as 'axial' | 'sagittal' | 'coronal')}
          >
            <option value="axial">Ax</option>
            <option value="sagittal">Sag</option>
            <option value="coronal">Cor</option>
          </select>

          {/* Remove panel */}
          <button
            className="text-[12px] text-muted-foreground transition-colors hover:text-destructive"
            onClick={() => onRemovePanel(panel.id)}
            title="Remove panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={canvasContainerRef} className="flex-1 relative">
        <SliceViewport
          width={canvasSize.width}
          height={canvasSize.height}
          context={renderContext}
          tag={tag}
          viewPlane={viewPlane}
          crosshair={crosshair}
          crosshairStyle={crosshairStyle}
          onWorldClick={handleWorldClick}
          className="w-full h-full"
          canvasClassName="cursor-crosshair"
        />
      </div>
    </div>
  );
}
