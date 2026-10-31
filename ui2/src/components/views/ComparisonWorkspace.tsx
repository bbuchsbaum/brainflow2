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
import type { ComparisonPanelConfig } from '@/types/comparison';
import { EmptyPane, focusFallback, SegmentedControl } from '@/components/ui/bf';
import { openFileDialog } from '@/services/fileActions';
import { panelLetter, type CompareLinkMode } from '@/types/comparison';
import { linkModeOf, resolveActivePanel } from '@/utils/compareDisplay';
import { CompareSharedColorbar } from './CompareSharedColorbar';
import { panelLayerIdOf } from '@/utils/compareDisplay';
import { COMPARE_PANE_COUNTS, DEFAULT_COMPARE_PANES, comparePaneCandidates } from '@/utils/comparePanes';

const PLANE_OPTIONS = [
  { value: 'axial', label: 'Axial', title: 'Set all panels to axial' },
  { value: 'sagittal', label: 'Sagittal', title: 'Set all panels to sagittal' },
  { value: 'coronal', label: 'Coronal', title: 'Set all panels to coronal' },
] as const;

const LAYOUT_OPTIONS = [
  { value: 'row', label: 'Row', title: 'Row layout' },
  { value: 'grid', label: 'Grid', title: 'Grid layout' },
] as const;

interface ComparisonWorkspaceProps {
  workspaceId?: string;
}

const EMPTY_PANELS: ComparisonPanelConfig[] = [];

/** The plane every panel shows, or null when panels differ (no panels: the global plane). */
export function resolveCommonViewType(
  panels: ReadonlyArray<Pick<ComparisonPanelConfig, 'viewType'>>,
  globalViewType: ComparisonPanelConfig['viewType'],
): ComparisonPanelConfig['viewType'] | null {
  if (panels.length === 0) return globalViewType;
  const first = panels[0].viewType;
  return panels.every(p => p.viewType === first) ? first : null;
}

const PANE_COUNT_OPTIONS = COMPARE_PANE_COUNTS.map((n) => ({
  value: String(n),
  label: String(n),
  title: `Show ${n} panes`,
}));

const LINK_OPTIONS = [
  { value: 'all', label: 'All', title: 'Every panel shares window, threshold and colormap' },
  { value: 'window', label: 'Window', title: 'Panels share the window; threshold and colormap per panel' },
  { value: 'threshold', label: 'Threshold', title: 'Panels share the threshold; window and colormap per panel' },
  { value: 'none', label: 'None', title: 'Window, threshold and colormap per panel' },
] as const;

