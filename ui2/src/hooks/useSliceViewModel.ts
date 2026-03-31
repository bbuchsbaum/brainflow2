import React from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { assertNoRenderPhaseWrites } from '@/utils/devAssert';
import type { ViewPlane } from '@/types/coordinates';
import type { RenderContext } from '@/types/renderContext';
import { SLIDER_HEIGHT } from '@/components/views/constants';
import { useAdaptiveResolution } from '@/hooks/useAdaptiveResolution';

type ViewId = 'axial' | 'sagittal' | 'coronal';

export function useSliceViewModel(
  viewId: ViewId,
  dims: { width: number; height: number }
) {
  const shouldAssert = Boolean((import.meta as any)?.env?.DEV && (import.meta as any)?.env?.MODE !== 'test');
  if (shouldAssert) {
    // Dev-only diagnostic: detect render-phase writes that would churn snapshots
    assertNoRenderPhaseWrites(`useSliceViewModel:${viewId}:viewState`, () => useViewStateStore.getState().viewState);
  }
  // Subscribe to view state using selectors that return stable references
  const viewPlane = useViewStateStore(
    React.useCallback((s) => s.viewState.views[viewId] as ViewPlane | undefined, [viewId])
  );

  const crosshairWorld = useViewStateStore((s) => s.viewState.crosshair.world_mm);
  const crosshairVisible = useViewStateStore((s) => s.viewState.crosshair.visible);
  const crosshair = React.useMemo(
    () => ({ visible: crosshairVisible, world_mm: crosshairWorld }),
    [crosshairVisible, crosshairWorld]
  );

  // Layers + loading set (avoid object allocation in selector)
  const layers = useLayerStore((s) => s.layers);
  const loadingLayers = useLayerStore((s) => s.loadingLayers);
  const hasLayers = layers.length > 0;
  const isLoadingAnyLayer = loadingLayers.size > 0;

  // Compute canvas height (reserve slider space when layers exist)
  const canvasHeight = React.useMemo(
    () => (hasLayers ? Math.max(1, dims.height - SLIDER_HEIGHT) : dims.height),
    [hasLayers, dims.height]
  );

  // Determine primary (top-most visible) layer id
  const primaryLayer = React.useMemo(() => layers.find((l) => l.visible), [layers]);
  const primaryLayerId = primaryLayer?.id ?? '';

  // Display options for primary layer — subscribe reactively so toggles take effect
  const DEFAULT_DISPLAY_OPTIONS = React.useMemo(() => ({
    showBorder: false,
    borderThicknessPx: 1,
    showOrientationMarkers: true,
    showValueOnHover: true,
  }), []);
  const primaryOptions = useDisplayOptionsStore(
    React.useCallback(
      (s) => s.options.get(primaryLayerId) ?? DEFAULT_DISPLAY_OPTIONS,
      [primaryLayerId, DEFAULT_DISPLAY_OPTIONS]
    )
  ) ?? DEFAULT_DISPLAY_OPTIONS;

  // Crosshair settings: select the full settings object (stable ref) and derive
  const crosshairSettingsRoot = useCrosshairSettingsStore((s) => s.settings);
  const crosshairSettings = React.useMemo(() => {
    const overrides = crosshairSettingsRoot.viewOverrides?.[viewId];
    if (overrides) {
      return {
        visible: overrides.visible ?? crosshairSettingsRoot.visible,
        activeColor: overrides.color ?? crosshairSettingsRoot.activeColor,
        activeThickness: overrides.thickness ?? crosshairSettingsRoot.activeThickness,
        activeStyle: overrides.style ?? crosshairSettingsRoot.activeStyle,
      };
    }
    return {
      visible: crosshairSettingsRoot.visible,
      activeColor: crosshairSettingsRoot.activeColor,
      activeThickness: crosshairSettingsRoot.activeThickness,
      activeStyle: crosshairSettingsRoot.activeStyle,
    };
  }, [crosshairSettingsRoot, viewId]);

  // Adaptive resolution: reduce render target during interaction for faster feedback
  const adaptive = useAdaptiveResolution({ width: dims.width, height: canvasHeight });

  // RenderContext for this view (idempotent registration handled via effect)
  // Create a fresh object when dimensions change; registration effect is idempotent.
  const renderContext: RenderContext = React.useMemo(
    () => ({
      id: viewId,
      type: 'slice',
      dimensions: { width: adaptive.renderWidth, height: adaptive.renderHeight },
      metadata: { viewType: viewId },
    }),
    [viewId, adaptive.renderWidth, adaptive.renderHeight]
  );

  return React.useMemo(
    () => ({
      viewPlane,
      crosshair,
      layers,
      loadingLayers,
      hasLayers,
      isLoadingAnyLayer,
      canvasHeight,
      renderContext,
      primaryLayer,
      primaryOptions,
      crosshairSettings,
      adaptive,
    }),
    [
      viewPlane,
      crosshair,
      layers,
      loadingLayers,
      hasLayers,
      isLoadingAnyLayer,
      canvasHeight,
      renderContext,
      primaryLayer,
      primaryOptions,
      crosshairSettings,
      adaptive,
    ]
  );
}
