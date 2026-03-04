/**
 * Surface View Panel
 * Main panel for 3D brain surface visualization using neurosurface library
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { SurfaceViewCanvas } from './SurfaceViewCanvas';
import { Loader2, AlertCircle, X } from 'lucide-react';
import type { LoadedSurface } from '@/stores/surfaceStore';
import {
  resolveTemplateflowSurfaceIdentity,
  type TemplateflowSurfaceIdentity,
} from '@/utils/surfaceIdentity';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';

interface SurfaceViewPanelProps {
  surfaceHandle?: string;
  path?: string;
}

function parseTemplateIdentity(surface: LoadedSurface): TemplateflowSurfaceIdentity | null {
  return resolveTemplateflowSurfaceIdentity({
    path: surface.metadata?.path,
    geometryHemisphere: surface.geometry.hemisphere,
    metadataHemisphere: surface.metadata?.hemisphere,
    surfaceType: surface.geometry.surfaceType || surface.metadata?.surfaceType || '',
  });
}

function hemisphereSortRank(surface: LoadedSurface): number {
  const hemisphere = (surface.geometry.hemisphere || surface.metadata?.hemisphere || '').toLowerCase();
  if (hemisphere === 'left') return 0;
  if (hemisphere === 'right') return 1;
  return 2;
}

function chooseHemisphereCandidate(
  candidates: LoadedSurface[],
  preferredSurfaceType: string,
  preferredHandle?: string
): LoadedSurface | null {
  if (candidates.length === 0) {
    return null;
  }

  if (preferredHandle) {
    const byHandle = candidates.find((surface) => surface.handle === preferredHandle);
    if (byHandle) {
      return byHandle;
    }
  }

  if (preferredSurfaceType) {
    const byType = candidates.find((surface) => {
      const candidateType = (surface.geometry.surfaceType || surface.metadata?.surfaceType || '').toLowerCase();
      return candidateType === preferredSurfaceType;
    });
    if (byType) {
      return byType;
    }
  }

  return candidates[0];
}

export function collectRenderSurfaces(
  surfaces: Map<string, LoadedSurface>,
  activeSurfaceId: string | null
): LoadedSurface[] {
  if (surfaces.size === 0) {
    return [];
  }

  const activeSurface = activeSurfaceId ? surfaces.get(activeSurfaceId) : null;
  const visibleSurfaces = Array.from(surfaces.values()).filter((surface) => surface.visible !== false);
  const anchorSurface =
    (activeSurface && activeSurface.visible !== false)
      ? activeSurface
      : (visibleSurfaces[0] ?? activeSurface);

  if (!anchorSurface) {
    return [];
  }

  const anchorIdentity = parseTemplateIdentity(anchorSurface);
  if (!anchorIdentity) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  const templateVisible = visibleSurfaces
    .map((surface) => ({ surface, identity: parseTemplateIdentity(surface) }))
    .filter(
      (entry): entry is { surface: LoadedSurface; identity: TemplateflowSurfaceIdentity } =>
        !!entry.identity && entry.identity.basePath === anchorIdentity.basePath
    );
  if (templateVisible.length === 0) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  const leftCandidates = templateVisible
    .filter((entry) => entry.identity.hemisphere === 'left')
    .map((entry) => entry.surface);
  const rightCandidates = templateVisible
    .filter((entry) => entry.identity.hemisphere === 'right')
    .map((entry) => entry.surface);

  const preferredType = anchorIdentity.surfaceType;
  const preferredLeftHandle = anchorIdentity.hemisphere === 'left' ? anchorSurface.handle : undefined;
  const preferredRightHandle = anchorIdentity.hemisphere === 'right' ? anchorSurface.handle : undefined;

  const selectedLeft = chooseHemisphereCandidate(leftCandidates, preferredType, preferredLeftHandle);
  const selectedRight = chooseHemisphereCandidate(rightCandidates, preferredType, preferredRightHandle);
  const pairedVisible = [selectedLeft, selectedRight].filter(
    (surface): surface is LoadedSurface => surface !== null
  );

  if (pairedVisible.length === 0) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  pairedVisible.sort((a, b) => hemisphereSortRank(a) - hemisphereSortRank(b));
  return pairedVisible;
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
    setActiveSurface,
    clearError,
  } = useSurfaceStore();
  
  // Handle initial load
  useEffect(() => {
    const loadInitialSurface = async () => {
      if (path && !surfaceHandle) {
        // Load from path
        try {
          const handle = await getSurfaceLoadingService().loadSurfaceFile({
            path,
            autoActivate: true,
            validateMesh: true,
          });
          if (handle) {
            setActiveSurface(handle);
          }
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
  }, [path, surfaceHandle, setActiveSurface]);
  
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
  const activeSurface = useMemo(
    () => {
      if (activeSurfaceId) {
        const selected = surfaces.get(activeSurfaceId);
        if (selected) {
          return selected;
        }
      }
      return Array.from(surfaces.values()).find((surface) => surface.visible !== false) ?? null;
    },
    [surfaces, activeSurfaceId]
  );
  const renderSurfaces = useMemo(
    () => collectRenderSurfaces(surfaces, activeSurfaceId),
    [surfaces, activeSurfaceId]
  );
  
  
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
            renderSurfaces={renderSurfaces}
            width={dimensions.width}
            height={dimensions.height}
          />
        </div>
      )}
      
      {/* Empty state - Bauhaus geometric placeholder */}
      {!activeSurface && !isLoading && !loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 select-none">
          {/* Wireframe mesh icon - representing surface geometry */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            className="text-foreground/20 mb-6"
          >
            {/* Icosahedron-like surface mesh */}
            <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
            <line x1="12" y1="2" x2="12" y2="22" />
            <line x1="2" y1="8.5" x2="22" y2="15.5" />
            <line x1="22" y1="8.5" x2="2" y2="15.5" />
          </svg>

          {/* Technical header */}
          <h3 className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground border-b border-muted-foreground/20 pb-1 mb-2">
            Surface Buffer Empty
          </h3>

          {/* Monospace instruction */}
          <p className="text-[9px] font-mono text-muted-foreground/50 text-center uppercase tracking-wider">
            Awaiting Mesh Data<br/>
            Double-Click .gii Asset
          </p>
        </div>
      )}
      
      {/* Surface info overlay - Technical readout style */}
      {activeSurface && activeSurface.metadata && (
        <div
          className="absolute top-3 left-3 p-2 border"
          style={{
            backgroundColor: 'hsl(var(--background) / 0.9)',
            borderColor: 'hsl(var(--border))',
            borderRadius: '1px'
          }}
        >
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-foreground truncate max-w-[160px]">
              {activeSurface.name}
            </div>
            {activeSurface.metadata.vertexCount !== undefined && (
              <div className="text-[9px] font-mono text-muted-foreground/70">
                V: {activeSurface.metadata.vertexCount.toLocaleString()}
              </div>
            )}
            {activeSurface.metadata.faceCount !== undefined && (
              <div className="text-[9px] font-mono text-muted-foreground/70">
                F: {activeSurface.metadata.faceCount.toLocaleString()}
              </div>
            )}
            {activeSurface.metadata.hemisphere && (
              <div className="text-[9px] font-mono text-muted-foreground/70 uppercase">
                {activeSurface.metadata.hemisphere}
              </div>
            )}
            {activeSurface.metadata.surfaceType && (
              <div className="text-[9px] font-mono text-muted-foreground/70 uppercase">
                {activeSurface.metadata.surfaceType}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