function ComparisonWorkspaceRaw({ workspaceId = 'comparison-default' }: ComparisonWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 512, height: 512 });

  // Store selectors
  const panels = useComparisonStore(state => state.panels.get(workspaceId) ?? EMPTY_PANELS);
  const layout = useComparisonStore(state => state.layouts.get(workspaceId) ?? 'row');
  const globalViewType = useComparisonStore(state => state.globalViewTypes.get(workspaceId) ?? 'axial');
  const layers = useViewStateStore(state => state.getWorkspaceViewState(workspaceId).layers);
  // Linked Compare (P3.9): one shared display, or per-panel edits on the active panel.
  const linkMode = useComparisonStore(state => linkModeOf(state, workspaceId));
  const linked = linkMode === 'all';
  const activePanelId = useComparisonStore(
    state => resolveActivePanel(state, workspaceId)?.panel.id ?? null
  );
  const setLinkMode = useComparisonStore(state => state.setLinkMode);
  const setActivePanel = useComparisonStore(state => state.setActivePanel);
  const handleActivatePanel = useCallback(
    (panelId: string) => setActivePanel(workspaceId, panelId),
    [setActivePanel, workspaceId],
  );
  // Linked panels whose own layer is the same overlay share one colorbar.
  const layerInfos = useLayerStore(state => state.layers);
  const sharedColorbarLayerId = useMemo(() => {
    if (!linked || panels.length < 2) return null;
    const ids = panels.map(panel => panelLayerIdOf(panel, layers));
    const first = ids[0];
    if (!first || ids.some(id => id !== first)) return null;
    const info = layerInfos.find(l => l.id === first);
    return info && info.type !== 'label' ? first : null;
  }, [linked, panels, layers, layerInfos]);
  // The plane all panels share (null when per-panel overrides mix them).
  const commonViewType = useMemo(
    () => resolveCommonViewType(panels, globalViewType),
    [panels, globalViewType],
  );

  // Store actions (stable refs)
  const addPanel = useComparisonStore(state => state.addPanel);
  const removePanel = useComparisonStore(state => state.removePanel);
  const addLayerToPanel = useComparisonStore(state => state.addLayerToPanel);
  const removeLayerFromPanel = useComparisonStore(state => state.removeLayerFromPanel);
  const setPanelViewType = useComparisonStore(state => state.setPanelViewType);
  const setGlobalViewType = useComparisonStore(state => state.setGlobalViewType);
  const setLayout = useComparisonStore(state => state.setLayout);
  const initPanes = useComparisonStore(state => state.initPanes);
  const setPaneCount = useComparisonStore(state => state.setPaneCount);
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

  // The layers new panes take: the maps over the anatomy, then the anatomy.
  const paneCandidates = useMemo(
    () => comparePaneCandidates(visibleLayerIds, allLayers),
    [visibleLayerIds, allLayers]
  );

  // Auto-init: a new Compare tab opens with two panes, not one per layer
  // (QA features 2026-10-31 §6); each picks its layer in its header.
  useEffect(() => {
    if (panels.length > 0) return;
    if (visibleLayerIds.length === 0) return;
    initPanes(workspaceId, paneCandidates, layerNames);
  }, [initPanes, layerNames, panels.length, paneCandidates, visibleLayerIds.length, workspaceId]);

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

  // The empty state opens the default two panes, each with its picker.
  const handleAddEmptyPanel = useCallback(() => {
    setPaneCount(workspaceId, DEFAULT_COMPARE_PANES, []);
  }, [workspaceId, setPaneCount]);

  const { handleDragOver: handleWorkspaceDragOver, handleDrop: handleWorkspaceDrop } = useViewportDropTarget({
    onLayerDrop: handleNewPanelDrop,
    onPathDrop: handleDroppedFilePathToNewPanel,
    onNativeFileDrop: handleDroppedNativeFileToNewPanel,
  });

  if (panels.length === 0 && visibleLayerIds.length === 0) {
    // P3.11: the one empty state, over two dashed panel placeholders at the
    // panels' real arrangement (each a drop target for a volume).
    return (
      <div
        className="relative flex h-full w-full flex-col bg-bf-bg-canvas"
        onDragOver={handleWorkspaceDragOver}
        onDrop={handleWorkspaceDrop}
        data-testid="compare-empty"
      >
        <EmptyPane
          title="Add a panel to compare"
          hint="Each panel shows its own layers side by side; drop a volume on a placeholder."
          primary={{
            label: 'Open 2 panes',
            onClick: () => {
              handleAddEmptyPanel();
              // The empty state goes away: focus the toolbar's pane count.
              focusFallback(['[data-testid="compare-add-panel"] [role="radio"]']);
            },
            testId: 'compare-empty-add',
          }}
          secondary={{ label: 'Open file…', onClick: () => void openFileDialog() }}
          messageGround="canvas"
          backdrop={
            <div className="grid h-full w-full grid-cols-2 gap-2 p-2">
              {['A', 'B'].map((letter) => (
                <div
                  key={letter}
                  className="flex items-start rounded-bf-xs border border-dashed border-bf-border-strong p-2 text-bf-xs text-bf-text-muted"
                >
                  Panel {letter} · drop a volume
                </div>
              ))}
            </div>
          }
        />
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
        {/* No leading "Compare" label: the tab and the top-bar switcher already
            name the workspace. */}
        {/* Set every panel's plane (joined segmented group) */}
        {/* Pressed only while every panel shows that plane: after a per-panel
            override the planes are mixed and no item claims them all. */}
        <SegmentedControl
          aria-label="Set all panels to plane"
          options={PLANE_OPTIONS}
          value={commonViewType ?? ''}
          onValueChange={(vt) => setGlobalViewType(workspaceId, vt as ComparisonPanelConfig['viewType'])}
        />

        {/* Layout (joined segmented group) */}
        <SegmentedControl
          aria-label="Panel layout"
          options={LAYOUT_OPTIONS}
          value={layout}
          onValueChange={(mode) => setLayout(workspaceId, mode as 'row' | 'grid')}
        />

        {/* Link: which display properties the panels share. "All" is the
            default; an unshared property is edited per panel (the active
            panel, amber edge) in the Inspector. */}
        <span className="ml-auto text-bf-xs text-bf-text-secondary" id={`compare-link-${workspaceId}`}>
          Link
        </span>
        <SegmentedControl
          aria-labelledby={`compare-link-${workspaceId}`}
          options={LINK_OPTIONS}
          value={linkMode}
          onValueChange={(mode) => setLinkMode(workspaceId, mode as CompareLinkMode)}
          data-testid="compare-link-mode"
        />

        {/* Pane count: 2, 3 or 4 (new panes take the next unshown layer). */}
        <span className="text-bf-xs text-bf-text-secondary" id={`compare-panes-${workspaceId}`}>
          Panes
        </span>
        <SegmentedControl
          aria-labelledby={`compare-panes-${workspaceId}`}
          options={PANE_COUNT_OPTIONS}
          value={(COMPARE_PANE_COUNTS as readonly number[]).includes(panels.length) ? String(panels.length) : ''}
          onValueChange={(n) => setPaneCount(workspaceId, Number(n), paneCandidates, layerNames)}
          data-testid="compare-add-panel"
        />
      </div>


      <div className="flex min-h-0 flex-1">
      {/* Panel grid */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-[var(--bf-border)]"
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
        {panels.map((panel, index) => (
          <ComparisonPanel
            key={panel.id}
            workspaceId={workspaceId}
            panel={panel}
            letter={panelLetter(index)}
            linkMode={linkMode}
            active={!linked && panel.id === activePanelId}
            hideColorbar={sharedColorbarLayerId !== null}
            onActivate={handleActivatePanel}
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
      {/* Linked panels showing the same overlay share one colorbar column. */}
      {sharedColorbarLayerId ? (
        <CompareSharedColorbar workspaceId={workspaceId} layerId={sharedColorbarLayerId} />
      ) : null}
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
