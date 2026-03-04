/**
 * Volume to Surface Projection Service
 *
 * Handles projecting volumetric neuroimaging data (fMRI statistics, connectivity maps)
 * onto cortical surface meshes for visualization.
 */

import { getTransport } from './transport';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';
import type { SurfaceDataLayer } from './SurfaceOverlayService';
import type { AtlasConfig } from '@/types/atlas';
import type { AtlasPaletteLut, AtlasPaletteResponse } from '@/types/atlasPalette';

const DEBUG_PROJECTION = false;

function debugLog(category: string, message: string, data?: unknown) {
  if (DEBUG_PROJECTION) {
    console.log(`[VolToSurf:${category}]`, message, data ?? '');
  }
}

// Types matching bridge_types
// NOTE: bridge_types uses `#[serde(rename_all = "snake_case")]` for these enums,
// so the backend expects lowercase snake_case strings.
export type VolToSurfSamplingMode = 'midpoint' | 'thickness' | 'normal_line';
export type VolToSurfMappingFunction = 'average' | 'nearest_neighbor' | 'mode';

export interface VolToSurfProjectionParams {
  mapping_function?: VolToSurfMappingFunction;
  knn?: number;
  sigma?: number;
  distance_threshold?: number;
  fill?: number;
  sampling_mode?: VolToSurfSamplingMode;
  n_samples?: number;
  depth_fractions?: number[];
  radius?: number;
}

export interface DataRange {
  min: number;
  max: number;
}

export type SurfaceId = string;
export type SurfaceDataId = string;

function unwrapHandleId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const maybeId = record['id'];
    if (typeof maybeId === 'string') return maybeId;
  }
  return null;
}

export interface VolToSurfProjectionResult {
  data_handle: SurfaceDataId | { id: string } | [string];
  surface_handle: SurfaceId | { id: string } | [string];
  volume_id: string;
  valid_vertex_count: number;
  total_vertex_count: number;
  coverage_percent: number;
  data_range: DataRange | null;
  params: VolToSurfProjectionParams;
  timepoint?: number;
}

export interface SamplerInfo {
  sampler_handle: string;
  surface_handle: SurfaceId | { id: string } | [string];
  volume_dims: [number, number, number];
  vertex_count: number;
  sampling_mode: VolToSurfSamplingMode;
  valid: boolean;
}

/** GPU projection data returned from backend */
export interface VolumeGPUProjectionData {
  /** Raw volume data as Float32Array */
  volumeData: ArrayBuffer;
  /** Volume dimensions [nx, ny, nz] */
  dims: [number, number, number];
  /** Column-major 4x4 affine matrix (voxel-to-world) */
  affineMatrix: Float32Array;
  /** Data range [min, max] */
  dataRange: [number, number];
}

function invertMat4ColumnMajor(m: Float32Array): Float32Array {
  // Adapted from gl-matrix mat4.invert; column-major.
  const out = new Float32Array(16);

  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  // Calculate the determinant
  let det =
    b00 * b11 -
    b01 * b10 +
    b02 * b09 +
    b03 * b08 -
    b04 * b07 +
    b05 * b06;

  if (!det) {
    // Non-invertible; return identity to avoid crashing downstream.
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  }
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}

function transformPointMat4ColumnMajor(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
  // Column-major mat4 * vec4([x,y,z,1])
  const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
  const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
  return [tx, ty, tz];
}

function buildAtlasRgbaOverlay(params: {
  vertices: Float32Array;
  volumeData: ArrayBuffer;
  dims: [number, number, number];
  affineMatrix: Float32Array;
  lut: AtlasPaletteLut;
}): { labels: Uint32Array; rgba: Float32Array } {
  const { vertices, volumeData, dims, affineMatrix, lut } = params;

  const vertexCount = Math.floor(vertices.length / 3);
  const labels = new Uint32Array(vertexCount);
  const rgba = new Float32Array(vertexCount * 4);

  const data = new Float32Array(volumeData);
  const [nx, ny, nz] = dims;

  const worldToIJK = invertMat4ColumnMajor(affineMatrix);

  const lutRgb = lut.lut_rgb;
  const maxLabel = lut.max_label;

  for (let vi = 0; vi < vertexCount; vi++) {
    const base = vi * 3;
    const x = vertices[base];
    const y = vertices[base + 1];
    const z = vertices[base + 2];

    const [ijkX, ijkY, ijkZ] = transformPointMat4ColumnMajor(worldToIJK, x, y, z);

    const i = Math.min(nx - 1, Math.max(0, Math.floor(ijkX + 0.5)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(ijkY + 0.5)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor(ijkZ + 0.5)));
    const idx = i + nx * j + nx * ny * k;

    const value = data[idx];
    const label = Number.isFinite(value)
      ? Math.max(0, Math.min(maxLabel, Math.round(value)))
      : 0;
    labels[vi] = label;

    const off = vi * 4;
    if (label === 0) {
      rgba[off] = 0;
      rgba[off + 1] = 0;
      rgba[off + 2] = 0;
      rgba[off + 3] = 0;
      continue;
    }

    const lutOffset = label * 3;
    const r = lutRgb[lutOffset] ?? 0;
    const g = lutRgb[lutOffset + 1] ?? 0;
    const b = lutRgb[lutOffset + 2] ?? 0;
    rgba[off] = r / 255;
    rgba[off + 1] = g / 255;
    rgba[off + 2] = b / 255;
    rgba[off + 3] = 1;
  }

  return { labels, rgba };
}

