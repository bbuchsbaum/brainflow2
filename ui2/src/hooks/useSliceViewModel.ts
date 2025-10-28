import React from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { assertNoRenderPhaseWrites } from '@/utils/devAssert';
import type { ViewPlane } from '@/types/coordinates';
import type { RenderContext } from '@/types/renderContext';
import { SLIDER_HEIGHT } from '@/components/views/constants';

const tupleEquals = (a?: readonly number[], b?: readonly number[]) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
};

type ViewId = 'axial' | 'sagittal' | 'coronal';

const viewPlaneEquals = (a?: ViewPlane, b?: ViewPlane) => {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    tupleEquals(a.origin_mm, b.origin_mm) &&
    tupleEquals(a.u_mm, b.u_mm) &&
    tupleEquals(a.v_mm, b.v_mm) &&
    tupleEquals(a.dim_px, b.dim_px)
  );
};

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
    React.useCallback((s) => s.viewState.views[viewId] as ViewPlane | undefined, [viewId]),
    viewPlaneEquals
  );

  const crosshairWorld = useViewStateStore(
    (s) => s.viewState.crosshair.world_mm,
    tupleEquals
  );
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

  // Display options for primary layer (read-once pattern to avoid Map churn)
  const primaryOptions = React.useMemo(() => {
    const store = useDisplayOptionsStore.getState();
    const opts = store.options.get(primaryLayerId);
    if (!opts) {
      return {
        showBorder: false,
        borderThicknessPx: 1,
        showOrientationMarkers: true,
        showValueOnHover: true,
      };
    }
    return opts;
  }, [primaryLayerId]);

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

  // RenderContext for this view (idempotent registration handled via effect)
  // Create a fresh object when dimensions change; registration effect is idempotent.
  const renderContext: RenderContext = React.useMemo(
    () => ({
      id: viewId,
      type: 'slice',
      dimensions: { width: dims.width, height: canvasHeight },
      metadata: { viewType: viewId },
    }),
    [viewId, dims.width, canvasHeight]
  );

  // Register/sync context (scheduled/idempotent at store layer)
  React.useEffect(() => {
    const store = useRenderStateStore.getState();
    const existing = store.getContext?.(viewId);
    if (!existing) {
      store.registerContext(renderContext);
      return;
    }
    const { width, height } = renderContext.dimensions;
    const dimsChanged =
      existing.dimensions?.width !== width || existing.dimensions?.height !== height;
    const typeChanged = existing.type !== renderContext.type;
    // Metadata changes are uncommon; let store equality check handle it.

    if (dimsChanged || typeChanged) {
      // Schedule to avoid render-phase writes
      const force = () => useRenderStateStore.getState().registerContext(renderContext);
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(force);
      } else {
        setTimeout(force, 16);
      }
    }
  }, [viewId, renderContext]);

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
    ]
  );
}
