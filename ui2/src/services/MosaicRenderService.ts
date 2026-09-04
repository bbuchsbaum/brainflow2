/**
 * MosaicRenderService
 *
 * Coordinates rendering of multiple slices for MosaicView using the event-driven architecture.
 * Instead of batch rendering, this service triggers individual renders with unique tags.
 */

import { getApiService } from '@/services/apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { useRenderStateStore } from '@/stores/renderStateStore';
import type { ViewState } from '@/types/viewState';
import type { ViewPlane } from '@/types/coordinates';
import { CoordinateTransform } from '@/utils/coordinates';
import { getViewPlaneService } from '@/services/ViewPlaneService';
import { createDebugLogger } from '@/utils/debug';
import { slicePositionAtIndex } from '@/services/mosaic/sliceGeometry';
import { decodeBatchRenderBuffer } from '@/services/mosaic/decodeBatchRenderBuffer';

const debug = createDebugLogger('mosaic-render');

export interface MosaicRenderRequest {
  sliceIndex: number;
  axis: 'axial' | 'sagittal' | 'coronal';
  cellId: string;
  width: number;
  height: number;
}

export interface CrosshairInfo {
  screenCoord: [number, number] | null;
  isActive: boolean; // true if this slice contains the global crosshair
}

let batchRenderEnabled = false;

export class MosaicRenderService {
  private readonly workspaceId?: string;

  constructor(workspaceId?: string) { this.workspaceId = workspaceId; }

  private geometryCache = new WeakMap<ViewState, Map<string, Promise<{ min: number; max: number; count: number; bounds: { min: number[]; max: number[] } }>>>();

  private getViewState(): ViewState {
    const store = useViewStateStore.getState();
    return this.workspaceId ? store.getWorkspaceViewState(this.workspaceId) : store.viewState;
  }

  private getSampling(base: ViewState, axis: MosaicRenderRequest['axis']) {
    let byAxis = this.geometryCache.get(base);
    if (!byAxis) {
      byAxis = new Map();
      this.geometryCache.set(base, byAxis);
    }
    let pending = byAxis.get(axis);
    if (!pending) {
      pending = (async () => {
        const reference = base.layers.find(layer => layer.visible && layer.opacity > 0 && layer.volumeId);
        if (!reference?.volumeId) throw new Error('No reference volume for montage');
        const volumeIds = [...new Set(base.layers.filter(layer => layer.visible && layer.opacity > 0 && layer.volumeId).map(layer => layer.volumeId!))];
        const [allBounds, meta] = await Promise.all([
          Promise.all(volumeIds.map(id => this.apiService.getVolumeBounds(id))),
          this.apiService.querySliceAxisMeta(reference.volumeId, axis),
        ]);
        const bounds = allBounds[0];
        const framing = {
          min: [0, 1, 2].map(d => Math.min(...allBounds.map(b => b.min[d]))),
          max: [0, 1, 2].map(d => Math.max(...allBounds.map(b => b.max[d]))),
        };
        const dimension = axis === 'sagittal' ? 0 : axis === 'coronal' ? 1 : 2;
        const sampling = { min: bounds.min[dimension], max: bounds.max[dimension], count: meta.sliceCount, bounds: framing };
        slicePositionAtIndex(sampling, 0); // Validate before caching usable geometry.
        return sampling;
      })();
      byAxis.set(axis, pending);
      void pending.catch(() => byAxis?.delete(axis));
    }
    return pending;
  }
  private apiService = getApiService();
  private eventBus = getEventBus();
  // Maps a cellId to the request id of the render that currently owns it. A
  // render only writes the store while it is still the owner (epoch guard); a
  // newer render or a cancel replaces/removes the entry so stale completions
  // no-op instead of overwriting fresher output. Mirrors ComparisonRenderService.
  private activeRenders = new Map<string, number>();
  private nextRequestId = 1;
  // Monotonic generation for whole-grid dispatches. A new grid supersedes every
  // cell of the previous generation, including cells the new grid does not
  // re-render (their in-flight completions no-op via the generation check).
  private gridGeneration = 0;
  // Coalescing slot: the most recent grid requested this frame plus the promise
  // for the scheduled flush, so bursts of renderMosaicGrid calls collapse to a
  // single dispatch of the latest requests.
  private pendingGrid: MosaicRenderRequest[] | null = null;
  private flushPromise: Promise<void> | null = null;
  // When true, dispatch through the packed batch_render_slices path instead of
  // one render per cell. Driven by the `mosaicBatchRender` feature flag.
  private get batchRenderEnabled() { return batchRenderEnabled; }
  private static readonly MAX_CONCURRENT_RENDERS = 4;
  // Backend caps a single batch_render_slices call at 25 slices.
  private static readonly MAX_BATCH_SLICES = 25;
  // Store actual slice positions for each cell tag
  private slicePositions = new Map<string, number>();
  private cellViewPlanes = new Map<string, ViewPlane>();

