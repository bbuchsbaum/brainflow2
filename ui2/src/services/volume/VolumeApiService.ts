import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import type { WorldCoordinates, ViewPlane, ViewType } from '@/types/coordinates';
import type { VolumeBounds } from '@brainflow/api';

export interface VolumeHandle {
  id: string;
  name: string;
  dims: [number, number, number];
  dtype: string;
}

export interface SampleResult {
  value: number;
  coordinate: WorldCoordinates;
}

export interface NiftiHeaderInfo {
  filename: string;
  dimensions: number[];
  voxel_spacing: [number, number, number];
  data_type: string;
  voxel_to_world: number[]; // [f32; 16] row-major
  world_bounds_min: [number, number, number];
  world_bounds_max: [number, number, number];
  sform_code: number;
  qform_code: number;
  orientation_string: string;
  spatial_units: string;
  temporal_units: string | null;
  tr_seconds: number | null;
  num_timepoints: number | null;
  description: string;
  data_range: { min: number; max: number } | null;
}

export class VolumeApiService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async loadFile(path: string): Promise<VolumeHandle> {
    return this.transport.invoke<VolumeHandle>('load_file', { path });
  }

  async getVolumeBounds(volumeId: string): Promise<VolumeBounds> {
    return this.transport.invoke<VolumeBounds>('get_volume_bounds', { volumeId });
  }

  async getNiftiHeaderInfo(volumeId: string): Promise<NiftiHeaderInfo> {
    return this.transport.invoke<NiftiHeaderInfo>('get_nifti_header_info', { volumeId });
  }

  async getInitialViews(volumeId: string, maxPx: [number, number]): Promise<Record<string, ViewPlane>> {
    const result = await this.transport.invoke<Record<string, any>>('get_initial_views', {
      volumeId,
      maxPx
    });

    const views: Record<string, ViewPlane> = {};
    for (const [orientation, viewRect] of Object.entries(result)) {
      views[orientation] = {
        origin_mm: viewRect.origin_mm,
        u_mm: viewRect.u_mm,
        v_mm: viewRect.v_mm,
        dim_px: [viewRect.width_px, viewRect.height_px]
      };
    }
    return views;
  }

  async recalculateViewForDimensions(
    volumeId: string,
    viewType: 'axial' | 'sagittal' | 'coronal',
    dimensions: [number, number],
    crosshairMm: [number, number, number]
  ): Promise<ViewPlane> {
    console.log(`[VolumeApiService] recalculateViewForDimensions called:`, {
      volumeId,
      viewType,
      requestedDimensions: dimensions,
      crosshairMm,
      timestamp: performance.now()
    });

    const startTime = performance.now();

    const request = {
      volumeId,
      viewType,
      dimensions: [dimensions[0], dimensions[1]],
      crosshairMm: [crosshairMm[0], crosshairMm[1], crosshairMm[2]]
    };
    console.log(`[VolumeApiService] Sending to backend:`, JSON.stringify(request, null, 2));

    const result = await this.transport.invoke<any>('recalculate_view_for_dimensions', request);

    console.log(`[VolumeApiService] Backend response received after ${(performance.now() - startTime).toFixed(1)}ms:`, {
      raw: result,
      hasOrigin: !!result.origin_mm,
      hasU: !!result.u_mm,
      hasV: !!result.v_mm,
      backendDimensions: result.width_px ? [result.width_px, result.height_px] : 'undefined'
    });

    console.log(`[VolumeApiService] Backend ViewRectMm details:`, {
      origin_mm: result.origin_mm,
      u_mm: result.u_mm,
      v_mm: result.v_mm,
      width_px: result.width_px,
      height_px: result.height_px,
      pixelSizes: {
        u: result.u_mm ? Math.hypot(...result.u_mm) : 'undefined',
        v: result.v_mm ? Math.hypot(...result.v_mm) : 'undefined'
      }
    });

    const viewPlane = {
      origin_mm: result.origin_mm,
      u_mm: result.u_mm,
      v_mm: result.v_mm,
      dim_px: [result.width_px, result.height_px] as [number, number]
    };

    console.log(`[VolumeApiService] ⚠️ DIMENSION CHECK:`, {
      requested: dimensions,
      backendReturned: [result.width_px, result.height_px],
      usingBackendDims: true,
      match: dimensions[0] === result.width_px && dimensions[1] === result.height_px
    });

    if (dimensions[0] !== result.width_px || dimensions[1] !== result.height_px) {
      console.info(`[VolumeApiService] 📐 Backend dimension adjustment: ${dimensions.join('×')} → ${result.width_px}×${result.height_px}`, {
        requestedDimensions: dimensions,
        actualDimensions: [result.width_px, result.height_px],
        reason: 'aspect ratio preservation and square pixel requirements',
        impactOnRendering: 'Using backend dimensions - this is expected medical imaging behavior',
        medicalImagingNote: 'Square pixels preserve anatomical proportions'
      });
    }

    console.log(`[VolumeApiService] Returning ViewPlane:`, viewPlane);

    return viewPlane;
  }

  async recalculateAllViews(
    volumeId: string,
    dimensionsByView: Record<ViewType, [number, number]>,
    crosshairMm: [number, number, number]
  ): Promise<Record<ViewType, ViewPlane>> {
    console.log('[VolumeApiService] recalculateAllViews called:', {
      volumeId,
      dimensionsByView,
      crosshairMm
    });

    const response = await this.transport.invoke<Record<string, any>>(
      'recalculate_all_views',
      {
        volumeId,
        dimensionsByView,
        crosshairMm
      }
    );

    const result: Partial<Record<ViewType, ViewPlane>> = {};
    (['axial', 'sagittal', 'coronal'] as ViewType[]).forEach((vt) => {
      const backendView = response?.[vt];
      if (backendView) {
        result[vt] = {
          origin_mm: backendView.origin_mm,
          u_mm: backendView.u_mm,
          v_mm: backendView.v_mm,
          dim_px: [backendView.width_px, backendView.height_px]
        } as ViewPlane;
      }
    });

    return result as Record<ViewType, ViewPlane>;
  }

  async sampleWorldCoordinate(worldCoord: WorldCoordinates): Promise<SampleResult> {
    return this.transport.invoke<SampleResult>(
      'sample_world_coordinate',
      { worldCoord }
    );
  }

  async setVolumeTimepoint(volumeId: string, timepoint: number): Promise<void> {
    await this.transport.invoke('set_volume_timepoint', {
      volumeId,
      timepoint
    });
  }

  async getVolumeTimepoint(volumeId: string): Promise<number | null> {
    const result = await this.transport.invoke<number | null>(
      'get_volume_timepoint',
      { volumeId }
    );
    return result === undefined ? null : result;
  }

  async querySliceAxisMeta(
    volumeId: string,
    axis: 'axial' | 'sagittal' | 'coronal'
  ): Promise<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  }> {
    console.log('[VolumeApiService] Querying slice metadata:', { volumeId, axis });
    const result = await this.transport.invoke<{
      slice_count: number;
      slice_spacing: number;
      axis_length_mm: number;
    }>('query_slice_axis_meta', {
      volumeId,
      axis
    });

    console.log('[VolumeApiService] Slice metadata result:', result);

    return {
      sliceCount: result.slice_count,
      sliceSpacing: result.slice_spacing,
      axisLength: result.axis_length_mm
    };
  }
}

let instance: VolumeApiService | null = null;

export function getVolumeApiService(): VolumeApiService {
  if (!instance) {
    instance = new VolumeApiService();
  }
  return instance;
}
