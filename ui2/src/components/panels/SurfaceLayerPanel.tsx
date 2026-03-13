/**
 * Surface Layer Panel
 * Displays list of loaded surfaces with selection and management
 * Separate from volume layers to provide clear UI separation
 */

import React, { useCallback, useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';
import { 
  Brain, 
  Trash2, 
  Info, 
  ChevronRight, 
  ChevronDown,
  Settings2,
  Layers,
  Plus
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { SurfaceMetadataDrawer } from '@/components/ui/SurfaceMetadataDrawer';
import { SurfaceControlPanel } from './SurfaceControlPanel';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { surfaceOverlayService } from '@/services/SurfaceOverlayService';
import { getConfirmationService } from '@/services/ConfirmationService';
import { PanelHeader } from '@/components/ui/PanelHeader';
import {
  applySurfaceSelectionInContext,
  resolveSurfaceSelectionViewId,
} from '@/utils/surfaceCommandContext';
import { useSurfaceCommandContextValue } from '@/hooks/useSurfaceSelectionContext';

export const SurfaceLayerPanel: React.FC = () => {
  // Track expanded surfaces
  const [expandedSurfaces, setExpandedSurfaces] = useState<Set<string>>(new Set());
  const {
    activeSurfaceId,
    explicitSurfaceViewId,
    selectedItemType,
    selectedLayerId,
  } = useSurfaceCommandContextValue();
  const surfaces = useSurfaceStore((state) => state.surfaces);
  const isLoading = useSurfaceStore((state) => state.isLoading);
  const loadError = useSurfaceStore((state) => state.loadError);
  const clearError = useSurfaceStore((state) => state.clearError);
  const updateLayerProperty = useSurfaceStore((state) => state.updateLayerProperty);
  const setSurfaceVisibility = useSurfaceStore((state) => state.setSurfaceVisibility);
  
  // State for metadata drawer
  const [metadataSurfaceId, setMetadataSurfaceId] = useState<string | null>(null);
  
  // Convert Map to array for rendering
  const surfaceList = Array.from(surfaces.entries());
  
  const resolveSelectionSurfaceViewId = useCallback(
    (surfaceId: string) => resolveSurfaceSelectionViewId(surfaceId, explicitSurfaceViewId),
    [explicitSurfaceViewId]
  );

  const handleLoadSurface = useCallback(async () => {
    try {
      await getSurfaceLoadingService().requestSurfaceFileSelection();
    } catch (error) {
      console.error('Failed to open surface picker:', error);
    }
  }, [surfaces]);
  
  const handleSelectGeometry = useCallback((surfaceId: string) => {
    applySurfaceSelectionInContext(
      surfaceId,
      'geometry',
      null,
      resolveSelectionSurfaceViewId(surfaceId)
    );
  }, [resolveSelectionSurfaceViewId]);
  
  const handleSelectDataLayer = useCallback((surfaceId: string, layerId: string) => {
    applySurfaceSelectionInContext(
      surfaceId,
      'dataLayer',
      layerId,
      resolveSelectionSurfaceViewId(surfaceId)
    );
  }, [resolveSelectionSurfaceViewId]);
  
  const toggleExpanded = useCallback((surfaceId: string) => {
    setExpandedSurfaces(prev => {
      const next = new Set(prev);
      if (next.has(surfaceId)) {
        next.delete(surfaceId);
      } else {
        next.add(surfaceId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSurfaces(new Set(surfaceList.map(([id]) => id)));
  }, [surfaceList]);

  const collapseAll = useCallback(() => {
    setExpandedSurfaces(new Set());
  }, []);
  
  const handleAddDataLayer = useCallback(async (surfaceId: string) => {
    try {
      await surfaceOverlayService.requestOverlayFileSelection(surfaceId);
    } catch (error) {
      console.error('Failed to open overlay picker:', error);
    }
  }, []);
  
  const handleRemoveSurface = useCallback((surfaceId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selection when removing
    const surfaceName = surfaces.get(surfaceId)?.name;
    void getConfirmationService().confirmSurfaceRemoval(surfaceName).then((confirmed) => {
      if (!confirmed) {
        return;
      }

      void getSurfaceLoadingService().unloadSurface(surfaceId).catch((error) => {
        console.error('Failed to remove surface:', error);
      });
    });
  }, []);

  const handleToggleSurfaceVisibility = useCallback((surfaceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const surface = surfaces.get(surfaceId);
    if (!surface) {
      return;
    }

    const nextVisible = surface.visible === false;
    setSurfaceVisibility(surfaceId, nextVisible);

    if (nextVisible) {
      applySurfaceSelectionInContext(
        surfaceId,
        'geometry',
        null,
        resolveSelectionSurfaceViewId(surfaceId)
      );
    }
  }, [
    resolveSelectionSurfaceViewId,
    setSurfaceVisibility,
    surfaces,
  ]);
  
  return (
    <div className="flex flex-col h-full bg-background">
      <PanelHeader
        title="Surfaces"
        icon={<Brain className="h-4 w-4" />}
        primaryAction={{
          label: 'Load',
          icon: <Plus className="h-3 w-3" />,
          onClick: () => {
            void handleLoadSurface();
          },
          disabled: isLoading,
          title: 'Load surface file',
        }}
        overflowActions={[
          {
            id: 'expand-all',
            label: 'Expand All',
            icon: <ChevronDown className="h-3.5 w-3.5" />,
            onClick: expandAll,
            disabled: surfaceList.length === 0,
          },
          {
            id: 'collapse-all',
            label: 'Collapse All',
            icon: <ChevronRight className="h-3.5 w-3.5" />,
            onClick: collapseAll,
            disabled: expandedSurfaces.size === 0,
          },
          {
            id: 'clear-error',
            label: 'Clear Error',
            icon: <Info className="h-3.5 w-3.5" />,
            onClick: clearError,
            disabled: !loadError,
          },
        ]}
      />
      
      {/* Error Display */}
      {loadError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs">
          <div className="flex items-center justify-between">
            <span>{loadError}</span>
            <button 
              onClick={clearError}
              className="text-destructive hover:text-destructive/80"
            >
              ×
            </button>
          </div>
        </div>
      )}
      
      {/* Surface List and Controls */}
      <div className="flex-1 overflow-y-auto">
        {surfaceList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No surfaces loaded</p>
            <p className="text-xs text-muted-foreground mt-1">
              Load a .gii file to visualize brain surfaces
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Surface List */}
            <div className="p-2 space-y-1">
            {surfaceList.map(([id, surface]) => {
              const isExpanded = expandedSurfaces.has(id);
              const isGeometrySelected = id === activeSurfaceId && selectedItemType === 'geometry';
              const metadata = surface.metadata;
              const dataLayers = Array.from(surface.layers.entries());
              
              return (
                <div key={id} className="space-y-0.5">
                  {/* Surface Geometry Row */}
                  <div className="flex items-center gap-2">
                    {/* Expand/Collapse */}
                    <button
                      onClick={() => toggleExpanded(id)}
                      className="p-1 hover:bg-muted/40 rounded-[2px]"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                    
                      <div
                      onClick={() => handleSelectGeometry(id)}
                      className={cn(
                        "group flex-1 flex items-center justify-between px-3 py-2 border-l-[3px] cursor-pointer transition-all rounded-sm",
                        surface.visible === false && "opacity-50",
                        isGeometrySelected
                          ? "border-accent bg-muted/10" 
                          : "border-transparent hover:border-border hover:bg-muted/30"
                      )}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Geometry Icon */}
                        <Settings2 className="h-3 w-3 text-muted-foreground" />
                        
                        {/* Visibility Toggle */}
                        <button
                          onClick={(e) => handleToggleSurfaceVisibility(id, e)}
                          className="p-1 hover:bg-muted/50 rounded-[2px]"
                          title="Toggle visibility"
                        >
                          {surface.visible !== false ? (
                            <VscEye className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <VscEyeClosed className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                        
                        {/* Surface Name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-[11px] font-mono truncate",
                              isGeometrySelected ? "text-accent font-semibold" : "text-foreground"
                            )}>
                              {surface.name || `Surface ${id.slice(0, 8)}`}
                            </span>
                            {metadata?.hemisphere && (
                              <span className="text-[10px] text-muted-foreground">
                                ({metadata.hemisphere})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddDataLayer(id);
                          }}
                          className="p-1 hover:bg-muted/50 rounded-[2px]"
                          title="Add Data Layer"
                        >
                          <Plus className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMetadataSurfaceId(id);
                          }}
                          className="p-1 hover:bg-muted/50 rounded-[2px]"
                          title="Surface Information"
                        >
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => handleRemoveSurface(id, e)}
                          className="p-1 hover:bg-muted/50 rounded-[2px]"
                          title="Remove Surface"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Data Layers (when expanded) */}
                  {isExpanded && (
                    <div className="ml-8 space-y-0.5">
                      {dataLayers.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic py-1 px-2">
                          No data layers
                        </div>
                      ) : (
                        dataLayers.map(([layerId, layer]) => {
                          const isLayerSelected = id === activeSurfaceId && 
                                                 selectedItemType === 'dataLayer' && 
                                                 selectedLayerId === layerId;
                          
                          return (
                            <div
                              key={layerId}
                              onClick={() => handleSelectDataLayer(id, layerId)}
                              className={cn(
                                "group flex items-center justify-between px-3 py-1.5 border-l-[3px] cursor-pointer transition-all rounded-sm",
                                isLayerSelected
                                  ? "border-accent bg-muted/10" 
                                  : "border-transparent hover:border-border hover:bg-muted/30"
                              )}
                            >
                              <div className={cn(
                                "flex items-center gap-2 flex-1 min-w-0",
                                layer.visible === false && "opacity-50"
                              )}>
                                {/* Layer Icon */}
                                <Layers className="h-3 w-3 text-muted-foreground" />
                                
                                {/* Visibility Toggle */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const nextVisible = layer.visible === false ? true : false;
                                    updateLayerProperty(id, layerId, 'visible', nextVisible);
                                  }}
                                  className="p-1 hover:bg-muted/50 rounded-[2px]"
                                  >
                                  {layer.visible === false ? (
                                    <VscEyeClosed className="h-3 w-3 text-muted-foreground" />
                                  ) : (
                                    <VscEye className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </button>
                                
                                {/* Layer Name */}
                                <span className={cn(
                                  "text-[11px] font-mono truncate",
                                  isLayerSelected ? "text-accent font-semibold" : "text-foreground"
                                )}>
                                  {layer.name}
                                </span>
                              </div>
                              
                              {/* Remove Layer */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void getConfirmationService()
                                    .confirmSurfaceLayerRemoval(layer.name)
                                    .then((confirmed) => {
                                      if (!confirmed) {
                                        return;
                                      }

                                      void surfaceOverlayService.removeSurfaceDataLayer(id, layerId).catch((error) => {
                                        console.error('Failed to remove surface layer:', error);
                                      });
                                    });
                                }}
                                className="p-1 hover:bg-muted/50 rounded-[2px] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove Layer"
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            
            {/* Inline Surface Controls */}
            {selectedItemType && activeSurfaceId && (
              <div className="px-2">
                <SurfaceControlPanel />
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Status Bar */}
      {surfaceList.length > 0 && (
        <div className="px-4 py-2 border-t bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{surfaceList.length} surface{surfaceList.length !== 1 ? 's' : ''} loaded</span>
            {activeSurfaceId && (
              <span className="text-accent">1 selected</span>
            )}
          </div>
        </div>
      )}
      
      {/* Surface Metadata Drawer */}
      {metadataSurfaceId && (
        <SurfaceMetadataDrawer
          surfaceId={metadataSurfaceId}
          isOpen={!!metadataSurfaceId}
          onOpenChange={(open) => {
            if (!open) {
              setMetadataSurfaceId(null);
            }
          }}
        />
      )}
    </div>
  );
};
