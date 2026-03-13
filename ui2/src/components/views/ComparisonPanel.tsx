/**
 * ComparisonPanel Component
 *
 * Renders a single comparison panel with its own SliceRenderer,
 * crosshair overlay, and panel header with layer badges.
 * Uses tag-based rendering (same pattern as MosaicCell).
 */

import { useCallback, useRef, useMemo, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { SliceRenderer } from './SliceRenderer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { drawCrosshair, getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { CoordinateTransform } from '@/utils/coordinates';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { comparisonTag } from '@/services/ComparisonRenderService';
import type { ComparisonPanelConfig } from '@/types/comparison';
import type { ViewPlane } from '@/types/coordinates';
import { readFileDragData, readLayerDragData } from '@/utils/layerDrag';

interface ComparisonPanelProps {
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

  const renderContext = useMemo(() => ({
    id: tag,
    type: 'comparison-panel' as const,
    dimensions: { width, height },
    metadata: {
      panelId: panel.id,
      viewType: panel.viewType,
    },
  }), [tag, width, height, panel.id, panel.viewType]);

  // Register context
  useEffect(() => {
    const store = useRenderStateStore.getState();
    store.registerContext(renderContext);
  }, [renderContext]);

  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  const viewPlane = useViewStateStore(state => state.viewState.views[panel.viewType]);
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(panel.viewType));
  const setCrosshair = useRef(useViewStateStore.getState().setCrosshair).current;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagePlacementRef = useRef<{
    x: number; y: number; width: number; height: number;
    imageWidth: number; imageHeight: number;
  } | null>(null);
  const viewPlaneRef = useRef<ViewPlane | null>(null);

  useEffect(() => {
    if (viewPlane) viewPlaneRef.current = viewPlane;
  }, [viewPlane]);

  // Keep crosshair data in refs for stable customRender
  const crosshairRef = useRef(crosshair);
  useEffect(() => { crosshairRef.current = crosshair; }, [crosshair]);
  const crosshairSettingsRef = useRef(crosshairSettings);
  useEffect(() => { crosshairSettingsRef.current = crosshairSettings; }, [crosshairSettings]);

  // Custom render callback to draw crosshair overlay
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    imagePlacementRef.current = placement;
    const cr = crosshairRef.current;
    const chs = crosshairSettingsRef.current;
    const vp = viewPlaneRef.current;
    if (!cr?.visible || !chs?.visible || !vp) return;

    const screenCoord = CoordinateTransform.worldToScreen(cr.world_mm, vp);
    if (!screenCoord) return;

    const scaleX = placement.width / placement.imageWidth;
    const scaleY = placement.height / placement.imageHeight;
    const canvasX = placement.x + screenCoord[0] * scaleX;
    const canvasY = placement.y + screenCoord[1] * scaleY;

    const style: CrosshairStyle = {
      color: chs.activeColor,
      lineWidth: chs.activeThickness,
      lineDash: getLineDash(chs.activeStyle, chs.activeThickness),
      opacity: 1,
    };

    drawCrosshair({ ctx, canvasX, canvasY, bounds: placement, style });
  }, []);

  // Handle mouse clicks to update global crosshair
  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!canvasRef.current || !imagePlacementRef.current) return;
    const currentView = viewPlaneRef.current;
    if (!currentView) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    const placement = imagePlacementRef.current;
    if (canvasX < placement.x || canvasX > placement.x + placement.width ||
        canvasY < placement.y || canvasY > placement.y + placement.height) {
      return;
    }

    const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
    const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;

    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, currentView);
    setCrosshair(worldCoord, true);
  }, [setCrosshair]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);

  // Drag-drop support — accept layer drops
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void onNativeFileDrop?.(panel.id, files[0]);
      return;
    }

    const data = readLayerDragData(e.dataTransfer);
    if (data?.layerId && onLayerDrop) {
      onLayerDrop(panel.id, data.layerId);
      return;
    }

    const fileData = readFileDragData(e.dataTransfer);
    if (fileData?.path && onFileDrop) {
      void onFileDrop(panel.id, fileData.path);
    }
  }, [panel.id, onFileDrop, onLayerDrop, onNativeFileDrop]);

  const canvasHeight = Math.max(height - COMPARISON_PANEL_HEADER_HEIGHT, 64);

  const layerBadges = Array.from(panel.visibleLayerIds);

  return (
    <div
      className="flex flex-col h-full border border-zinc-700 rounded overflow-hidden bg-zinc-900"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Panel header */}
      <div
        className="flex items-center gap-1 px-2 shrink-0 bg-zinc-800 border-b border-zinc-700 select-none"
        style={{ height: COMPARISON_PANEL_HEADER_HEIGHT }}
      >
        <span className="text-[11px] text-zinc-300 font-medium truncate mr-1">
          {panel.label}
        </span>

        {/* Layer badges */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden">
          {layerBadges.map(lid => (
            <span
              key={lid}
              className="inline-flex items-center gap-0.5 bg-zinc-700 text-zinc-300 text-[9px] px-1 rounded max-w-[80px] truncate"
              title={layerNames.get(lid) ?? lid}
            >
              {layerNames.get(lid) ?? lid}
              <button
                className="text-zinc-500 hover:text-zinc-200 ml-0.5"
                onClick={() => onRemoveLayer(panel.id, lid)}
                title="Remove layer"
              >
                ×
              </button>
            </span>
          ))}
          {layerBadges.length === 0 && (
            <span className="text-[9px] text-zinc-500 italic">
              Drop a layer or file here
            </span>
          )}
        </div>

        {/* Per-panel orientation override */}
        <select
          className="bg-zinc-700 text-zinc-300 text-[10px] rounded px-0.5 cursor-pointer border-none outline-none"
          value={panel.viewType}
          onChange={e => onViewTypeChange(panel.id, e.target.value as 'axial' | 'sagittal' | 'coronal')}
        >
          <option value="axial">Ax</option>
          <option value="sagittal">Sag</option>
          <option value="coronal">Cor</option>
        </select>

        {/* Remove panel */}
        <button
          className="text-zinc-500 hover:text-red-400 text-[12px] ml-0.5"
          onClick={() => onRemovePanel(panel.id)}
          title="Remove panel"
        >
          ✕
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative" onClick={handleMouseDown}>
        <SliceRenderer
          width={width}
          height={canvasHeight}
          context={renderContext}
          tag={tag}
          customRender={customRender}
          onCanvasReady={handleCanvasReady}
          className="w-full h-full cursor-crosshair"
        />
      </div>
    </div>
  );
}
