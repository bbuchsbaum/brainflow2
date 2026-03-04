/**
 * Surface Overlay Service
 * Handles loading and management of surface data overlays (functional, shape, label data)
 */

import { nanoid } from 'nanoid';
import { getTransport } from './transport';
import { AtlasService } from './AtlasService';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';
import { buildLabelRgbaFromPalette } from '@/hooks/atlasSurfaceColorUtils';
import type { DisplayLayer } from '@/types/displayLayer';
import type { AtlasPaletteKind } from '@/types/atlasPalette';

// Debug toggle for comprehensive logging
const DEBUG_OVERLAY = false;

function debugLog(category: string, message: string, data?: unknown) {
  if (DEBUG_OVERLAY) {
    console.log(`[SurfaceOverlay:${category}]`, message, data ?? '');
  }
}

const MAX_DISCRETE_LABELS = 4096;
const MIN_INTEGER_FRACTION = 0.995;

export interface SurfaceDataLayer {
  id: string;
  name: string;
  dataHandle: string;
  surfaceId: string;
  colormap: string;
  range: [number, number];
  threshold?: [number, number];
  opacity: number;
  showOnlyPositive?: boolean;
  showOnlyNegative?: boolean;
  mean?: number;
  std?: number;
  clusterThreshold?: number;
  smoothingKernel?: number;
  // GPU Projection fields (optional - when present, layer can use GPU path)
  volumeData?: ArrayBuffer;               // Raw volume data for GPU texture
  volumeDims?: [number, number, number];  // Volume dimensions [nx, ny, nz]
  affineMatrix?: Float32Array;            // Column-major 4x4 voxel-to-world affine
  volumeId?: string;                      // Reference to source volume
  parcellationReferenceId?: string;
  atlasPaletteKind?: AtlasPaletteKind;
  atlasPaletteSeed?: number;
  atlasMaxLabel?: number;
}

export interface LoadedSurfaceData {
  handle: string;
  data_count: number;
  intent: string;
}

export class SurfaceOverlayService {
  private static instance: SurfaceOverlayService;
  
  private constructor() {}
  
  static getInstance(): SurfaceOverlayService {
    if (!SurfaceOverlayService.instance) {
      SurfaceOverlayService.instance = new SurfaceOverlayService();
    }
    return SurfaceOverlayService.instance;
  }
  
  /**
   * Check if a file is a surface overlay based on naming patterns
   */
  isOverlayFile(path: string): boolean {
    return path.includes('.func.gii') || 
           path.includes('.shape.gii') ||
           path.includes('.label.gii');
  }
  
  /**
   * Detect GIFTI file type from filename
   */
  detectGiftiType(filename: string): 'geometry' | 'overlay' | 'unknown' {
    if (filename.includes('.surf.gii')) return 'geometry';
    if (filename.includes('.func.gii')) return 'overlay';
    if (filename.includes('.shape.gii')) return 'overlay';
    if (filename.includes('.label.gii')) return 'overlay';
    return 'unknown';
  }

  private inferSpaceHint(surfacePath: string | undefined): string | undefined {
    if (!surfacePath || !surfacePath.startsWith('templateflow://')) {
      return undefined;
    }
    const descriptor = surfacePath.slice('templateflow://'.length);
    const token = descriptor.split('_')[0]?.trim();
    return token ? token : undefined;
  }

  private inferAtlasIdHint(filePath: string): string | undefined {
    const fileName = filePath.split('/').pop() ?? '';
    const withoutExtension = fileName.replace(/[.](label|shape|func)[.]gii$/i, '');
    const normalized = withoutExtension
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    return normalized || undefined;
  }

  private isLikelyLabelOverlay(filePath: string, intent: string | undefined, values: Float32Array): boolean {
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.includes('.label.gii')) {
      return true;
    }

    const normalizedIntent = (intent ?? '').toLowerCase();
    if (normalizedIntent.includes('label')) {
      return true;
    }

    if (values.length === 0) {
      return false;
    }

    const sampleSize = Math.min(values.length, 50_000);
    const step = Math.max(1, Math.floor(values.length / sampleSize));
    let finiteCount = 0;
    let integerLikeCount = 0;
    const unique = new Set<number>();

