/**
 * Surface Control Panel
 * Container component that displays appropriate controls based on selection
 * Shows geometry controls or data layer controls depending on what's selected
 */

import React from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { SurfaceGeometryControls } from './SurfaceGeometryControls';
import { SurfaceDataLayerControls } from './SurfaceDataLayerControls';
import { cn } from '@/utils/cn';
import { Settings2, Layers, Info } from 'lucide-react';

export const SurfaceControlPanel: React.FC = () => {
  const { 
    selectedItemType, 
    selectedLayerId,
    activeSurfaceId,
    surfaces 
  } = useSurfaceStore();

  // No selection
  if (!selectedItemType || !activeSurfaceId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Info className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No selection</p>
        <p className="text-xs text-muted-foreground mt-1">
          Select a surface geometry or data layer to view controls
        </p>
      </div>
    );
  }

  const surface = surfaces.get(activeSurfaceId);
  if (!surface) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        {selectedItemType === 'geometry' ? (
          <>
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Geometry Controls</span>
          </>
        ) : (
          <>
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Data Layer Controls</span>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto">
        {selectedItemType === 'geometry' ? (
          <SurfaceGeometryControls />
        ) : selectedLayerId ? (
          <SurfaceDataLayerControls 
            surfaceId={activeSurfaceId} 
            layerId={selectedLayerId} 
          />
        ) : null}
      </div>
    </div>
  );
};