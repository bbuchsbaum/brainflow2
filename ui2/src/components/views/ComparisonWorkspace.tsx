/**
 * ComparisonWorkspace Component
 *
 * Top-level container for multi-panel comparison views.
 * Manages panel layout, global orientation controls, and triggers
 * ComparisonRenderService when ViewState or panel config changes.
 */

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useLayerStore } from '@/stores/layerStore';
import { getComparisonRenderService, comparisonTag } from '@/services/ComparisonRenderService';
import { ComparisonPanel, COMPARISON_PANEL_HEADER_HEIGHT } from './ComparisonPanel';
import { NewPanelDropZone } from './NewPanelDropZone';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import { getComparisonGridSpec, getComparisonPanelDimensions } from '@/utils/comparisonLayout';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { findNewLayerId } from '@/utils/layerLoadResult';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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
  const viewStateRevision = useViewStateStore(
    state => state.getWorkspaceViewStateRevisions(workspaceId).state
  );
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

  // Trigger renders when ViewState or panel config changes
  const renderService = getComparisonRenderService();
  const renderHeight = useMemo(
    () => Math.max(panelDimensions.height - COMPARISON_PANEL_HEADER_HEIGHT, 64),
    [panelDimensions.height]
  );

  useEffect(() => {
    if (panels.length === 0) return;

    const requests = panels.map(panel => ({
      panel,
      width: panelDimensions.width,
      height: renderHeight,
    }));

    renderService.renderPanels(requests);

    // Cleanup
    return () => {
      const tags = panels.map(p => comparisonTag(p.id, p.viewType));
      renderService.cancelRenders(tags);
    };
  }, [
    panels,
    panelDimensions.width,
    renderHeight,
    viewStateRevision,
  ]);

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

  if (panels.length === 0 && visibleLayerIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Load volumes to start comparing
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 shrink-0 bg-zinc-900 border-b border-zinc-800 select-none" style={{ height: 32 }}>
        <span className="text-[11px] text-zinc-400 font-medium">Compare</span>

        {/* Global orientation */}
        <div className="flex items-center gap-0.5 ml-2">
          {(['axial', 'sagittal', 'coronal'] as const).map(vt => (
            <button
              key={vt}
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                globalViewType === vt
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
              onClick={() => setGlobalViewType(workspaceId, vt)}
              title={`Set all panels to ${vt}`}
            >
              {vt === 'axial' ? 'Ax' : vt === 'sagittal' ? 'Sag' : 'Cor'}
            </button>
          ))}
        </div>

        {/* Layout toggle */}
        <div className="flex items-center gap-0.5 ml-2">
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              layout === 'row' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
            onClick={() => setLayout(workspaceId, 'row')}
            title="Row layout"
          >
            Row
          </button>
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              layout === 'grid' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
            onClick={() => setLayout(workspaceId, 'grid')}
            title="Grid layout"
          >
            Grid
          </button>
        </div>

        {/* Add panel */}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 ml-auto"
          onClick={handleAddEmptyPanel}
          title="Add empty panel"
        >
          + Panel
        </button>
      </div>

      {/* Panel grid */}
      <div
        ref={containerRef}
        className="flex-1 p-1 overflow-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridSpec.cols}, minmax(0, 1fr))`,
          gap: '4px',
        }}
      >
        {panels.map(panel => (
          <ComparisonPanel
            key={panel.id}
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
        <NewPanelDropZone
          onDrop={handleNewPanelDrop}
          onFileDrop={handleDroppedFilePathToNewPanel}
          onNativeFileDrop={handleDroppedNativeFileToNewPanel}
        />
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
