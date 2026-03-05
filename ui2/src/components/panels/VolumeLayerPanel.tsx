import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayers, useSelectedLayerId, useSelectedLayer, layerSelectors, useLayer, useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { getLayerService } from '@/services/LayerService';
import { LayerTable } from '../ui/LayerTable';
import { MetadataDrawer } from '../ui/MetadataDrawer';
import { useMetadataShortcut } from '@/hooks/useMetadataShortcut';
import { useLayerPanelServices } from '@/hooks/useLayerPanelServices';
import { LayerPropertiesManager } from './LayerPropertiesManager';
import { PlotPanel } from './PlotPanel';
import { LayerEmptyState } from './LayerEmptyState';
import { LayerStatusBar } from './LayerStatusBar';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { getEventBus } from '@/events/EventBus';
import type { LayerRender, Layer } from '@/types/layers';
import { BarChart3, Info, Layers, Palette } from 'lucide-react';
import './LayerPanel.css';

// Stable selectors — defined outside the component to avoid new references each render
const selectLayerSelector = (state: any) => state.selectLayer;

type SidebarTabId = 'layers' | 'inspect' | 'mapping' | 'plots';

const SIDEBAR_TAB_STORAGE_KEY = 'brainflow2-right-sidebar-tabs';
const SIDEBAR_TAB_DEFAULT: SidebarTabId = 'layers';

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'inspect', label: 'Inspect', icon: Info },
  { id: 'mapping', label: 'Mapping', icon: Palette },
  { id: 'plots', label: 'Plots', icon: BarChart3 },
];
const SIDEBAR_TAB_COMPACT_WIDTH_PX = 360;

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return value === 'layers' || value === 'inspect' || value === 'mapping' || value === 'plots';
}

function readSidebarTabPrefs(): Record<string, SidebarTabId> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sanitized: Record<string, SidebarTabId> = {};
    Object.entries(parsed).forEach(([workspaceId, value]) => {
      if (isSidebarTabId(value)) {
        sanitized[workspaceId] = value;
      }
    });
    return sanitized;
  } catch {
    return {};
  }
}

function writeSidebarTabPref(workspaceId: string, tabId: SidebarTabId): void {
  if (typeof window === 'undefined') return;
  const prefs = readSidebarTabPrefs();
  prefs[workspaceId] = tabId;
  window.localStorage.setItem(SIDEBAR_TAB_STORAGE_KEY, JSON.stringify(prefs));
}