  /**
   * Enable/disable the packed batch render path (wired from the
   * `mosaicBatchRender` feature flag in useServicesInit).
   */
  setBatchRenderEnabled(enabled: boolean): void {
    batchRenderEnabled = enabled;
  }

  /**
   * True while a cell's render is no longer authoritative: either a newer
   * render/cancel took ownership of the cellId, or the grid generation that
   * scheduled it was superseded.
   */
  private isStale(cellId: string, requestId: number, generation?: number): boolean {
    if (this.activeRenders.get(cellId) !== requestId) {
      return true;
    }
    if (generation !== undefined && generation !== this.gridGeneration) {
      return true;
    }
    return false;
  }

  /**
   * Render a single mosaic cell
   */
  async renderMosaicCell(request: MosaicRenderRequest, generation?: number, snapshot = this.getViewState()): Promise<void> {
    const { sliceIndex, axis, cellId, width, height } = request;

    debug(`[MosaicRenderService] Starting render for cell:`, {
      cellId,
      sliceIndex,
      axis,
      width,
      height,
    });

    // Stamp this render's epoch; a later render or cancel invalidates it.
    const requestId = this.nextRequestId++;
    this.activeRenders.set(cellId, requestId);

    try {
      // Update store to indicate rendering started
      const renderStore = useRenderStateStore.getState();
      renderStore.setRendering(cellId, true);

      // Get current view state
      const currentViewState = snapshot;

      debug(`[MosaicRenderService] Current ViewState structure:`, {
        cellId,
        hasLayers: !!currentViewState.layers,
        layerCount: currentViewState.layers?.length,
        firstLayer: currentViewState.layers?.[0],
        hasCrosshair: !!currentViewState.crosshair,
        hasViews: !!currentViewState.views,
        viewKeys: Object.keys(currentViewState.views || {}),
      });

      // Create a modified view state for this specific slice WITH correct dimensions
      const modifiedViewState = await this.createSliceViewState(
        currentViewState,
        axis,
        sliceIndex,
        width,
        height,
      );

      // Store the actual slice position for this cell
      // This is needed for correct crosshair calculation
      const slicePosition = await this.getSlicePositionForIndex(currentViewState, axis, sliceIndex);

      // A newer render (or cancel/supersede) may have claimed this cell while we
      // awaited bounds; drop out before touching any shared state.
      if (this.isStale(cellId, requestId, generation)) {
        return;
      }

      this.slicePositions.set(cellId, slicePosition);
      debug(`[MosaicRenderService] Stored slice position ${slicePosition}mm for cell ${cellId}`);
      this.cellViewPlanes.set(cellId, modifiedViewState.views[axis]);

      debug(`[MosaicRenderService] Modified ViewState for slice ${sliceIndex}:`, {
        cellId,
        hasModifiedViews: !!modifiedViewState.views,
        modifiedViewKeys: Object.keys(modifiedViewState.views || {}),
        axialView: modifiedViewState.views?.axial,
      });

      // Render using the normal pipeline with correct cell dimensions
      // This ensures backend renders at the exact size needed for the canvas
      debug(
        `[MosaicRenderService] Calling applyAndRenderViewState for ${cellId} WITH dimensions ${width}x${height}`,
      );

      const imageBitmap = await this.apiService.applyAndRenderViewState(
        modifiedViewState,
        axis,
        width, // Pass actual cell width to match canvas size
        height, // Pass actual cell height to match canvas size
      );

      debug(`[MosaicRenderService] Render result for ${cellId}:`, {
        hasImageBitmap: !!imageBitmap,
        imageBitmapType: imageBitmap ? imageBitmap.constructor.name : 'null',
        imageBitmapSize: imageBitmap ? `${imageBitmap.width}x${imageBitmap.height}` : 'N/A',
      });

      // Re-check ownership after the render await before writing the image.
      if (this.isStale(cellId, requestId, generation)) {
        imageBitmap?.close();
        return;
      }

      if (imageBitmap) {
        // Update store with the rendered image
        renderStore.setImage(cellId, imageBitmap);
        renderStore.setRendering(cellId, false);
        debug(`[MosaicRenderService] Updated store with image for ${cellId}`);
      } else {
        throw new Error('No image returned from backend');
      }
    } catch (error) {
      // A stale render that failed must not clobber the newer render's state.
      if (this.isStale(cellId, requestId, generation)) {
        return;
      }
      console.error(`[MosaicRenderService] Error rendering ${cellId}:`, {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        sliceIndex,
        axis,
      });

      // Update store with the error
      const renderStore = useRenderStateStore.getState();
      renderStore.setError(cellId, error instanceof Error ? error : new Error(String(error)));
      renderStore.setRendering(cellId, false);
    } finally {
      // Only release ownership if we still hold it (a newer render may already
      // own the cellId).
      if (this.activeRenders.get(cellId) === requestId) {
        this.activeRenders.delete(cellId);
      }
      debug(`[MosaicRenderService] Finished processing ${cellId}`);
    }
  }