    for (let index = 0; index < values.length; index += step) {
      const value = values[index];
      if (!Number.isFinite(value)) {
        continue;
      }
      finiteCount += 1;
      const rounded = Math.round(value);
      if (value >= 0 && Math.abs(value - rounded) <= 1e-6) {
        integerLikeCount += 1;
        if (unique.size <= MAX_DISCRETE_LABELS) {
          unique.add(rounded);
        }
      }
    }

    if (finiteCount === 0) {
      return false;
    }

    const integerFraction = integerLikeCount / finiteCount;
    return integerFraction >= MIN_INTEGER_FRACTION && unique.size > 1 && unique.size <= MAX_DISCRETE_LABELS;
  }

  private toDenseLabels(values: Float32Array): Uint32Array | null {
    const labels = new Uint32Array(values.length);
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (!Number.isFinite(value)) {
        labels[index] = 0;
        continue;
      }
      if (value < 0) {
        return null;
      }
      const rounded = Math.round(value);
      if (Math.abs(value - rounded) > 1e-6 || rounded > 0xffffffff) {
        return null;
      }
      labels[index] = rounded >>> 0;
    }
    return labels;
  }

  private labelsToValues(labels: Uint32Array): Float32Array {
    const values = new Float32Array(labels.length);
    for (let index = 0; index < labels.length; index++) {
      values[index] = labels[index];
    }
    return values;
  }

  /**
   * Load a surface overlay file and apply it to a target surface
   */
  async loadSurfaceOverlay(
    filePath: string,
    targetSurfaceId: string
  ): Promise<SurfaceDataLayer> {
    debugLog('load', `Starting load: ${filePath} for surface: ${targetSurfaceId}`);

    // Validate file is overlay type
    if (!this.isOverlayFile(filePath)) {
      throw new Error(`Not a valid overlay file: ${filePath}`);
    }

    try {
      const transport = getTransport();
      const surfaceState = useSurfaceStore.getState();
      const surface = surfaceState.surfaces.get(targetSurfaceId);
      if (!surface) {
        throw new Error(`Surface ${targetSurfaceId} not loaded; cannot apply overlay`);
      }

      debugLog('load', 'Surface found, invoking backend load_surface_overlay');

      // Load data via Tauri command
      const result = await transport.invoke<LoadedSurfaceData>('load_surface_overlay', {
        path: filePath,
        targetSurfaceId,
      });

      debugLog('load', 'Backend returned:', result);

      // Get the actual overlay data from the backend
      const overlayData = await transport.invoke<number[]>('get_surface_overlay_data', {
        handle: result.handle,
      });

      debugLog('load', `Got overlay data array, length: ${overlayData.length}`);
      debugLog('load', `First 5 values: ${overlayData.slice(0, 5).map(v => v.toFixed(4)).join(', ')}`);

      // Convert to Float32Array
      const values = new Float32Array(overlayData);

      debugLog('load', `Float32Array created, length: ${values.length}`);
      const expectedVertices =
        (surface.geometry?.vertices?.length ?? 0) > 0
          ? surface.geometry.vertices.length / 3
          : surface.metadata?.vertexCount ?? 0;

      if (expectedVertices > 0 && values.length !== expectedVertices) {
        const msg = `Overlay vertex count ${values.length} does not match surface geometry (${expectedVertices}).`;
        console.error('[SurfaceOverlayService] ' + msg);
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: msg,
        });
        throw new Error(msg);
      }
      
      // Calculate data statistics
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let validCount = 0;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (!isNaN(val) && isFinite(val)) {
          min = Math.min(min, val);
          max = Math.max(max, val);
          sum += val;
          validCount++;
        }
      }
      const mean = validCount > 0 ? sum / validCount : 0;

      // Calculate standard deviation
      let sumSquaredDiff = 0;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (!isNaN(val) && isFinite(val)) {
          sumSquaredDiff += Math.pow(val - mean, 2);
        }
      }
      const std = validCount > 0 ? Math.sqrt(sumSquaredDiff / validCount) : 0;

      // Data validation - check for empty or invalid data
      debugLog('stats', `Data validation: ${values.length} total, ${validCount} valid (${(validCount/values.length*100).toFixed(1)}%)`);
      debugLog('stats', `Range: [${min.toFixed(4)}, ${max.toFixed(4)}], Mean: ${mean.toFixed(4)}, Std: ${std.toFixed(4)}`);

      if (values.length === 0) {
        throw new Error('Overlay data is empty');
      }
      if (validCount === 0) {
        throw new Error('Overlay data contains no valid numeric values');
      }

      // Extract filename for display
      const name = filePath.split('/').pop() || 'Unknown Overlay';

      let layerValues = values;
      let layerColormap = 'viridis';
      let layerRange: [number, number] = [min, max];
      let layerThreshold: [number, number] = [0, 0];
      let layerRgba: Float32Array | undefined;
      let layerLabels: Uint32Array | undefined;
      let parcellationReferenceId: string | undefined;
      let atlasPaletteKind: AtlasPaletteKind | undefined;
      let atlasPaletteSeed: number | undefined;
      let atlasMaxLabel: number | undefined;

      const isLabelLike = this.isLikelyLabelOverlay(filePath, result.intent, values);
      if (isLabelLike) {
        const denseLabels = this.toDenseLabels(values);
        if (denseLabels) {
          try {
            const importResult = await AtlasService.importSurfaceLabelParcellation({
              dataHandle: result.handle,
              sourceName: name,
              atlasIdHint: this.inferAtlasIdHint(filePath),
              atlasNameHint: name,
              atlasSpaceHint: this.inferSpaceHint(surface.metadata?.path),
              hemisphereHint: surface.geometry?.hemisphere ?? surface.metadata?.hemisphere,
            });
            const palette = await AtlasService.getParcellationReferencePalette(
              importResult.reference.reference_id
            );

            layerValues = this.labelsToValues(denseLabels);
            layerLabels = denseLabels;
            layerRgba = buildLabelRgbaFromPalette(denseLabels, palette);
            layerColormap = 'categorical';
            layerRange = [0, palette.lut.max_label];
            layerThreshold = [0, 0];
            parcellationReferenceId = importResult.reference.reference_id;
            atlasPaletteKind = palette.lut.kind;
            atlasPaletteSeed = palette.lut.seed;
            atlasMaxLabel = palette.lut.max_label;

            debugLog('label', 'Imported dense label overlay as parcellation reference', {
              referenceId: parcellationReferenceId,
              uniqueLabels: importResult.unique_label_count,
              nonzeroLabels: importResult.nonzero_label_count,
              maxLabel: palette.lut.max_label,
            });
          } catch (labelError) {
            console.warn('[SurfaceOverlayService] Failed categorical import for label overlay, falling back to scalar mode:', labelError);
          }
        } else {
          console.warn('[SurfaceOverlayService] Label-like overlay contains non-integer or negative values; using scalar mode.');
        }
      }

      debugLog('config', `Using threshold: [${layerThreshold[0]}, ${layerThreshold[1]}]`);
      debugLog('config', `Using range: [${layerRange[0].toFixed(4)}, ${layerRange[1].toFixed(4)}]`);
      
      // Create data layer
      const dataLayer: SurfaceDataLayer = {
        id: nanoid(),
        name,
        dataHandle: result.handle,
        surfaceId: targetSurfaceId,
        colormap: layerColormap,
        range: layerRange,
        threshold: layerThreshold,
        opacity: 1.0,
        mean,
        std,
        parcellationReferenceId,
        atlasPaletteKind,
        atlasPaletteSeed,
        atlasMaxLabel,
      };

      // Add to surface store using actions so state updates propagate
      const { addDataLayer, upsertDisplayLayer } = surfaceState;
      addDataLayer(targetSurfaceId, {
        id: dataLayer.id,
        name: dataLayer.name,
        values: layerValues,
        colormap: dataLayer.colormap,
        range: dataLayer.range,        // Initial intensity window (same as dataRange)
        dataRange: dataLayer.range,    // True data extent (min/max of actual values)
        threshold: dataLayer.threshold,
        opacity: dataLayer.opacity,
        rgba: layerRgba,
        labels: layerLabels,
        parcellationReferenceId,
        atlasPaletteKind,
        atlasPaletteSeed,
        atlasMaxLabel,
        showOnlyPositive: dataLayer.showOnlyPositive,
        showOnlyNegative: dataLayer.showOnlyNegative,
        clusterThreshold: dataLayer.clusterThreshold,
        smoothingKernel: dataLayer.smoothingKernel,
        mean,
        std,
      });

      // Register a display-layer entry so UI controls can toggle visibility
      const displayLayer: DisplayLayer = {
        id: dataLayer.id,
        name: dataLayer.name,
        type: layerRgba && layerLabels ? 'label' : 'scalar',
        visible: true,
        opacity: dataLayer.opacity,
        colormap: dataLayer.colormap,
        intensity: dataLayer.range,
        threshold: dataLayer.threshold,
      };
      upsertDisplayLayer(targetSurfaceId, displayLayer);

      debugLog('store', `Added data layer to store: ${dataLayer.id}`);
      debugLog('store', `Display layer created with colormap: ${displayLayer.colormap}, visible: ${displayLayer.visible}`);

      // Notify UI of update
      getEventBus().emit('surface.dataLayerAdded', {
        surfaceId: targetSurfaceId,
        layerId: dataLayer.id,
      });

      debugLog('event', `Emitted surface.dataLayerAdded for layer: ${dataLayer.id}`);
      debugLog('load', `SUCCESS: Overlay loaded with ${values.length} vertices`);

      return dataLayer;
    } catch (error) {
      console.error('Failed to load surface overlay:', error);
      
      // Show error notification
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: `Failed to Load Overlay: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
      });
      
      throw error;
    }
  }
  
  /**
   * Remove a data layer from a surface
   */
  removeSurfaceDataLayer(surfaceId: string, layerId: string): void {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      surface.layers.delete(layerId);
      // Also remove the data handle
      if ((surface as any).dataHandles) {
        (surface as any).dataHandles.delete(layerId);
      }
      surfaceStore.surfaces.set(surfaceId, surface);
      
      getEventBus().emit('surface.dataLayerRemoved', {
        surfaceId,
        layerId,
      });
    }
  }
  
  /**
   * Update data layer properties
   */
  updateDataLayer(
    surfaceId: string,
    layerId: string,
    updates: Partial<SurfaceDataLayer>
  ): void {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      const layer = surface.layers.get(layerId);
      if (layer) {
        // Update the layer
        const updatedLayer = { ...layer, ...updates };
        surface.layers.set(layerId, updatedLayer);
        surfaceStore.surfaces.set(surfaceId, surface);
        
        getEventBus().emit('surface.dataLayerUpdated', {
          surfaceId,
          layerId,
          updates,
        });
      }
    }
  }
  
  /**
   * Get all data layers for a surface
   */
  getDataLayersForSurface(surfaceId: string): SurfaceDataLayer[] {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      // Convert from store format to SurfaceDataLayer format
      return Array.from(surface.layers.values()).map(layer => ({
        id: layer.id,
        name: layer.name,
        dataHandle: (surface as any).dataHandles?.get(layer.id) || '',
        surfaceId: surfaceId,
        colormap: layer.colormap,
        range: layer.range,
        threshold: layer.threshold,
        opacity: layer.opacity,
        showOnlyPositive: layer.showOnlyPositive,
        showOnlyNegative: layer.showOnlyNegative,
        mean: layer.mean,
        std: layer.std,
        clusterThreshold: layer.clusterThreshold,
        smoothingKernel: layer.smoothingKernel,
      }));
    }
    
    return [];
  }
  
  /**
   * Apply overlay data to surface mesh
   * This would be called to actually update the Three.js mesh with the data
   */
  async applyOverlayToSurface(
    surfaceId: string,
    layerId: string
  ): Promise<void> {
    const layer = this.getDataLayersForSurface(surfaceId)
      .find(l => l.id === layerId);
    
    if (!layer) {
      throw new Error(`Data layer ${layerId} not found for surface ${surfaceId}`);
    }
    
    // This will be implemented when we integrate with SurfaceViewCanvas
    // For now, just emit an event
    getEventBus().emit('surface.overlayApplied', {
      surfaceId,
      layerId,
      dataHandle: layer.dataHandle,
      colormap: layer.colormap,
      range: layer.range,
      opacity: layer.opacity,
    });
  }
}

// Export singleton instance
export const surfaceOverlayService = SurfaceOverlayService.getInstance();
