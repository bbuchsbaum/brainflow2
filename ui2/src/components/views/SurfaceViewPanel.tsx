/**
 * Surface View Panel
 * Main panel for 3D brain surface visualization using neurosurface library
 */

import { SurfaceFrame } from './surfaceFrame/SurfaceFrame';
import { cssLengthPx } from './surfaceFrame/surfaceColorbar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SURFACE_VIEW_ID, useSurfaceStore } from '@/stores/surfaceStore';
import { SurfaceViewCanvas } from './SurfaceViewCanvas';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { useResolvedSurfaceViewState } from '@/hooks/useSurfaceSelectionContext';
import { collectRenderSurfaces } from './surfaceRenderSurfaces';

export interface SurfaceViewPanelProps {
  surfaceHandle?: string;
  path?: string;
  surfaceViewId?: string;
  /**
   * Scene group this panel is pinned to. When set, the panel composes only
   * surfaces in this group (Left/Right of one template). Omitted for the
   * Integrated workspace pane, which pairs globally off the active anchor.
   */
  groupKey?: string;
  /**
   * Top inset (CSS length) for the surface metadata overlay card. Defaults to
   * `0.75rem`. The Integrated workspace overlays a `SurfaceAssociationBadge` at
   * the top-left, so it passes a larger value to stack the card below the badge
   * instead of letting them overlap.
   */
  infoOverlayTop?: string;
}