  /**
   * Render multiple mosaic cells.
   *
   * Rapid successive calls (e.g. timepoint scrubbing) are coalesced: the latest
   * requests overwrite the pending slot and a single microtask-scheduled flush
   * dispatches only that latest grid. The returned promise resolves once the
   * flushed dispatch completes, so callers can still await a full render.
   */
  renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    this.pendingGrid = requests;

    if (!this.flushPromise) {
      this.flushPromise = Promise.resolve().then(async () => {
        const pending = this.pendingGrid;
        this.pendingGrid = null;
        this.flushPromise = null;
        if (pending) {
          await this.dispatchGrid(pending);
        }
      });
    }

    return this.flushPromise;
  }

  /**
   * Dispatch one grid generation. Increments the generation so any older grid's
   * in-flight cells are superseded, then renders via the batch path (if enabled)
   * or the per-cell path.
   */
  private async dispatchGrid(requests: MosaicRenderRequest[]): Promise<void> {
    const generation = ++this.gridGeneration;

    if (this.batchRenderEnabled) {
      try {
        await this.dispatchGridBatch(requests, generation);
        return;
      } catch (error) {
        console.warn(
          '[MosaicRenderService] Batch render failed; falling back to per-cell rendering',
          error,
        );
        // Fall through to the per-cell path. Nothing is written to the store
        // before a successful decode, so the fallback re-renders cleanly.
      }
    }

    await this.dispatchGridPerCell(requests, generation);
  }

  /**
   * Per-cell dispatch with controlled concurrency (today's default path).
   */
  private async dispatchGridPerCell(
    requests: MosaicRenderRequest[],
    generation: number,
  ): Promise<void> {
    debug(
      `[MosaicRenderService] Starting batched rendering: ${requests.length} requests, max concurrent: ${MosaicRenderService.MAX_CONCURRENT_RENDERS}`,
    );

    const snapshot = this.getViewState();
    const batches = this.createBatches(requests, MosaicRenderService.MAX_CONCURRENT_RENDERS);
    const results = {
      successful: 0,
      failed: 0,
      errors: [] as Array<{ cellId: string; error: any }>,
    };

    // Process batches sequentially, but items within each batch in parallel
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      debug(
        `[MosaicRenderService] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} renders`,
      );

      // Process batch with controlled concurrency
      const batchPromises = batch.map(async (request) => {
        try {
          await this.renderMosaicCell(request, generation, snapshot);
          results.successful++;
          return { success: true, cellId: request.cellId };
        } catch (error) {
          results.failed++;
          results.errors.push({ cellId: request.cellId, error });
          return { success: false, cellId: request.cellId, error };
        }
      });

      // Wait for all renders in this batch to complete
      await Promise.all(batchPromises);
    }

    debug(
      `[MosaicRenderService] All batches complete: ${results.successful}/${requests.length} successful`,
    );

    if (results.failed > 0) {
      console.warn('[MosaicRenderService] Some cells failed to render:', results.errors);
      // Don't throw - allow partial success
    }
  }

  /**
   * Packed batch dispatch: build per-cell view states (with `requestedView`
   * populated), issue one batch_render_slices call per <=25-cell chunk, decode
   * the packed buffer, and paint each cell under the same epoch/generation guard
   * used by the per-cell path.
   */
  private async dispatchGridBatch(
    requests: MosaicRenderRequest[],
    generation: number,
  ): Promise<void> {
    const renderStore = useRenderStateStore.getState();
    const baseViewState = this.getViewState();

    // Stamp epochs and mark all cells rendering up front so a stale batch cannot
    // resurrect a cell a newer dispatch already claimed.
    const cellRequestIds = new Map<string, number>();
    for (const request of requests) {
      const requestId = this.nextRequestId++;
      cellRequestIds.set(request.cellId, requestId);
      this.activeRenders.set(request.cellId, requestId);
      renderStore.setRendering(request.cellId, true);
    }

    const chunks = this.createHomogeneousBatches(requests, MosaicRenderService.MAX_BATCH_SLICES);

    for (const chunk of chunks) {
      const viewStates = await Promise.all(
        chunk.map((request) => this.createBatchCellViewState(baseViewState, request)),
      );

      if (generation !== this.gridGeneration) {
        return;
      }

      for (let i = 0; i < chunk.length; i++) {
        const request = chunk[i];
        const requestId = cellRequestIds.get(request.cellId)!;
        if (this.isStale(request.cellId, requestId, generation)) continue;
        const plane = viewStates[i].views[request.axis];
        const dimension = request.axis === 'sagittal' ? 0 : request.axis === 'coronal' ? 1 : 2;
        this.slicePositions.set(request.cellId, plane.origin_mm[dimension]);
        this.cellViewPlanes.set(request.cellId, plane);
      }

      const widthPerSlice = chunk[0].width;
      const heightPerSlice = chunk[0].height;
      const buffer = await this.apiService.batchRenderSlices(
        viewStates,
        widthPerSlice,
        heightPerSlice,
      );

      if (generation !== this.gridGeneration) {
        return;
      }

      const slices = decodeBatchRenderBuffer(buffer);
      if (slices.length !== chunk.length) {
        throw new Error(
          `Batch decode mismatch: expected ${chunk.length} slices, got ${slices.length}`,
        );
      }

      await Promise.all(
        chunk.map(async (request, index) => {
          const bitmap = await createImageBitmap(slices[index].image);
          const requestId = cellRequestIds.get(request.cellId);
          if (requestId === undefined || this.isStale(request.cellId, requestId, generation)) {
            bitmap.close();
            return;
          }
          renderStore.setImage(request.cellId, bitmap);
          renderStore.setRendering(request.cellId, false);
          if (this.activeRenders.get(request.cellId) === requestId) {
            this.activeRenders.delete(request.cellId);
          }
        }),
      );
    }
  }

  /**
   * Build a per-cell view state for the batch path: identical framing to the
   * per-cell path plus a `requestedView` field consumed by BatchRenderService.
   */
  private async createBatchCellViewState(
    baseViewState: ViewState,
    request: MosaicRenderRequest,
  ): Promise<ViewState & { requestedView: unknown }> {
    const { sliceIndex, axis, cellId, width, height } = request;

    const modifiedViewState = await this.createSliceViewState(
      baseViewState,
      axis,
      sliceIndex,
      width,
      height,
    );

    const view = modifiedViewState.views[axis];
    const requestedView = {
      type: axis,
      origin_mm: [view.origin_mm[0], view.origin_mm[1], view.origin_mm[2]],
      // Full-extent basis vectors (per-pixel step scaled across the viewport),
      // matching the requestedViews shape used by renderViewStateMulti.
      u_mm: [view.u_mm[0] * width, view.u_mm[1] * width, view.u_mm[2] * width, 0.0],
      v_mm: [view.v_mm[0] * height, view.v_mm[1] * height, view.v_mm[2] * height, 0.0],
      width,
      height,
    };

    return { ...modifiedViewState, requestedView };
  }

  /**
   * Create batches from an array of items
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Batch backend requires every ViewState in a call to share one viewport size
   * because the response envelope has a single width/height header.
   */
  private createHomogeneousBatches(
    requests: MosaicRenderRequest[],
    batchSize: number,
  ): MosaicRenderRequest[][] {
    const groups: MosaicRenderRequest[][] = [];
    const bySize = new Map<string, MosaicRenderRequest[]>();

    for (const request of requests) {
      const key = `${request.width}x${request.height}`;
      let group = bySize.get(key);
      if (!group) {
        group = [];
        bySize.set(key, group);
        groups.push(group);
      }
      group.push(request);
    }

    return groups.flatMap((group) => this.createBatches(group, batchSize));
  }

  /**
   * Cancel active renders for given cell IDs and clean up their state.
   *
   * Deleting the epoch entry invalidates any in-flight render for the cell (its
   * ownership check will fail and it will no-op), and setRendering(false) clears
   * the spinner so a cancelled cell cannot leak a stuck rendering state.
   */
  cancelRenders(cellIds: string[]): void {
    const renderStore = useRenderStateStore.getState();
    const cancelled = new Set(cellIds);
    if (this.pendingGrid) {
      this.pendingGrid = this.pendingGrid.filter(request => !cancelled.has(request.cellId));
    }
    for (const cellId of cellIds) {
      this.activeRenders.delete(cellId);
      this.slicePositions.delete(cellId);
      this.cellViewPlanes.delete(cellId);
      renderStore.setRendering(cellId, false);
    }
  }

  /**
   * Destroy the service, clearing all accumulated state
   */
  destroy(): void {
    this.cancelRenders([...this.activeRenders.keys()]);
    this.activeRenders.clear();
    this.slicePositions.clear();
    this.cellViewPlanes.clear();
    this.pendingGrid = null;
    this.flushPromise = null;
    this.gridGeneration++;
    this.geometryCache = new WeakMap();
  }

  /**
   * Get the actual slice position for a given cell tag
   */
  getSlicePositionForTag(tag: string): number | undefined {
    return this.slicePositions.get(tag);
  }

  getViewPlaneForTag(tag: string): ViewPlane | undefined {
    return this.cellViewPlanes.get(tag);
  }

  /**
   * Calculate crosshair information for a mosaic cell
   * Returns screen coordinates if the global crosshair should be visible on this slice
   */
  calculateCrosshairForCell(
    globalCrosshair: [number, number, number],
    axis: 'axial' | 'sagittal' | 'coronal',
    slicePosition: number,
    viewPlane: ViewPlane,
  ): CrosshairInfo {
    debug(`[MosaicRenderService] calculateCrosshairForCell:`, {
      globalCrosshair,
      axis,
      slicePosition,
      viewPlane: {
        origin_mm: viewPlane.origin_mm,
        u_mm: viewPlane.u_mm,
        v_mm: viewPlane.v_mm,
        dim_px: viewPlane.dim_px,
      },
    });

    // Check if the crosshair is on this slice (within 1mm tolerance)
    let isOnSlice = false;
    let diff = 0;
    switch (axis) {
      case 'axial':
        diff = Math.abs(globalCrosshair[2] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
      case 'sagittal':
        diff = Math.abs(globalCrosshair[0] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
      case 'coronal':
        diff = Math.abs(globalCrosshair[1] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
    }
    debug(
      `[MosaicRenderService] Slice at ${slicePosition}, crosshair diff: ${diff}, isOnSlice: ${isOnSlice}`,
    );

    if (!isOnSlice) {
      // This is a mirror crosshair - project the global crosshair onto this slice
      let projectedCrosshair: [number, number, number];
      switch (axis) {
        case 'axial':
          projectedCrosshair = [globalCrosshair[0], globalCrosshair[1], slicePosition];
          break;
        case 'sagittal':
          projectedCrosshair = [slicePosition, globalCrosshair[1], globalCrosshair[2]];
          break;
        case 'coronal':
          projectedCrosshair = [globalCrosshair[0], slicePosition, globalCrosshair[2]];
          break;
      }

      // Transform to screen coordinates without plane tolerance check
      const screenCoord = CoordinateTransform.worldToScreenUnchecked(projectedCrosshair, viewPlane);
      debug(`[MosaicRenderService] Mirror crosshair:`, {
        projectedCrosshair,
        screenCoord,
        isActive: false,
      });
      return {
        screenCoord,
        isActive: false,
      };
    } else {
      // This is the active crosshair slice
      const screenCoord = CoordinateTransform.worldToScreenUnchecked(globalCrosshair, viewPlane);
      debug(`[MosaicRenderService] Active crosshair:`, {
        globalCrosshair,
        screenCoord,
        isActive: true,
      });
      return {
        screenCoord,
        isActive: true,
      };
    }
  }

  /**
   * Create a modified ViewState for a specific slice
   */
  private async createSliceViewState(
    baseViewState: ViewState,
    axis: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
    width: number,
    height: number,
  ): Promise<ViewState> {
    // Get all visible layers to calculate combined bounds
    const visibleLayers = baseViewState.layers.filter((l) => l.visible && l.opacity > 0);
    if (visibleLayers.length === 0) {
      return baseViewState;
    }

    const sampling = await this.getSampling(baseViewState, axis);
    const combinedBounds = sampling.bounds;
    const slicePosition_mm = slicePositionAtIndex(sampling, sliceIndex);

    // CRITICAL FIX: Calculate proper ViewPlane for this cell's dimensions
    // This ensures the entire slice fits within the cell, not a zoomed portion

    // Calculate the field of view in mm from the volume bounds
    let widthMm: number, heightMm: number;
    switch (axis) {
      case 'axial': // XY plane
        widthMm = combinedBounds.max[0] - combinedBounds.min[0]; // X extent
        heightMm = combinedBounds.max[1] - combinedBounds.min[1]; // Y extent
        break;
      case 'sagittal': // YZ plane
        widthMm = combinedBounds.max[1] - combinedBounds.min[1]; // Y extent
        heightMm = combinedBounds.max[2] - combinedBounds.min[2]; // Z extent
        break;
      case 'coronal': // XZ plane
        widthMm = combinedBounds.max[0] - combinedBounds.min[0]; // X extent
        heightMm = combinedBounds.max[2] - combinedBounds.min[2]; // Z extent
        break;
    }

    // Use ViewPlaneService for consistent pixel size and centering calculations
    const viewPlaneService = getViewPlaneService();

    // Calculate uniform pixel size to maintain aspect ratio and square pixels
    // This is the key to showing the entire slice within the cell
    const pixelSize = viewPlaneService.calculatePixelSize(widthMm, heightMm, width, height);

    // Calculate centering offsets when anatomy doesn't fill the entire canvas
    // This happens when one dimension is smaller than the other
    const offsets = viewPlaneService.calculateCenteringOffsets(
      widthMm,
      heightMm,
      width,
      height,
      pixelSize,
    );
    const xCenterOffset = offsets.x;
    const yCenterOffset = offsets.y;

    // Calculate new origin and basis vectors for this cell's ViewPlane
    let newOrigin: [number, number, number];
    let newU: [number, number, number];
    let newV: [number, number, number];

    switch (axis) {
      case 'axial':
        // Center the view within the canvas
        newOrigin = [
          combinedBounds.min[0] - xCenterOffset, // Center X if narrower
          combinedBounds.max[1] + yCenterOffset, // Center Y if shorter (Y inverted)
          slicePosition_mm,
        ];
        newU = [pixelSize, 0, 0]; // +X right
        newV = [0, -pixelSize, 0]; // -Y down (neurological view)
        break;
      case 'sagittal':
        // For sagittal, Y is horizontal and Z is vertical
        const sagYOffset = xCenterOffset; // Y maps to horizontal
        const sagZOffset = yCenterOffset; // Z maps to vertical
        newOrigin = [
          slicePosition_mm,
          combinedBounds.max[1] + sagYOffset, // Center Y if narrower
          combinedBounds.max[2] + sagZOffset, // Center Z if shorter
        ];
        newU = [0, -pixelSize, 0]; // -Y right
        newV = [0, 0, -pixelSize]; // -Z down
        break;
      case 'coronal':
        // For coronal, X is horizontal and Z is vertical
        newOrigin = [
          combinedBounds.min[0] - xCenterOffset, // Center X if narrower
          slicePosition_mm,
          combinedBounds.max[2] + yCenterOffset, // Center Z if shorter
        ];
        newU = [pixelSize, 0, 0]; // +X right
        newV = [0, 0, -pixelSize]; // -Z down
        break;
    }

    const newViewPlane: ViewPlane = {
      origin_mm: newOrigin,
      u_mm: newU,
      v_mm: newV,
      dim_px: [width, height],
    };

    // Create the modified ViewState with both crosshair and proper ViewPlane
    const modifiedViewState: ViewState = {
      ...baseViewState,
      crosshair: {
        world_mm: (() => {
          // Create crosshair at the slice position
          const crosshair: [number, number, number] = [...baseViewState.crosshair.world_mm];
          switch (axis) {
            case 'axial':
              crosshair[2] = slicePosition_mm;
              break;
            case 'sagittal':
              crosshair[0] = slicePosition_mm;
              break;
            case 'coronal':
              crosshair[1] = slicePosition_mm;
              break;
          }
          return crosshair;
        })(),
        visible: false, // Let cells draw crosshairs themselves
      },
      // Add the correctly framed ViewPlane for this axis
      views: {
        ...baseViewState.views,
        [axis]: newViewPlane,
      },
    };

    debug(`[MosaicRenderService] Correctly framed ViewState for ${axis} slice ${sliceIndex}:`, {
      slicePosition_mm,
      crosshair: modifiedViewState.crosshair.world_mm,
      newViewPlane,
      pixelSize,
    });

    return modifiedViewState;
  }

  /**
   * Get the actual slice position for a given slice index
   * This calculates the exact mm position without any centering offsets
   */
  private async getSlicePositionForIndex(
    baseViewState: ViewState,
    axis: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
  ): Promise<number> {
    return slicePositionAtIndex(await this.getSampling(baseViewState, axis), sliceIndex);
  }
}

// Singleton instance
let instance: MosaicRenderService | null = null;

export function getMosaicRenderService(): MosaicRenderService {
  if (!instance) {
    instance = new MosaicRenderService();
  }
  return instance;
}

export function destroyMosaicRenderService(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

/** A workspace owns this service and disposes it with its viewport. */
export function createMosaicRenderService(workspaceId: string): MosaicRenderService {
  return new MosaicRenderService(workspaceId);
}