/** Default projection parameters */
const DEFAULT_PROJECTION_PARAMS: VolToSurfProjectionParams = {
  mapping_function: 'average',
  knn: 6,
  sigma: 3.0,  // mm
  distance_threshold: 10.0,  // mm
  // Intentionally omit `fill` so Rust can use its default (NaN) internally.
  // `NaN` cannot cross the Tauri JSON boundary (it becomes `null`).
  fill: undefined,
  sampling_mode: 'midpoint',
  n_samples: 6,
  radius: 3.0,  // mm
};

function sanitizeProjectionParams(
  params: VolToSurfProjectionParams
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export class VolumeSurfaceProjectionService {
  private static instance: VolumeSurfaceProjectionService;

  /** Cache of active samplers for efficient 4D projection */
  private activeSamplers: Map<string, SamplerInfo> = new Map();

  private constructor() {}

  static getInstance(): VolumeSurfaceProjectionService {
    if (!VolumeSurfaceProjectionService.instance) {
      VolumeSurfaceProjectionService.instance = new VolumeSurfaceProjectionService();
    }
    return VolumeSurfaceProjectionService.instance;
  }

  /**
   * Project volume data onto a surface (one-shot projection)
   *
   * @param volumeId - The ID of the volume in the backend registry
   * @param surfaceId - The ID of the target surface
   * @param pialSurfaceId - Optional pial surface for thickness sampling
   * @param params - Projection parameters (uses defaults if not provided)
   * @param timepoint - Optional timepoint for 4D volumes
   * @returns Projection result with data handle and statistics
   */
  async projectVolumeToSurface(
    volumeId: string,
    surfaceId: string,
    pialSurfaceId?: string,
    params?: Partial<VolToSurfProjectionParams>,
    timepoint?: number
  ): Promise<VolToSurfProjectionResult> {
    const transport = getTransport();
    const eventBus = getEventBus();

    const fullParams: VolToSurfProjectionParams = {
      ...DEFAULT_PROJECTION_PARAMS,
      ...params,
    };
    const sanitizedParams = sanitizeProjectionParams(fullParams);

    debugLog('project', `Projecting volume ${volumeId} to surface ${surfaceId}`, {
      params: fullParams,
      timepoint,
    });

    eventBus.emit('projection:start', { volumeId, surfaceId });

    try {
      const result = await transport.invoke<VolToSurfProjectionResult>(
        'project_volume_to_surface',
        {
          // Tauri command args are camelCase (Rust `volume_id` -> JS `volumeId`)
          volumeId,
          surfaceId,
          pialSurfaceId,
          params: sanitizedParams,
          timepoint,
        }
      );

      debugLog('project', 'Projection complete', {
        coverage: `${result.coverage_percent.toFixed(1)}%`,
        validVertices: result.valid_vertex_count,
        range: result.data_range,
      });

      eventBus.emit('projection:complete', { volumeId, surfaceId, result });

      return result;
    } catch (error) {
      debugLog('project', 'Projection failed', error);
      eventBus.emit('projection:error', { volumeId, surfaceId, error });
      throw error;
    }
  }

  /**
   * Create a precomputed sampler for efficient 4D projection
   *
   * The sampler precomputes the spatial indices, allowing O(1) repeated
   * projections when scrubbing through a time series.
   *
   * @param surfaceId - The target surface ID
   * @param templateVolumeId - Volume defining the voxel grid
   * @param pialSurfaceId - Optional pial surface for thickness sampling
   * @param params - Projection parameters
   * @returns Sampler info with handle for future use
   */
  async createSampler(
    surfaceId: string,
    templateVolumeId: string,
    pialSurfaceId?: string,
    params?: Partial<VolToSurfProjectionParams>
  ): Promise<SamplerInfo> {
    const transport = getTransport();

    const fullParams: VolToSurfProjectionParams = {
      ...DEFAULT_PROJECTION_PARAMS,
      ...params,
    };

    debugLog('createSampler', `Creating sampler for surface ${surfaceId}`, {
      templateVolume: templateVolumeId,
      params: fullParams,
    });

    const result = await transport.invoke<SamplerInfo>('create_surface_sampler', {
      // Tauri command args are camelCase (Rust `surface_id` -> JS `surfaceId`)
      surfaceId,
      pialSurfaceId,
      templateVolumeId,
      params: fullParams,
    });

    // Cache the sampler
    this.activeSamplers.set(result.sampler_handle, result);

    debugLog('createSampler', 'Sampler created', {
      handle: result.sampler_handle,
      vertexCount: result.vertex_count,
    });

    return result;
  }

  /**
   * Apply a precomputed sampler to a volume at a specific timepoint
   *
   * @param samplerHandle - Handle from createSampler
   * @param volumeId - Volume to sample from
   * @param timepoint - Optional timepoint for 4D volumes
   * @param mappingFunction - How to combine voxel values
   * @param sigma - Bandwidth for average mapping
   * @param fill - Value for vertices with no data
   * @returns Projection result with data handle
   */
  async applySampler(
    samplerHandle: string,
    volumeId: string,
    timepoint?: number,
    mappingFunction: VolToSurfMappingFunction = 'average',
    sigma: number = 3.0,
    fill: number = 0.0
  ): Promise<VolToSurfProjectionResult> {
    const transport = getTransport();

    debugLog('applySampler', `Applying sampler ${samplerHandle} to volume ${volumeId}`, {
      timepoint,
      mappingFunction,
    });

    const result = await transport.invoke<VolToSurfProjectionResult>('apply_sampler', {
      // Tauri command args are camelCase (Rust `sampler_handle` -> JS `samplerHandle`)
      samplerHandle,
      volumeId,
      timepoint,
      mappingFunction,
      sigma,
      fill,
    });

    debugLog('applySampler', 'Sampler applied', {
      coverage: `${result.coverage_percent.toFixed(1)}%`,
      validVertices: result.valid_vertex_count,
    });

    return result;
  }

  /**
   * Release a sampler when no longer needed
   *
   * @param samplerHandle - Handle from createSampler
   */
  async releaseSampler(samplerHandle: string): Promise<void> {
    const transport = getTransport();

    debugLog('releaseSampler', `Releasing sampler ${samplerHandle}`);

    await transport.invoke('release_sampler', {
      samplerHandle,
    });

    this.activeSamplers.delete(samplerHandle);
  }

  /**
   * Get info about an active sampler
   */
  getSamplerInfo(samplerHandle: string): SamplerInfo | undefined {
    return this.activeSamplers.get(samplerHandle);
  }

  /**
   * Create a SurfaceDataLayer from a projection result
   *
   * This integrates the projected data with the existing surface overlay system.
   */
  createSurfaceDataLayer(
    result: VolToSurfProjectionResult,
    name: string,
    colormap: string = 'viridis',
    opacity: number = 1.0
  ): SurfaceDataLayer {
    const range: [number, number] = result.data_range
      ? [result.data_range.min, result.data_range.max]
      : [0, 1];

    return {
      id: `vol2surf-${Date.now()}`,
      name,
      dataHandle: result.data_handle.id,
      surfaceId: result.surface_handle.id,
      colormap,
      range,
      opacity,
    };
  }

  /**
   * Get volume data for GPU projection
   *
   * Fetches raw volume data and affine matrix needed for GPU-based projection.
   * The GPU samples the volume directly in the shader rather than pre-computing
   * per-vertex values.
   *
   * @param volumeId - The ID of the volume in the backend registry
   * @param timepoint - Optional timepoint for 4D volumes
   * @returns Volume data, dimensions, and affine matrix for GPU projection
   */
  async getVolumeForGPUProjection(
    volumeId: string,
    timepoint?: number
  ): Promise<VolumeGPUProjectionData> {
    const transport = getTransport();

    debugLog('getVolumeForGPUProjection', `Fetching volume data for ${volumeId}`, { timepoint });

    // Call backend command to get volume data for GPU projection
    const result = await transport.invoke<{
      volume_data: number[];  // Raw volume data as array
      dims: [number, number, number];
      affine_matrix: number[];  // 16 elements, column-major
      data_range: { min: number; max: number };
    }>('get_volume_for_projection', {
      // Tauri command args are camelCase (Rust `volume_id` -> JS `volumeId`)
      volumeId,
      timepoint,
    });

    debugLog('getVolumeForGPUProjection', 'Volume data received', {
      dims: result.dims,
      dataPoints: result.volume_data.length,
      range: result.data_range,
    });

    return {
      volumeData: new Float32Array(result.volume_data).buffer,
      dims: result.dims,
      affineMatrix: new Float32Array(result.affine_matrix),
      dataRange: [result.data_range.min, result.data_range.max],
    };
  }

  /**
   * Project and immediately add to surface store
   *
   * Convenience method that projects and registers the result as a display layer.
   * Supports both CPU (pre-computed per-vertex values) and GPU (volume texture sampling) paths.
   */
  async projectAndDisplay(
    volumeId: string,
    surfaceId: string,
    name: string,
    options?: {
      pialSurfaceId?: string;
      params?: Partial<VolToSurfProjectionParams>;
      timepoint?: number;
      colormap?: string;
      opacity?: number;
      /** When true, fetches volume data for GPU projection instead of CPU per-vertex values */
      useGPUProjection?: boolean;
      /** When provided, treat volume values as categorical labels and color using this LUT */
      atlasPalette?: AtlasPaletteResponse;
      atlasConfig?: AtlasConfig;
    }
  ): Promise<SurfaceDataLayer> {
    const surfaceStore = useSurfaceStore.getState();
    const colormap = options?.colormap ?? 'viridis';
    const opacity = options?.opacity ?? 1.0;

    if (options?.useGPUProjection) {
      // GPU path: Fetch volume data for GPU-based projection
      debugLog('projectAndDisplay', 'Using GPU projection path', { volumeId, surfaceId });

      if (options.atlasPalette) {
        const surface = surfaceStore.surfaces.get(surfaceId);
        const vertices = surface?.geometry?.vertices;

        // Preferred categorical path: CPU-sample the atlas volume at the surface vertices.
        // This avoids the backend CPU projection path (known to hang) while matching the
        // same voxel-to-world mapping used by the VolumeProjectionLayer GPU shader.
        if (vertices && vertices.length >= 3) {
          const t0 = Date.now();
          debugLog('projectAndDisplay', 'Building categorical RGBA overlay (CPU sampling)', {
            surfaceId,
            vertexCount: Math.floor(vertices.length / 3),
          });

          const gpuData = await this.getVolumeForGPUProjection(volumeId, options.timepoint);
          const { labels, rgba } = buildAtlasRgbaOverlay({
            vertices,
            volumeData: gpuData.volumeData,
            dims: gpuData.dims,
            affineMatrix: gpuData.affineMatrix,
            lut: options.atlasPalette.lut,
          });

          let nonzero = 0;
          for (let i = 0; i < labels.length; i++) {
            if (labels[i] !== 0) nonzero++;
          }

          debugLog('projectAndDisplay', 'Categorical overlay built', {
            ms: Date.now() - t0,
            vertices: labels.length,
            nonzero,
            maxLabel: options.atlasPalette.lut.max_label,
          });

          const layerId = `atlas-rgba-${Date.now()}`;
          surfaceStore.addDataLayer(surfaceId, {
            id: layerId,
            name,
            values: new Float32Array(0),
            colormap: 'categorical',
            range: [0, options.atlasPalette.lut.max_label],
            dataRange: [0, options.atlasPalette.lut.max_label],
            threshold: [0, 0],
            opacity,
            visible: true,
            rgba,
            labels,
            atlasConfig: options.atlasConfig,
            atlasPaletteKind: options.atlasPalette.lut.kind,
            atlasPaletteSeed: options.atlasPalette.lut.seed,
            atlasMaxLabel: options.atlasPalette.lut.max_label,
          });

          surfaceStore.setActiveSurface(surfaceId);
          surfaceStore.setSelectedItem('dataLayer', layerId);

          getEventBus().emit('surface.overlayApplied', {
            surfaceId,
            layerId,
            colormap: 'categorical',
            range: [0, options.atlasPalette.lut.max_label],
            opacity,
          });

          getEventBus().emit('ui.notification', {
            type: 'info',
            message: `Added atlas overlay '${name}'.`,
          });

          return {
            id: layerId,
            name,
            dataHandle: volumeId,
            surfaceId,
            colormap: 'categorical',
            range: [0, options.atlasPalette.lut.max_label],
            opacity,
          };
        }

        // Fallback categorical path: use backend sampler pipeline (requires no UI vertices).
        const sampler = await this.createSampler(
          surfaceId,
          volumeId,
          options.pialSurfaceId,
          options.params
        );

        let overlayHandle: string | null = null;
        try {
          const result = await this.applySampler(
            sampler.sampler_handle,
            volumeId,
            options.timepoint,
            'nearest_neighbor',
            0.0,
            0.0
          );

          overlayHandle = unwrapHandleId(result.data_handle);
          if (!overlayHandle) {
            throw new Error(`Invalid projection data_handle: ${JSON.stringify(result.data_handle)}`);
          }

          const transport = getTransport();
          const overlayData = await transport.invoke<number[]>('get_surface_overlay_data', {
            handle: overlayHandle,
          });

          const maxLabel = options.atlasPalette.lut.max_label;
          const labels = new Uint32Array(overlayData.length);
          for (let i = 0; i < overlayData.length; i++) {
            const value = overlayData[i] ?? 0;
            // Treat non-finite values as background.
            const label = Number.isFinite(value) ? Math.round(value) : 0;
            labels[i] = Math.max(0, Math.min(maxLabel, label)) >>> 0;
          }

          const lutRgb = options.atlasPalette.lut.lut_rgb;
          const rgba = new Float32Array(labels.length * 4);
          let nonzero = 0;
          for (let i = 0; i < labels.length; i++) {
            const label = labels[i] ?? 0;
            const off = i * 4;
            if (label === 0) {
              rgba[off] = 0;
              rgba[off + 1] = 0;
              rgba[off + 2] = 0;
              rgba[off + 3] = 0;
              continue;
            }
            nonzero++;
            const lutOff = label * 3;
            rgba[off] = (lutRgb[lutOff] ?? 0) / 255;
            rgba[off + 1] = (lutRgb[lutOff + 1] ?? 0) / 255;
            rgba[off + 2] = (lutRgb[lutOff + 2] ?? 0) / 255;
            rgba[off + 3] = 1;
          }

          debugLog('projectAndDisplay', 'Atlas overlay label stats', {
            vertices: labels.length,
            nonzero,
            coverage: result.coverage_percent,
          });

          const layerId = `atlas-rgba-${Date.now()}`;
          surfaceStore.addDataLayer(surfaceId, {
            id: layerId,
            name,
            values: new Float32Array(0),
            colormap: 'categorical',
            range: [0, options.atlasPalette.lut.max_label],
            dataRange: [0, options.atlasPalette.lut.max_label],
            threshold: [0, 0],
            opacity,
            visible: true,
            rgba,
            labels,
            atlasConfig: options.atlasConfig,
            atlasPaletteKind: options.atlasPalette.lut.kind,
            atlasPaletteSeed: options.atlasPalette.lut.seed,
            atlasMaxLabel: options.atlasPalette.lut.max_label,
          });

          surfaceStore.setActiveSurface(surfaceId);
          surfaceStore.setSelectedItem('dataLayer', layerId);

          debugLog('projectAndDisplay', 'Atlas RGBA layer added', {
            layerId,
            surfaceId,
            maxLabel: options.atlasPalette.lut.max_label,
          });

          getEventBus().emit('ui.notification', {
            type: 'info',
            message: `Added atlas overlay '${name}'.`,
          });

          return {
            id: layerId,
            name,
            dataHandle: overlayHandle ?? volumeId,
            surfaceId,
            colormap: 'categorical',
            range: [0, options.atlasPalette.lut.max_label],
            opacity,
          };
        } finally {
          // Free sampler resources for one-shot projections.
          try {
            await this.releaseSampler(sampler.sampler_handle);
          } catch (e) {
            debugLog('projectAndDisplay', 'Failed to release sampler (non-fatal)', e);
          }
        }
      }

      const gpuData = await this.getVolumeForGPUProjection(volumeId, options.timepoint);

      const layer: SurfaceDataLayer = {
        id: `vol2surf-gpu-${Date.now()}`,
        name,
        dataHandle: volumeId,  // Use volume ID as data handle for reference
        surfaceId,
        colormap,
        range: gpuData.dataRange,
        opacity,
        // GPU projection fields
        volumeData: gpuData.volumeData,
        volumeDims: gpuData.dims,
        affineMatrix: gpuData.affineMatrix,
        volumeId,
      };

      // Add to surface store with GPU projection data
      surfaceStore.addDataLayer(surfaceId, {
        id: layer.id,
        name: layer.name,
        values: new Float32Array(0),  // Empty for GPU path
        visible: true,
        colormap: layer.colormap,
        range: layer.range,
        dataRange: layer.range,
        opacity: layer.opacity,
        // GPU projection fields
        volumeData: layer.volumeData,
        volumeDims: layer.volumeDims,
        affineMatrix: layer.affineMatrix,
        volumeId: layer.volumeId,
      });

      // Ensure the canvas uses the GPU compositing pipeline for VolumeProjectionLayer.
      surfaceStore.updateRenderSettings({ useGPUProjection: true });

      // Make the new layer immediately visible in the UI.
      surfaceStore.setActiveSurface(surfaceId);
      surfaceStore.setSelectedItem('dataLayer', layer.id);

      debugLog('projectAndDisplay', 'GPU projection layer added', {
        layerId: layer.id,
        surfaceId,
        dims: gpuData.dims,
      });

      getEventBus().emit('ui.notification', {
        type: 'info',
        message: `Added surface layer '${name}'.`,
      });

      return layer;
    }

    // CPU path: Compute per-vertex values on backend
    const result = await this.projectVolumeToSurface(
      volumeId,
      surfaceId,
      options?.pialSurfaceId,
      options?.params,
      options?.timepoint
    );

    // Fetch the computed per-vertex values from the backend overlay registry.
    const transport = getTransport();
    const dataHandleId = unwrapHandleId(result.data_handle);
    if (!dataHandleId) {
      throw new Error(`Invalid projection data_handle: ${JSON.stringify(result.data_handle)}`);
    }

    const overlayData = await transport.invoke<number[]>('get_surface_overlay_data', {
      handle: dataHandleId,
    });

    const values = new Float32Array(overlayData);
    const surface = surfaceStore.surfaces.get(surfaceId);
    const expectedVertices =
      (surface?.geometry?.vertices?.length ?? 0) > 0
        ? (surface!.geometry.vertices.length / 3)
        : surface?.metadata?.vertexCount ?? 0;

    if (expectedVertices > 0 && values.length !== expectedVertices) {
      throw new Error(
        `Projected overlay vertex count ${values.length} does not match surface geometry (${expectedVertices}).`
      );
    }

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }

    const range: [number, number] = [min, max];
    const threshold: [number, number] = [0, 0]; // show all by default

    const layerId = `vol2surf-${Date.now()}`;
    surfaceStore.addDataLayer(surfaceId, {
      id: layerId,
      name,
      values,
      colormap,
      range,
      dataRange: range,
      threshold,
      opacity,
      visible: true,
    });

    // Make the new layer immediately visible in the UI (SurfaceControlPanel relies on selection state).
    surfaceStore.setActiveSurface(surfaceId);
    surfaceStore.setSelectedItem('dataLayer', layerId);

    debugLog('projectAndDisplay', 'Added layer to surface store', {
      surfaceId,
      layerId,
      points: values.length,
      range,
    });

    getEventBus().emit('ui.notification', {
      type: 'info',
      message: `Added surface layer '${name}'.`,
    });

    // Nudge any listeners that rely on explicit overlay events.
    getEventBus().emit('surface.overlayApplied', {
      surfaceId,
      layerId,
      dataHandle: dataHandleId,
      colormap,
      range,
      opacity,
    });

    debugLog('projectAndDisplay', 'CPU projection layer added', {
      layerId,
      surfaceId,
    });

    return {
      id: layerId,
      name,
      dataHandle: dataHandleId,
      surfaceId,
      colormap,
      range,
      opacity,
    };
  }

  /**
   * Get all active samplers
   */
  getActiveSamplers(): Map<string, SamplerInfo> {
    return new Map(this.activeSamplers);
  }

  /**
   * Release all active samplers
   */
  async releaseAllSamplers(): Promise<void> {
    const handles = Array.from(this.activeSamplers.keys());
    await Promise.all(handles.map((handle) => this.releaseSampler(handle)));
  }
}

// Export singleton getter
export function getVolumeSurfaceProjectionService(): VolumeSurfaceProjectionService {
  return VolumeSurfaceProjectionService.getInstance();
}
