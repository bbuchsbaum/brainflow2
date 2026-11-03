/** Generic rendering ports for module layouts. Normal layers retain all GPU ownership. */
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { getLayerService } from '@/services/LayerService';
import { getApiService } from '@/services/apiService';
import type { ViewLayer } from '@/types/viewState';
import type { ViewPlane } from '@/types/coordinates';
import type { RenderContext } from '@/types/renderContext';
export { zoomPanPlane } from '@/utils/viewZoomGeometry';
export type { ViewPlane } from '@/types/coordinates';
export type { RenderContext } from '@/types/renderContext';
export type { SliceViewportPlacement } from '@/components/views/SliceViewport';

export function useWorkspaceRenderState(workspaceId: string) {
  return useViewStateStore((state) => state.workspaceViewStates.get(workspaceId));
}

/**
 * Whether the render store holds an image for this render context. A
 * viewport's unmount clears its context's image, so a view that remembers
 * "this frame is drawn" must also check that the image is still there.
 */
export function useHasRenderedImage(contextId: string): boolean {
  return useRenderStateStore((state) => Boolean(state.states[contextId]?.lastImage));
}

/** Publish an already registered volume through the ordinary layer lifecycle. */
export async function ensureModuleLabelLayer(options: {
  workspaceId: string; volumeId: string; kind: string; title: string;
  paletteId: number; maxLabel: number; isCurrent(): boolean;
}): Promise<void> {
  if (!options.isCurrent()) return;
  if (!useLayerStore.getState().getLayer(options.volumeId)) {
    await getLayerService().addLayer({
      volumeId: options.volumeId, name: options.title, layerKind: options.kind,
      type: 'label', visible: true, order: 0,
    }, { workspaceId: options.workspaceId, isCurrent: options.isCurrent, autoSelect: () => false });
  }
  if (!options.isCurrent()) return;
  await ensureModuleVolumeResident(options.workspaceId, options.volumeId, options.isCurrent);
  if (!options.isCurrent()) return;
  useViewStateStore.getState().setViewState((view) => {
    const layer = view.layers.find((item) => item.volumeId === options.volumeId);
    if (!layer) throw new Error('The label layer is not attached to this workspace');
    layer.colormapId = options.paletteId;
    layer.layerMode = 'label'; layer.interpolation = 'nearest';
    layer.intensity = [0, options.maxLabel]; layer.threshold = [0, options.maxLabel];
    layer.opacity = 0.25; layer.labelDisplay = 'both';
    layer.outline = { enabled: true, selectedLabelId: 0, color: [1, 1, 1, 1], colorMode: 'lut', thicknessPx: 1, haloPx: 0.75, haloColor: [0, 0, 0, 0.85] };
  }, options.workspaceId);
}

/** Layers already styled from their source, keyed `workspace\u0000volume`. */
const styledFromSource = new Set<string>();

/** Attach an already registered image volume (for example a module-owned
 * frozen frame of a 4D series) as an ordinary, initially hidden layer. When
 * `displayLike` names a layer's volume, the new layer copies its window,
 * threshold, colormap and interpolation once; the copy is retried on later
 * calls until it has happened, even if the layer was added elsewhere. */
export async function ensureModuleImageLayer(options: {
  workspaceId: string; volumeId: string; title: string; displayLike?: string; isCurrent(): boolean;
}): Promise<void> {
  if (!options.isCurrent()) return;
  if (!useLayerStore.getState().getLayer(options.volumeId)) {
    await getLayerService().addLayer({
      volumeId: options.volumeId, name: options.title, type: 'anatomical', visible: false, order: 0,
    }, { workspaceId: options.workspaceId, isCurrent: options.isCurrent, autoSelect: () => false });
  }
  if (!options.isCurrent()) return;
  await ensureModuleVolumeResident(options.workspaceId, options.volumeId, options.isCurrent);
  const key = `${options.workspaceId}\u0000${options.volumeId}`;
  const like = options.displayLike;
  if (!like || styledFromSource.has(key) || !options.isCurrent()) return;
  const view = useViewStateStore.getState().workspaceViewStates.get(options.workspaceId);
  const source = view?.layers.find((item) => item.volumeId === like);
  if (!source || !view?.layers.some((item) => item.volumeId === options.volumeId)) return;
  useViewStateStore.getState().setViewState((next) => {
    const layer = next.layers.find((item) => item.volumeId === options.volumeId);
    if (!layer) return;
    layer.intensity = [...source.intensity]; layer.threshold = [...source.threshold];
    layer.colormap = source.colormap; layer.colormapId = source.colormapId; layer.interpolation = source.interpolation;
  }, options.workspaceId);
  styledFromSource.add(key);
}

/** Render a supplied world plane from this workspace's selected volume layers.
 * `timepoint` selects the frame of 4D layers for this render only. */
export async function renderModulePlane(options: {
  workspaceId: string; context: RenderContext; plane: ViewPlane;
  volumeIds: readonly string[]; opacity?: Readonly<Record<string, number>>;
  layerOverrides?: Readonly<Record<string, Partial<Pick<ViewLayer, 'visible' | 'opacity' | 'outline' | 'labelDisplay'>>>>;
  timepoint?: number;
  isCurrent(): boolean;
}): Promise<void> {
  const view = useViewStateStore.getState().workspaceViewStates.get(options.workspaceId);
  if (!view || !options.isCurrent()) return;
  const layers = view.layers.filter((layer) => options.volumeIds.includes(layer.volumeId));
  if (options.volumeIds.some((id) => !layers.some((layer) => layer.volumeId === id))) throw new Error('A required image is no longer in this workspace');
  for (const layer of layers) {
    await ensureModuleVolumeResident(options.workspaceId, layer.volumeId, options.isCurrent);
    if (!options.isCurrent()) return;
  }
  const target = useRenderStateStore.getState();
  target.setRendering(options.context.id, true); target.setError(options.context.id, null);
  try {
    const bitmap = await getApiService().renderViewState({
      ...view, views: { ...view.views, axial: options.plane }, timepoint: options.timepoint ?? view.timepoint,
      layers: layers.map((layer) => ({ ...layer, visible: true, ...options.layerOverrides?.[layer.volumeId], opacity: options.opacity?.[layer.volumeId] ?? options.layerOverrides?.[layer.volumeId]?.opacity ?? layer.opacity })),
    }, 'axial', options.plane.dim_px[0], options.plane.dim_px[1]);
    if (!options.isCurrent()) { bitmap.close(); return; }
    target.setImage(options.context.id, bitmap);
  } catch (error) {
    if (options.isCurrent()) target.setError(options.context.id, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    if (options.isCurrent()) target.setRendering(options.context.id, false);
  }
}
export { resizeZoomedPlane } from '@/utils/viewZoomGeometry';
export { edgeBoxFromAffine, fitPlaneToWorldBox } from '@/utils/worldFrame';
export function setModuleCrosshair(workspaceId: string, world: [number, number, number]) {
  useViewStateStore.getState().setViewState((view) => { view.crosshair.world_mm = world; }, workspaceId);
}
/** Reuse the normal residency path for a loaded but hidden comparison image. */
export async function ensureModuleVolumeResident(workspaceId: string, volumeId: string, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  const view = useViewStateStore.getState().workspaceViewStates.get(workspaceId);
  const layer = view?.layers.find((item) => item.volumeId === volumeId);
  if (!layer) throw new Error('The comparison image is not attached to this workspace');
  const { LayerApiImpl } = await import('@/services/LayerApiImpl');
  if (isCurrent()) await new LayerApiImpl().loadLayerData(layer.id);
}
