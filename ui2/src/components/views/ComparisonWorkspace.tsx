/**
 * ComparisonWorkspace Component
 *
 * Top-level container for multi-panel comparison views.
 * Manages panel layout and global orientation controls. Each panel owns
 * its measured canvas size and render trigger.
 */

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useLayerStore } from '@/stores/layerStore';
import { ComparisonPanel } from './ComparisonPanel';
import { NewPanelDropZone } from './NewPanelDropZone';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import {
  COMPARISON_GRID_GAP,
  getComparisonGridSpec,
  getComparisonPanelDimensions,
} from '@/utils/comparisonLayout';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { findNewLayerId } from '@/utils/layerLoadResult';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useViewportDropTarget } from './viewport/useViewportDropTarget';

interface ComparisonWorkspaceProps {
  workspaceId?: string;
}

const EMPTY_PANELS: ComparisonPanelConfig[] = [];

function ComparisonWorkspaceRaw({ workspaceId = 'comparison-default' }: ComparisonWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 512, height: 512 });

  // Store selectors
  const panels = useComparisonStore(state => state.panels.get(workspaceId) ?? EMPTY_PANELS);
  const layout = useComparisonStore(state => state.layouts.get(workspaceId) ?? 'row');
  const globalViewType = useComparisonStore(state => state.globalViewTypes.get(workspaceId) ?? 'axial');
  const layers = useViewStateStore(state => state.getWorkspaceViewState(workspaceId).layers);

  // Store actions (stable refs)
  const addPanel = useComparisonStore(state => state.addPanel);
  const removePanel = useComparisonStore(state => state.removePanel);
  const addLayerToPanel = useComparisonStore(state => state.addLayerToPanel);
  const removeLayerFromPanel = useComparisonStore(state => state.removeLayerFromPanel);
  const setPanelViewType = useComparisonStore(state => state.setPanelViewType);
  const setGlobalViewType = useComparisonStore(state => state.setGlobalViewType);
  const setLayout = useComparisonStore(state => state.setLayout);
  const initFromLayers = useComparisonStore(state => state.initFromLayers);
  const activateWorkspace = useWorkspaceStore(state => state.activateWorkspace);

  // Build layer name lookup
  const allLayers = useLayerStore(state => state.layers);
  const layerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of allLayers) {
      map.set(l.id, l.name ?? l.id);
    }
    return map;
  }, [allLayers]);
  const visibleLayerIds = useMemo(
    () => layers.filter(layer => layer.visible).map(layer => layer.id),
    [layers]
  );

  // Auto-init: if workspace has no panels yet, create one per visible layer
  useEffect(() => {
    if (panels.length > 0) return;
    if (visibleLayerIds.length === 0) return;
    initFromLayers(workspaceId, visibleLayerIds, layerNames);
  }, [initFromLayers, layerNames, panels.length, visibleLayerIds, workspaceId]);

  // Track container size with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setContainerSize(current =>
          current.width === width && current.height === height
            ? current
            : { width, height }
        );
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Calculate per-panel dimensions
  const panelDimensions = useMemo(
    () => getComparisonPanelDimensions(containerSize, panels.length, layout),
    [containerSize, panels.length, layout]
  );
  const gridSpec = useMemo(
    () => getComparisonGridSpec(panels.length, layout),
    [panels.length, layout]
  );

  // Handlers
  const handleRemoveLayer = useCallback((panelId: string, layerId: string) => {
    removeLayerFromPanel(workspaceId, panelId, layerId);
  }, [workspaceId, removeLayerFromPanel]);

  const handleRemovePanel = useCallback((panelId: string) => {
    removePanel(workspaceId, panelId);
  }, [workspaceId, removePanel]);

  const handlePanelViewTypeChange = useCallback((panelId: string, vt: 'axial' | 'sagittal' | 'coronal') => {
    setPanelViewType(workspaceId, panelId, vt);
  }, [workspaceId, setPanelViewType]);

  const handleLayerDrop = useCallback((panelId: string, layerId: string) => {
    addLayerToPanel(workspaceId, panelId, layerId);
  }, [workspaceId, addLayerToPanel]);

  const handleNewPanelDrop = useCallback((layerId: string) => {
    addPanel(workspaceId, [layerId]);
  }, [workspaceId, addPanel]);

  const loadDroppedVolumeAsLayer = useCallback(async (loader: () => Promise<void>) => {
    activateWorkspace(workspaceId);

    const beforeLayerIds = new Set(useLayerStore.getState().layers.map(layer => layer.id));
    await loader();

    const loadedLayerId = findNewLayerId(beforeLayerIds, useLayerStore.getState().layers);
    return loadedLayerId;
  }, [activateWorkspace, workspaceId]);

  const handleDroppedFilePathToPanel = useCallback(async (panelId: string, path: string) => {
    const loadedLayerId = await loadDroppedVolumeAsLayer(() =>
      getFileLoadingService().loadFile(path, 'drag-drop', 'add-layer')
    );

    if (loadedLayerId) {
      addLayerToPanel(workspaceId, panelId, loadedLayerId);
    }
  }, [addLayerToPanel, loadDroppedVolumeAsLayer, workspaceId]);

  const handleDroppedNativeFileToPanel = useCallback(async (panelId: string, file: File) => {
    const loadedLayerId = await loadDroppedVolumeAsLayer(() =>
      getFileLoadingService().loadDroppedFile(file, 'add-layer')
    );

    if (loadedLayerId) {
      addLayerToPanel(workspaceId, panelId, loadedLayerId);
    }
  }, [addLayerToPanel, loadDroppedVolumeAsLayer, workspaceId]);

  const handleDroppedFilePathToNewPanel = useCallback(async (path: string) => {
    const loadedLayerId = await loadDroppedVolumeAsLayer(() =>
      getFileLoadingService().loadFile(path, 'drag-drop', 'add-layer')
    );

    if (loadedLayerId) {
      addPanel(workspaceId, [loadedLayerId]);
    }
  }, [addPanel, loadDroppedVolumeAsLayer, workspaceId]);

  const handleDroppedNativeFileToNewPanel = useCallback(async (file: File) => {
    const loadedLayerId = await loadDroppedVolumeAsLayer(() =>
      getFileLoadingService().loadDroppedFile(file, 'add-layer')
    );

    if (loadedLayerId) {
      addPanel(workspaceId, [loadedLayerId]);
    }
  }, [addPanel, loadDroppedVolumeAsLayer, workspaceId]);

  const handleAddEmptyPanel = useCallback(() => {
    addPanel(workspaceId, []);
  }, [workspaceId, addPanel]);

  const { handleDragOver: handleWorkspaceDragOver, handleDrop: handleWorkspaceDrop } = useViewportDropTarget({
    onLayerDrop: handleNewPanelDrop,
    onPathDrop: handleDroppedFilePathToNewPanel,
    onNativeFileDrop: handleDroppedNativeFileToNewPanel,
  });

  if (panels.length === 0 && visibleLayerIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6">
        <div className="rounded-appsm border border-border bg-card px-6 py-5 text-center shadow-sm">
          <p className="bf-role-section text-foreground">Comparison View</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Load or drag volumes to start comparing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 select-none"
        style={{ height: 36 }}
      >
        <span className="bf-role-section text-foreground">Compare</span>

        {/* Global orientation */}
        <div className="ml-1 flex items-center gap-1 rounded-appsm border border-border bg-background p-0.5">
          {(['axial', 'sagittal', 'coronal'] as const).map(vt => (
            <button
              key={vt}
              className={`bf-control-sm rounded-appsm border px-2 text-[10px] font-semibold transition-colors ${
                globalViewType === vt
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground'
              }`}
              onClick={() => setGlobalViewType(workspaceId, vt)}
              title={`Set all panels to ${vt}`}
            >
              {vt === 'axial' ? 'Ax' : vt === 'sagittal' ? 'Sag' : 'Cor'}
            </button>
          ))}
        </div>

        {/* Layout toggle */}
        <div className="flex items-center gap-1 rounded-appsm border border-border bg-background p-0.5">
          <button
            className={`bf-control-sm rounded-appsm border px-2 text-[10px] font-semibold transition-colors ${
              layout === 'row'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
            onClick={() => setLayout(workspaceId, 'row')}
            title="Row layout"
          >
            Row
          </button>
          <button
            className={`bf-control-sm rounded-appsm border px-2 text-[10px] font-semibold transition-colors ${
              layout === 'grid'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
            onClick={() => setLayout(workspaceId, 'grid')}
            title="Grid layout"
          >
            Grid
          </button>
        </div>

        {/* Add panel */}
        <button
          className="bf-control-sm ml-auto rounded-appsm border border-border bg-background px-2.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          onClick={handleAddEmptyPanel}
          title="Add empty panel"
        >
          + Panel
        </button>
      </div>

      {/* Panel grid */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-background p-2"
        onDragOver={handleWorkspaceDragOver}
        onDrop={handleWorkspaceDrop}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridSpec.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridSpec.rows}, minmax(${panelDimensions.height}px, ${panelDimensions.height}px))`,
          gridAutoRows: `${panelDimensions.height}px`,
          gap: `${COMPARISON_GRID_GAP}px`,
        }}
      >
        {panels.map(panel => (
          <ComparisonPanel
            key={panel.id}
            workspaceId={workspaceId}
            panel={panel}
            width={panelDimensions.width}
            height={panelDimensions.height}
            layerNames={layerNames}
            onRemoveLayer={handleRemoveLayer}
            onRemovePanel={handleRemovePanel}
            onViewTypeChange={handlePanelViewTypeChange}
            onLayerDrop={handleLayerDrop}
            onFileDrop={handleDroppedFilePathToPanel}
            onNativeFileDrop={handleDroppedNativeFileToPanel}
          />
        ))}
        {layout === 'grid' && (
          <NewPanelDropZone
            onDrop={handleNewPanelDrop}
            onFileDrop={handleDroppedFilePathToNewPanel}
            onNativeFileDrop={handleDroppedNativeFileToNewPanel}
          />
        )}
      </div>
    </div>
  );
}

export function ComparisonWorkspace(props: ComparisonWorkspaceProps) {
  return (
    <RenderErrorBoundary viewId={`comparison-${props.workspaceId ?? 'default'}`}>
      <ComparisonWorkspaceRaw {...props} />
    </RenderErrorBoundary>
  );
}