const VolumeLayerPanelContent: React.FC = () => {
  // State for metadata drawer
  const [metadataLayerId, setMetadataLayerId] = useState<string | null>(null);
  const [isMetadataPinned, setIsMetadataPinned] = useState(false);
  
  // Use volume layers from layer store
  const layers = useLayers();
  const selectedLayerId = useSelectedLayerId();
  const selectedLayer = useSelectedLayer();
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaceTabKey = activeWorkspaceId ?? 'global';
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTabId>(SIDEBAR_TAB_DEFAULT);
  const [compactSidebarTabs, setCompactSidebarTabs] = useState(false);
  const sidebarTabListRef = useRef<HTMLDivElement | null>(null);
  const sidebarTabColumns = compactSidebarTabs ? 4 : 2;
  // Stable selector for selectLayer action (avoid inline arrow on every render)
  const selectLayer = useLayerStore(selectLayerSelector);
  // Metadata for the selected layer — selector stabilized via useMemo to avoid
  // re-subscription on every render (immer produces new Map refs per mutation)
  const metadataSelector = useMemo(
    () => selectedLayerId
      ? (state: any) => layerSelectors.getLayerMetadata(state, selectedLayerId)
      : () => undefined,
    [selectedLayerId]
  );
  const selectedMetadata = useLayer(metadataSelector);
  
  // Service initialization hook
  const { isInitialized: serviceInitialized, error: initializationError } = useLayerPanelServices();
  
  // Get layer render properties from ViewState (source of truth)
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const viewStateLayer = viewStateLayers.find(l => l.id === selectedLayerId);
  
  // Keyboard shortcut for metadata
  useMetadataShortcut({ onShowMetadata: setMetadataLayerId });
  
  // Convert ViewState layer to render properties format (memoized to prevent
  // child re-renders when viewStateLayer reference is stable)
  const selectedRender = useMemo(() => viewStateLayer ? {
    opacity: viewStateLayer.opacity,
    intensity: viewStateLayer.intensity,
    threshold: viewStateLayer.threshold,
    colormap: viewStateLayer.colormap,
    colormapId: (viewStateLayer as any).colormapId,
    interpolation: (viewStateLayer.interpolation || 'linear') as 'nearest' | 'linear',
    atlasConfig: (viewStateLayer as any).atlasConfig,
    atlasPaletteKind: (viewStateLayer as any).atlasPaletteKind,
    atlasPaletteSeed: (viewStateLayer as any).atlasPaletteSeed,
    atlasMaxLabel: (viewStateLayer as any).atlasMaxLabel,
  } : undefined, [viewStateLayer]);

  useEffect(() => {
    const tabPrefs = readSidebarTabPrefs();
    const stored = tabPrefs[workspaceTabKey];
    setActiveSidebarTab(stored ?? SIDEBAR_TAB_DEFAULT);
  }, [workspaceTabKey]);

  useEffect(() => {
    const node = sidebarTabListRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateCompact = (width: number) => {
      const nextCompact = width <= SIDEBAR_TAB_COMPACT_WIDTH_PX;
      setCompactSidebarTabs(prev => (prev === nextCompact ? prev : nextCompact));
    };

    updateCompact(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateCompact(entry.contentRect.width);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const handleSidebarTabChange = useCallback((tabId: SidebarTabId) => {
    setActiveSidebarTab((prev) => {
      if (prev === tabId) return prev;
      writeSidebarTabPref(workspaceTabKey, tabId);
      return tabId;
    });
  }, [workspaceTabKey]);

  const handleSidebarTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % SIDEBAR_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
    } else if (event.key === 'ArrowDown') {
      nextIndex = Math.min(index + sidebarTabColumns, SIDEBAR_TABS.length - 1);
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(index - sidebarTabColumns, 0);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = SIDEBAR_TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    handleSidebarTabChange(SIDEBAR_TABS[nextIndex].id);
  }, [handleSidebarTabChange, sidebarTabColumns]);

  const toggleVisibility = useCallback((layerId: string) => {
    try {
      const viewStateLayer = viewStateLayers.find(l => l.id === layerId);
      if (serviceInitialized) {
        const currentOpacity = viewStateLayer?.opacity ?? 1.0;
        const isCurrentlyVisible = currentOpacity > 0;
        getLayerService().toggleVisibility(layerId, !isCurrentlyVisible);
      }
    } catch (error) {
      console.error('[LayerPanel] Error in toggleVisibility:', error);
    }
  }, [viewStateLayers, serviceInitialized]);

  const handleReorder = useCallback((newLayers: Layer[]) => {
    const layerIds = newLayers.map((layer) => layer.id);
    if (!serviceInitialized) {
      console.warn('[VolumeLayerPanel] Ignoring reorder before LayerService initialization');
      return;
    }
    void getLayerService().reorderLayers(layerIds).catch((error) => {
      console.error('[VolumeLayerPanel] Failed to reorder layers:', error);
    });
  }, [serviceInitialized]);

  const handleOpacityChange = useCallback((layerId: string, opacity: number) => {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find(l => l.id === layerId);
      if (layer) {
        layer.opacity = opacity;
        layer.visible = opacity > 0;
      }
    });
    getEventBus().emit('layer.render.changed', {
      layerId,
      renderProps: { opacity },
    });
  }, []);

  const getLayerVisibility = useCallback((layerId: string) => {
    const vsl = viewStateLayers.find(l => l.id === layerId);
    return vsl ? vsl.opacity > 0 : true;
  }, [viewStateLayers]);

  const handleRemoveLayer = useCallback((layerId: string) => {
    if (!serviceInitialized) {
      console.warn('[VolumeLayerPanel] Ignoring remove before LayerService initialization');
      return;
    }

    const layer = layers.find((item) => item.id === layerId);
    const confirmed = window.confirm(`Remove layer "${layer?.name ?? layerId}"?`);
    if (!confirmed) {
      return;
    }

    void getLayerService().removeLayer(layerId).catch((error) => {
      console.error('[VolumeLayerPanel] Failed to remove layer:', error);
    });
  }, [layers, serviceInitialized]);

  const getLayerOpacity = useCallback((layerId: string) => {
    const vsl = viewStateLayers.find(l => l.id === layerId);
    return vsl?.opacity ?? 1.0;
  }, [viewStateLayers]);

  const handleRenderUpdate = useCallback((updates: Partial<LayerRender>) => {
    if (!selectedLayerId) return;

    const sanitized: Partial<LayerRender> = {};

    if (updates.intensity) {
      const [minIntensity, maxIntensity] = updates.intensity;
      sanitized.intensity = [minIntensity, maxIntensity];
    }

    if (updates.threshold) {
      let [minThresh, maxThresh] = updates.threshold;
      if (minThresh > maxThresh) {
        [minThresh, maxThresh] = [maxThresh, minThresh];
      }
      sanitized.threshold = [minThresh, maxThresh];
    }

    if (updates.colormap) {
      sanitized.colormap = updates.colormap;
    }

    if ((updates as any).colormapId !== undefined) {
      sanitized.colormapId = (updates as any).colormapId;
    }
    if ((updates as any).atlasConfig) {
      sanitized.atlasConfig = (updates as any).atlasConfig;
    }
    if ((updates as any).atlasPaletteKind) {
      sanitized.atlasPaletteKind = (updates as any).atlasPaletteKind;
    }
    if ((updates as any).atlasPaletteSeed !== undefined) {
      sanitized.atlasPaletteSeed = (updates as any).atlasPaletteSeed;
    }
    if ((updates as any).atlasMaxLabel !== undefined) {
      sanitized.atlasMaxLabel = (updates as any).atlasMaxLabel;
    }

    if (updates.opacity !== undefined) {
      sanitized.opacity = updates.opacity;
    }

    if (updates.interpolation) {
      sanitized.interpolation = updates.interpolation;
    }

    let didChange = false;

    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      if (sanitized.intensity) {
        const [nextMin, nextMax] = sanitized.intensity;
        const current = layer.intensity;
        if (!current || current[0] !== nextMin || current[1] !== nextMax) {
          layer.intensity = [nextMin, nextMax];
          didChange = true;
        }
      }

      if (sanitized.threshold) {
        const [nextLow, nextHigh] = sanitized.threshold;
        const current = layer.threshold;
        if (!current || current[0] !== nextLow || current[1] !== nextHigh) {
          layer.threshold = [nextLow, nextHigh];
          didChange = true;
        }
      }

      if (sanitized.colormap && layer.colormap !== sanitized.colormap) {
        layer.colormap = sanitized.colormap;
        // Switching to a named colormap disables any categorical palette colormapId.
        (layer as any).colormapId = undefined;
        (layer as any).atlasConfig = undefined;
        (layer as any).atlasPaletteKind = undefined;
        (layer as any).atlasPaletteSeed = undefined;
        (layer as any).atlasMaxLabel = undefined;
        didChange = true;
      }

      if ((sanitized as any).colormapId !== undefined && (layer as any).colormapId !== (sanitized as any).colormapId) {
        (layer as any).colormapId = (sanitized as any).colormapId;
        didChange = true;
      }

      if (sanitized.opacity !== undefined && !Object.is(layer.opacity, sanitized.opacity)) {
        layer.opacity = sanitized.opacity;
        didChange = true;
      }

      if (sanitized.interpolation && layer.interpolation !== sanitized.interpolation) {
        layer.interpolation = sanitized.interpolation;
        didChange = true;
      }

      if ((sanitized as any).atlasConfig && (layer as any).atlasConfig !== (sanitized as any).atlasConfig) {
        (layer as any).atlasConfig = (sanitized as any).atlasConfig;
        didChange = true;
      }
      if ((sanitized as any).atlasPaletteKind && (layer as any).atlasPaletteKind !== (sanitized as any).atlasPaletteKind) {
        (layer as any).atlasPaletteKind = (sanitized as any).atlasPaletteKind;
        didChange = true;
      }
      if ((sanitized as any).atlasPaletteSeed !== undefined && (layer as any).atlasPaletteSeed !== (sanitized as any).atlasPaletteSeed) {
        (layer as any).atlasPaletteSeed = (sanitized as any).atlasPaletteSeed;
        didChange = true;
      }
      if ((sanitized as any).atlasMaxLabel !== undefined && (layer as any).atlasMaxLabel !== (sanitized as any).atlasMaxLabel) {
        (layer as any).atlasMaxLabel = (sanitized as any).atlasMaxLabel;
        didChange = true;
      }
    });

    if (!didChange) {
      return;
    }

    // Emit event for render property changes (use sanitized copy)
    getEventBus().emit('layer.render.changed', {
      layerId: selectedLayerId,
      renderProps: sanitized,
    });

    // Debug: log current ViewState layer ordering + opacities
    const viewState = useViewStateStore.getState().viewState;
    console.log('[VolumeLayerPanel] ViewState layers after render update:', {
      layers: viewState.layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        volumeId: l.volumeId,
        order: l.order
      }))
    });
  }, [selectedLayerId]);
  
  return (
    <div className="flex flex-col h-full overflow-hidden bg-card text-card-foreground shadow-sm border border-border font-sans" style={{ borderRadius: '1px' }}>
      {/* Main content area */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 space-y-3"
        style={{ backgroundColor: 'hsl(var(--muted) / 0.1)' }}
      >
        {/* Status messages */}
        <LayerStatusBar
          error={initializationError}
          isInitializing={!serviceInitialized}
        />

        <div className="space-y-3">
          <div
            ref={sidebarTabListRef}
            className={`grid gap-1 rounded-appsm border border-border bg-card p-1 ${compactSidebarTabs ? 'grid-cols-4' : 'grid-cols-2'}`}
            role="tablist"
            aria-label="Right sidebar tabs"
          >
            {SIDEBAR_TABS.map((tab, index) => {
              const isActive = activeSidebarTab === tab.id;
              const tabId = `sidebar-tab-${tab.id}`;
              const panelId = `sidebar-panel-${tab.id}`;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-controls={panelId}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleSidebarTabChange(tab.id)}
                  onKeyDown={(event) => handleSidebarTabKeyDown(event, index)}
                  aria-label={tab.label}
                  title={tab.label}
                  className={`bf-role-label rounded-appsm border px-2 text-center font-semibold tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                    compactSidebarTabs ? 'min-h-[34px]' : 'bf-control-md min-h-[34px]'
                  } ${
                    isActive
                      ? 'border-accent/60 bg-accent/10 text-foreground'
                      : 'border-transparent text-foreground/70 hover:border-border hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <span className={`inline-flex items-center justify-center ${compactSidebarTabs ? '' : 'gap-1.5'}`}>
                    <TabIcon className={`${compactSidebarTabs ? 'h-4 w-4' : 'h-3.5 w-3.5'} shrink-0`} aria-hidden="true" />
                    {!compactSidebarTabs && <span>{tab.label}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {activeSidebarTab === 'layers' && (
            <section
              id="sidebar-panel-layers"
              role="tabpanel"
              aria-labelledby="sidebar-tab-layers"
              className="space-y-3"
            >
              {layers.length > 0 ? (
                <LayerTable
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onSelect={selectLayer}
                  onToggleVisibility={toggleVisibility}
                  onRemove={handleRemoveLayer}
                  onShowMetadata={setMetadataLayerId}
                  onReorder={handleReorder}
                  onOpacityChange={handleOpacityChange}
                  getLayerVisibility={getLayerVisibility}
                  getLayerOpacity={getLayerOpacity}
                />
              ) : (
                <LayerEmptyState />
              )}

              {!selectedLayer && layers.length > 0 && (
                <div className="text-center py-4">
                  <p className="bf-role-body text-muted-foreground">
                    Select a layer, then use Inspect or Mapping for controls.
                  </p>
                </div>
              )}
            </section>
          )}

          {activeSidebarTab === 'inspect' && (
            <section
              id="sidebar-panel-inspect"
              role="tabpanel"
              aria-labelledby="sidebar-tab-inspect"
              className="space-y-3"
            >
              {layers.length > 0 ? (
                <LayerPropertiesManager
                  selectedLayer={selectedLayer || false}
                  selectedRender={selectedRender}
                  selectedMetadata={selectedMetadata}
                  onRenderUpdate={handleRenderUpdate}
                  sectionMode="inspect"
                />
              ) : (
                <LayerEmptyState />
              )}
            </section>
          )}

          {activeSidebarTab === 'mapping' && (
            <section
              id="sidebar-panel-mapping"
              role="tabpanel"
              aria-labelledby="sidebar-tab-mapping"
              className="space-y-3"
            >
              {layers.length > 0 ? (
                <LayerPropertiesManager
                  selectedLayer={selectedLayer || false}
                  selectedRender={selectedRender}
                  selectedMetadata={selectedMetadata}
                  onRenderUpdate={handleRenderUpdate}
                  sectionMode="mapping"
                />
              ) : (
                <LayerEmptyState />
              )}
            </section>
          )}

          {activeSidebarTab === 'plots' && (
            <section
              id="sidebar-panel-plots"
              role="tabpanel"
              aria-labelledby="sidebar-tab-plots"
              className="space-y-3"
            >
              <div className="h-[320px] min-h-[280px]">
                <PlotPanel />
              </div>
            </section>
          )}
        </div>
      </div>
      
      {/* Metadata Drawer */}
      <MetadataDrawer
        layerId={metadataLayerId || selectedLayerId || ''}
        isOpen={!!metadataLayerId}
        onOpenChange={(open) => {
          if (!open && !isMetadataPinned) {
            setMetadataLayerId(null);
          }
        }}
        isPinned={isMetadataPinned}
        onPinToggle={() => setIsMetadataPinned(!isMetadataPinned)}
      />
    </div>
  );
};

// Export the wrapped component with error boundary
export const VolumeLayerPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="VolumeLayerPanel">
      <VolumeLayerPanelContent />
    </PanelErrorBoundary>
  );
};
