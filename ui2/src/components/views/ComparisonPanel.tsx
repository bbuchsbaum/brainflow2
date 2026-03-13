/**
 * ComparisonPanel Component
 *
 * Renders a single comparison panel with a shared SliceViewport
 * plus a comparison-specific header and drag/drop behavior.
 * Uses tag-based rendering (same pattern as MosaicCell).
 */

import { useCallback, useRef, useMemo } from 'react';
import { SliceViewport } from './SliceViewport';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { comparisonTag } from '@/services/ComparisonRenderService';
import type { ComparisonPanelConfig } from '@/types/comparison';
import { useViewportDropTarget } from './viewport/useViewportDropTarget';

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

  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  const viewPlane = useViewStateStore(state => state.viewState.views[panel.viewType]);
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
      <div className="flex-1 relative">
        <SliceViewport
          width={width}
          height={canvasHeight}
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