export const SurfaceViewPanel: React.FC<SurfaceViewPanelProps> = ({
  surfaceHandle,
  path,
  surfaceViewId,
  groupKey,
  infoOverlayTop = '0.75rem',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedSurfaceViewId = useRef(
    surfaceViewId ?? surfaceHandle ?? DEFAULT_SURFACE_VIEW_ID,
  ).current;
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const surfaces = useSurfaceStore((state) => state.surfaces);
  const {
    activeSurfaceId: selectedSurfaceId,
    boundSurfaceId,
    renderAnchorSurfaceId,
    selectedItemType,
  } = useResolvedSurfaceViewState(resolvedSurfaceViewId, surfaceHandle);
  const isLoading = useSurfaceStore((state) => state.isLoading);
  const loadError = useSurfaceStore((state) => state.loadError);
  const clearError = useSurfaceStore((state) => state.clearError);
  const registerSurfaceView = useSurfaceStore((state) => state.registerSurfaceView);
  const unregisterSurfaceView = useSurfaceStore((state) => state.unregisterSurfaceView);
  const activateSurfaceView = useSurfaceStore((state) => state.activateSurfaceView);
  const setSurfaceSelectionForView = useSurfaceStore((state) => state.setSurfaceSelectionForView);

  useEffect(() => {
    if (!surfaceHandle) {
      return;
    }

    if (!useSurfaceStore.getState().surfaceViewHandles.has(resolvedSurfaceViewId)) {
      registerSurfaceView(resolvedSurfaceViewId, surfaceHandle);
    }
    return () => {
      unregisterSurfaceView(resolvedSurfaceViewId);
    };
  }, [registerSurfaceView, resolvedSurfaceViewId, surfaceHandle, unregisterSurfaceView]);

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
            setSurfaceSelectionForView(resolvedSurfaceViewId, handle, 'geometry');
          }
        } catch (error) {
          console.error('Failed to load surface from path:', error);
        }
      } else if (surfaceHandle) {
        // Set active if already loaded
        if (surfaces.has(surfaceHandle)) {
          setSurfaceSelectionForView(resolvedSurfaceViewId, surfaceHandle, 'geometry');
        } else {
          console.warn('Surface handle not found in store:', surfaceHandle);
        }
      }
    };

    loadInitialSurface();
  }, [path, resolvedSurfaceViewId, setSurfaceSelectionForView, surfaceHandle, surfaces]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;
    let resizeFrame: number | null = null;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);

        // Only update if dimensions actually changed and are valid
        if (newWidth > 0 && newHeight > 0) {
          setDimensions((prev) => {
            if (prev.width === newWidth && prev.height === newHeight) {
              return prev;
            }
            return { width: newWidth, height: newHeight };
          });
        }
      }
    };

    const scheduleUpdateDimensions = () => {
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        updateDimensions();
      });
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
      if (!Array.isArray(entries) || !entries.length) {
        return;
      }
      // Use requestAnimationFrame to avoid ResizeObserver loop errors, and
      // coalesce splitter drag bursts into one dimension update per frame.
      scheduleUpdateDimensions();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeObserver.disconnect();
    };
  }, []);

  // Get active surface
  const anchorSurfaceId = useMemo(
    () =>
      renderAnchorSurfaceId && surfaces.has(renderAnchorSurfaceId)
        ? renderAnchorSurfaceId
        : surfaceHandle && surfaces.has(surfaceHandle)
          ? surfaceHandle
          : selectedSurfaceId,
    [renderAnchorSurfaceId, selectedSurfaceId, surfaceHandle, surfaces],
  );

  const activeSurface = useMemo(() => {
    if (anchorSurfaceId) {
      const selected = surfaces.get(anchorSurfaceId);
      if (selected) {
        return selected;
      }
    }
    return Array.from(surfaces.values()).find((surface) => surface.visible !== false) ?? null;
  }, [surfaces, anchorSurfaceId]);
  const renderSurfaces = useMemo(
    () => collectRenderSurfaces(surfaces, anchorSurfaceId, groupKey),
    [surfaces, anchorSurfaceId, groupKey],
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

      {/* Error state — only overlay a banner when a surface is already shown.
          With no surface, the error is folded into the empty state below so the
          load CTA stays reachable (no dead-end spinner/banner). */}
      {loadError && activeSurface && (
        <div className="absolute top-4 left-4 right-4 z-20">
          <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-sm p-3 flex items-start gap-2">
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
            surfaceViewId={resolvedSurfaceViewId}
            surfaceContextHandle={boundSurfaceId ?? activeSurface.handle}
            onActivateSurface={() => {
              if (
                !selectedSurfaceId ||
                !selectedItemType ||
                selectedSurfaceId !== activeSurface.handle
              ) {
                setSurfaceSelectionForView(resolvedSurfaceViewId, activeSurface.handle, 'geometry');
                return;
              }
              activateSurfaceView(resolvedSurfaceViewId);
            }}
            width={dimensions.width}
            height={dimensions.height}
          />
        </div>
      )}

      {/* Empty state — quiet, human invitation (Design.md §22: research-grade,
          not playful; no dev-speak). Doubles as the fail-fast recovery surface:
          when a load fails (e.g. an offline template times out), the error is
          shown here with the load CTA still reachable rather than a dead-end
          spinner. */}
      {!activeSurface && !isLoading && (
        <div
          data-testid="surface-view-empty-state"
          data-error={loadError ? 'true' : 'false'}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center select-none"
        >
          <div className="space-y-1.5">
            <p className="text-bf-sm font-medium" style={{ color: 'var(--bf-text-secondary)' }}>
              {loadError ? 'Couldn’t load surface' : 'No surface loaded'}
            </p>
            <p className="mx-auto max-w-[280px] text-bf-sm text-muted-foreground">
              {loadError ?? 'Load a cortical surface to view it alongside the volume.'}
            </p>
          </div>

          <button
            type="button"
            data-testid="surface-view-empty-load"
            onClick={() => {
              if (loadError) {
                clearError();
              }
              void getSurfaceLoadingService()
                .requestSurfaceFileSelection()
                .catch((error) =>
                  console.error('[SurfaceViewPanel] Failed to open surface picker:', error),
                );
            }}
            className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 text-bf-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span aria-hidden>+</span>
            Load surface…
          </button>
        </div>
      )}

      {/* Viewport frame (P3.10): header + counts disclosure, camera presets
          and the overlay colorbar, the slice panes' grammar. */}
      {activeSurface && activeSurface.metadata && (
        <SurfaceFrame
          surface={activeSurface}
          surfaceViewId={resolvedSurfaceViewId}
          width={dimensions.width}
          height={dimensions.height}
          topInset={cssLengthPx(infoOverlayTop) - 12}
        />
      )}
    </div>
  );
};
