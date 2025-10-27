/**
 * Surface View Panel
 * Main panel for 3D brain surface visualization using neurosurface library
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { SurfaceViewCanvas } from './SurfaceViewCanvas';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface SurfaceViewPanelProps {
  surfaceHandle?: string;
  path?: string;
}

export const SurfaceViewPanel: React.FC<SurfaceViewPanelProps> = ({ 
  surfaceHandle, 
  path 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const {
    surfaces,
    activeSurfaceId,
    isLoading,
    loadError,
    loadSurface,
    setActiveSurface,
    clearError,
  } = useSurfaceStore();
  
  // Handle initial load
  useEffect(() => {
    const loadInitialSurface = async () => {
      if (path && !surfaceHandle) {
        // Load from path
        try {
          const handle = await loadSurface(path);
          setActiveSurface(handle);
        } catch (error) {
          console.error('Failed to load surface from path:', error);
        }
      } else if (surfaceHandle) {
        // Set active if already loaded
        if (surfaces.has(surfaceHandle)) {
          setActiveSurface(surfaceHandle);
        } else {
          console.warn('Surface handle not found in store:', surfaceHandle);
        }
      }
    };
    
    loadInitialSurface();
  }, [path, surfaceHandle]);
  
  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);
        
        // Only update if dimensions actually changed and are valid
        if (newWidth > 0 && newHeight > 0) {
          setDimensions(prev => {
            if (prev.width === newWidth && prev.height === newHeight) {
              return prev;
            }
            return { width: newWidth, height: newHeight };
          });
        }
      }
    };
    
    // Wait for container to be ready with valid dimensions
    const waitForDimensions = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        updateDimensions();
      } else {
        // Try again next frame
        requestAnimationFrame(waitForDimensions);
      }
    };
    
    // Start dimension detection
    waitForDimensions();
    
    // Create ResizeObserver with error handling
    const resizeObserver = new ResizeObserver((entries) => {
      // Use requestAnimationFrame to avoid ResizeObserver loop errors
      requestAnimationFrame(() => {
        if (!Array.isArray(entries) || !entries.length) {
          return;
        }
        updateDimensions();
      });
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  // Get active surface
  const activeSurface = activeSurfaceId ? surfaces.get(activeSurfaceId) : null;
  
  
  return (
    <div ref={containerRef} className="relative h-full w-full bg-background">
      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading surface...</span>
          </div>
        </div>
      )}
      
      {/* Error state */}
      {loadError && (
        <div className="absolute top-4 left-4 right-4 z-20">
          <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-sm">{loadError}</div>
            <button
              onClick={clearError}
              className="hover:bg-destructive/20 rounded p-1 transition-colors"
              aria-label="Dismiss error"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      
      {/* Surface viewer - Always render if surface exists to maintain state */}
      {activeSurface && (
        <div className={`absolute inset-0 ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
          <SurfaceViewCanvas
            surface={activeSurface}
            width={dimensions.width}
            height={dimensions.height}
          />
        </div>
      )}
      
      {/* Empty state */}
      {!activeSurface && !isLoading && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">No surface loaded</p>
            <p className="text-sm text-muted-foreground mt-2">
              Double-click a .gii file in the file browser to load a surface
            </p>
          </div>
        </div>
      )}
      
      {/* Surface info overlay */}
      {activeSurface && activeSurface.metadata && (
        <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm rounded-lg p-3 border">
          <div className="text-sm space-y-1">
            <div className="font-medium">{activeSurface.name}</div>
            {activeSurface.metadata.vertexCount !== undefined && (
              <div className="text-xs text-muted-foreground">
                {activeSurface.metadata.vertexCount.toLocaleString()} vertices
              </div>
            )}
            {activeSurface.metadata.faceCount !== undefined && (
              <div className="text-xs text-muted-foreground">
                {activeSurface.metadata.faceCount.toLocaleString()} faces
              </div>
            )}
            {activeSurface.metadata.hemisphere && (
              <div className="text-xs text-muted-foreground">
                Hemisphere: {activeSurface.metadata.hemisphere}
              </div>
            )}
            {activeSurface.metadata.surfaceType && (
              <div className="text-xs text-muted-foreground">
                Type: {activeSurface.metadata.surfaceType}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};