/**
 * Deterministic backend model for the full-app harness.
 *
 * Response shapes follow the Rust command signatures in
 * core/api_bridge/src/lib.rs and the generated bindings in
 * packages/api/src/generated. IDs come from counters, never clocks/RNG.
 */
import type { HarnessFixtures, VolumeFixture } from './fixtures';
import type { Handler } from './harnessTransport';
import {
  flatRowMajor,
  fullExtent,
  invertAffine,
  volumeBounds,
  volumeCenter,
  type Orientation,
  type Vec3,
} from './geometry';
import { renderSlice, type SliceFrame, type SliceLayer } from './slicer';
import { ANALYSIS_DESCRIPTORS, BIDS_EVENTS, BIDS_ROOT, BIDS_SUMMARY, completedJob } from './scenarioData';

/** Paths the harness "file system" serves. */
export const HARNESS_ROOT = '/harness/study';
export const MNI_PATH = `${HARNESS_ROOT}/anat/MNI152_T1_2mm_brain.nii.gz`;
export const STATS_PATH = `${HARNESS_ROOT}/stats/task-motor_zstat1.nii.gz`;
export const SURFACE_PATH = `${HARNESS_ROOT}/surf/lh.inflated.gii`;
export const SURFACE_OVERLAY_PATH = `${HARNESS_ROOT}/surf/lh.sensorimotor.func.gii`;

interface VolumeEntry {
  id: string;
  name: string;
  path: string;
  fixture: VolumeFixture;
  worldToVoxel: number[][];
}

interface LayerEntry {
  layerId: string;
  volumeId: string;
}

export interface HarnessBackend {
  handlers: Record<string, Handler>;
  volumes: Map<string, VolumeEntry>;
  layers: Map<string, LayerEntry>;
  /** Add or override a handler (scenario-specific responses). */
  setHandler(cmd: string, handler: Handler): void;
}

/** Virtual directory tree served by `fs_list_directory`. */
const VIRTUAL_FS: Record<string, Array<{ name: string; isDir: boolean }>> = {
  [HARNESS_ROOT]: [
    { name: 'anat', isDir: true },
    { name: 'stats', isDir: true },
    { name: 'surf', isDir: true },
    { name: 'dataset_description.json', isDir: false },
  ],
  [BIDS_ROOT]: [
    { name: 'sub-01', isDir: true },
    { name: 'sub-02', isDir: true },
    { name: 'sub-03', isDir: true },
    { name: 'dataset_description.json', isDir: false },
    { name: 'participants.tsv', isDir: false },
  ],
  [`${HARNESS_ROOT}/anat`]: [
    { name: 'MNI152_T1_2mm_brain.nii.gz', isDir: false },
    { name: 'MNI152_T1_2mm_brain_mask.nii.gz', isDir: false },
  ],
  [`${HARNESS_ROOT}/stats`]: [
    { name: 'task-motor_zstat1.nii.gz', isDir: false },
    { name: 'task-motor_cope1.nii.gz', isDir: false },
  ],
  [`${HARNESS_ROOT}/surf`]: [
    { name: 'lh.inflated.gii', isDir: false },
    { name: 'lh.sensorimotor.func.gii', isDir: false },
  ],
};

const VIEW_CODES: Record<string, number> = { axial: 0, sagittal: 1, coronal: 2 };

function stats(data: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (const v of data) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sum2 += v * v;
    n += 1;
  }
  const mean = n ? sum / n : 0;
  return { min, max, mean, std: n ? Math.sqrt(Math.max(sum2 / n - mean * mean, 0)) : 0, n };
}

function vec3(v: unknown): Vec3 {
  const a = (v as number[]) ?? [0, 0, 0];
  return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0];
}

export function createBackend(fixtures: HarnessFixtures): HarnessBackend {
  const volumes = new Map<string, VolumeEntry>();
  const layers = new Map<string, LayerEntry>();
  let volumeCounter = 0;
  let surfaceCounter = 0;
  let overlayCounter = 0;
  const surfaces = new Map<string, string>();
  let jobCounter = 0;
  const jobs = new Map<string, string>();

  const fixtureForPath = (path: string): VolumeFixture | null => {
    if (path === MNI_PATH) return fixtures.mni;
    if (path === STATS_PATH) return fixtures.stats;
    return null;
  };

  const registerVolume = (path: string, name: string, fixture: VolumeFixture) => {
    volumeCounter += 1;
    const id = `vol-${volumeCounter}`;
    volumes.set(id, { id, name, path, fixture, worldToVoxel: invertAffine(fixture.affine) });
    return {
      id,
      name,
      dims: [...fixture.dims],
      dtype: 'f32',
      volume_type: 'Volume3D',
      num_timepoints: null,
      current_timepoint: null,
      time_series_info: null,
    };
  };

  const volumeFor = (volumeId: string): VolumeEntry => {
    const entry = volumes.get(volumeId);
    if (!entry) throw new Error(`Volume '${volumeId}' not found`);
    return entry;
  };

  const volumeForLayer = (layerId: string): VolumeEntry => {
    const layer = layers.get(layerId);
    if (layer) return volumeFor(layer.volumeId);
    // Some callers pass the volume id directly.
    return volumeFor(layerId);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toSliceLayers = (payloadLayers: any[]): SliceLayer[] =>
    (payloadLayers ?? [])
      .filter((l) => l && l.visible !== false && (l.opacity ?? 1) > 0)
      .flatMap((l) => {
        const vol = volumes.get(l.volumeId ?? l.volume_id);
        if (!vol) return [];
        const intensity = (l.intensity ?? l.intensity_window ?? vol.fixture.range) as [
          number,
          number,
        ];
        const thresholdRaw = l.threshold;
        const threshold: [number, number] = Array.isArray(thresholdRaw)
          ? [Number(thresholdRaw[0]), Number(thresholdRaw[1])]
          : thresholdRaw && Array.isArray(thresholdRaw.range)
            ? [Number(thresholdRaw.range[0]), Number(thresholdRaw.range[1])]
            : [0, 0];
        const blendRaw = String(l.blendMode ?? l.blend_mode ?? 'alpha').toLowerCase();
        const blend: SliceLayer['blend'] = blendRaw.startsWith('add')
          ? 'additive'
          : blendRaw.startsWith('max')
            ? 'max'
            : blendRaw.startsWith('min')
              ? 'min'
              : 'alpha';
        const mode = String(l.layerMode ?? l.layer_mode ?? 'scalar');
        return [
          {
            data: vol.fixture.data,
            dims: vol.fixture.dims,
            worldToVoxel: vol.worldToVoxel,
            colormap: typeof l.colormap === 'string' ? l.colormap : 'gray',
            intensity: [Number(intensity[0]), Number(intensity[1])],
            threshold,
            opacity: Number(l.opacity ?? 1),
            nearest: l.interpolation === 'nearest' || mode !== 'scalar',
            blend,
          },
        ];
      });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderRequested = (state: any, view: any): Uint8Array => {
    const crosshair = state.crosshair;
    const color = (crosshair?.color as number[] | undefined) ?? [1, 0.8, 0.2, 0.8];
    const frame: SliceFrame = {
      origin: vec3(view.origin_mm),
      U: vec3(view.u_mm),
      V: vec3(view.v_mm),
      width: Number(view.width),
      height: Number(view.height),
      crosshair:
        crosshair && crosshair.visible
          ? {
              world: vec3(crosshair.world_mm),
              color: [color[0], color[1], color[2], color[3] ?? 1] as [
                number,
                number,
                number,
                number,
              ],
            }
          : null,
    };
    return renderSlice(frame, toSliceLayers(state.layers));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defaultRequestedView = (state: any) => {
    const axial = state?.views?.axial;
    if (!axial) throw new Error('render payload has neither requestedView nor views.axial');
    return {
      type: 'axial',
      origin_mm: axial.origin_mm,
      u_mm: axial.u_mm,
      v_mm: axial.v_mm,
      width: 512,
      height: 512,
    };
  };

  const handlers: Record<string, Handler> = {
    init_render_loop: () => null,
    fs_list_directory: ({ path }: { path: string }) => {
      const key = path.replace(/\/+$/, '');
      const entries = VIRTUAL_FS[key] ?? [];
      return {
        nodes: entries.map((e) => ({
          id: `${key}/${e.name}`,
          name: e.name,
          isDir: e.isDir,
          parentIdx: null,
          iconId: e.isDir ? 1 : 2,
        })),
      };
    },
    get_atlas_stats: () => ({
      total_layers: 16,
      used_layers: layers.size,
      free_layers: 16 - layers.size,
      allocations: layers.size,
      releases: 0,
      high_watermark: layers.size,
      full_events: 0,
      is_3d: true,
      last_allocation_ms: null,
      last_release_ms: null,
    }),

    load_file: ({ path }: { path: string }) => {
      const fixture = fixtureForPath(path);
      if (!fixture) throw new Error(`harness: no fixture for path ${path}`);
      return registerVolume(path, path.split('/').pop() ?? path, fixture);
    },
    load_template_by_id: ({ templateId }: { templateId: string }) => {
      const info = registerVolume(`template:${templateId}`, `${templateId}.nii.gz`, fixtures.mni);
      return {
        template_id: templateId,
        template_metadata: {
          id: templateId,
          name: templateId,
          description: 'MNI152 NLin2009cAsym (harness fixture, 2 mm)',
          resolution: '2mm',
          template_type: 'T1w',
        },
        volume_handle_info: info,
      };
    },
    unload_volume: ({ volumeId }: { volumeId: string }) => {
      volumes.delete(volumeId);
      return { success: true, message: 'unloaded' };
    },
    get_volume_bounds: ({ volumeId }: { volumeId: string }) =>
      volumeBounds(volumeFor(volumeId).fixture),
    get_initial_views: ({ volumeId, maxPx }: { volumeId: string; maxPx: [number, number] }) => {
      const vol = volumeFor(volumeId).fixture;
      const cross = volumeCenter(vol);
      const out: Record<string, unknown> = {};
      for (const o of ['axial', 'sagittal', 'coronal'] as Orientation[]) {
        out[o] = fullExtent(vol, o, cross, maxPx);
      }
      return out;
    },
    recalculate_view_for_dimensions: (args: {
      volumeId: string;
      viewType: Orientation;
      dimensions: [number, number];
      crosshairMm: Vec3;
    }) =>
      fullExtent(
        volumeFor(args.volumeId).fixture,
        args.viewType,
        args.crosshairMm,
        args.dimensions,
      ),
    recalculate_all_views: (args: {
      volumeId: string;
      dimensionsByView: Record<Orientation, [number, number]>;
      crosshairMm: Vec3;
    }) => {
      const vol = volumeFor(args.volumeId).fixture;
      const out: Record<string, unknown> = {};
      for (const o of ['axial', 'sagittal', 'coronal'] as Orientation[]) {
        out[o] = fullExtent(vol, o, args.crosshairMm, args.dimensionsByView[o]);
      }
      return out;
    },
    query_slice_axis_meta: ({ volumeId, axis }: { volumeId: string; axis: Orientation }) => {
      const vol = volumeFor(volumeId).fixture;
      const a = axis === 'sagittal' ? 0 : axis === 'coronal' ? 1 : 2;
      const spacing = Math.hypot(vol.affine[0][a], vol.affine[1][a], vol.affine[2][a]);
      return {
        slice_count: vol.dims[a],
        slice_spacing: spacing,
        axis_length_mm: spacing * vol.dims[a],
      };
    },
    get_nifti_header_info: ({ volumeId }: { volumeId: string }) => {
      const vol = volumeFor(volumeId);
      const b = volumeBounds(vol.fixture);
      const s = stats(vol.fixture.data);
      return {
        filename: vol.name,
        dimensions: [...vol.fixture.dims],
        voxel_spacing: [2, 2, 2],
        data_type: 'FLOAT32',
        voxel_to_world: flatRowMajor(vol.fixture.affine),
        world_bounds_min: b.min,
        world_bounds_max: b.max,
        sform_code: 4,
        qform_code: 4,
        orientation_string: 'RAS',
        spatial_units: 'mm',
        temporal_units: null,
        tr_seconds: null,
        num_timepoints: null,
        description: 'Brainflow harness fixture',
        data_range: { min: s.min, max: s.max },
      };
    },
    get_volume_timepoint: () => 0,
    set_volume_timepoint: () => null,

    request_layer_gpu_resources: ({
      layerSpec,
    }: {
      layerSpec: { Volume: { id: string; source_resource_id: string } };
    }) => {
      const spec = layerSpec.Volume;
      const vol = volumeFor(spec.source_resource_id);
      layers.set(spec.id, { layerId: spec.id, volumeId: vol.id });
      const s = stats(vol.fixture.data);
      const center = volumeCenter(vol.fixture);
      const [nx, ny, nz] = vol.fixture.dims;
      return {
        layer_id: spec.id,
        world_to_voxel: flatRowMajor(vol.worldToVoxel),
        dim: [nx, ny, nz],
        pad_slices: 1,
        tex_format: 'R32Float',
        atlas_layer_index: layers.size - 1,
        slice_info: {
          axis: 2,
          index: Math.floor(nz / 2),
          axis_name: 'Axial',
          dimensions: [nx, ny],
        },
        texture_coords: { u_min: 0, v_min: 0, u_max: 1, v_max: 1 },
        voxel_to_world: flatRowMajor(vol.fixture.affine),
        origin: [vol.fixture.affine[0][3], vol.fixture.affine[1][3], vol.fixture.affine[2][3]],
        center_world: center,
        spacing: [2, 2, 2],
        data_range: { min: s.min, max: s.max },
        source_volume_id: vol.id,
        allocated_at: 0,
        is_binary_like: false,
      };
    },
    wait_for_layer_ready: () => true,
    patch_layer: () => null,
    release_layer_gpu_resources: ({ layerId }: { layerId: string }) => {
      layers.delete(layerId);
      return { success: true, message: 'released' };
    },
    add_render_layer: () => null,
    update_slice_outline: () => null,

    sample_world_coordinate: ({ worldCoord }: { worldCoord: Vec3 }) => ({
      value: 0,
      coordinate: worldCoord,
    }),
    sample_layer_value_at_world: () => 0,

    compute_layer_histogram: (args: {
      layerId: string;
      binCount?: number;
      range?: [number, number];
      excludeZeros?: boolean;
    }) => {
      const vol = volumeForLayer(args.layerId).fixture;
      const s = stats(vol.data);
      const binCount = args.binCount ?? 256;
      const lo = args.range ? args.range[0] : s.min;
      const hi = args.range ? args.range[1] : s.max;
      const width = (hi - lo) / binCount || 1;
      const counts = new Array<number>(binCount).fill(0);
      let total = 0;
      for (const v of vol.data) {
        if (args.excludeZeros && v === 0) continue;
        if (v < lo || v > hi) continue;
        const b = Math.min(Math.floor((v - lo) / width), binCount - 1);
        counts[b] += 1;
        total += 1;
      }
      return {
        bins: counts.map((count, i) => ({ x0: lo + i * width, x1: lo + (i + 1) * width, count })),
        total_count: total,
        min_value: s.min,
        max_value: s.max,
        mean: s.mean,
        std: s.std,
        bin_count: binCount,
      };
    },

    load_surface: ({ path }: { path: string }) => {
      if (path !== SURFACE_PATH) throw new Error(`harness: no surface fixture for ${path}`);
      surfaceCounter += 1;
      const handle = `surf-${surfaceCounter}`;
      surfaces.set(handle, path);
      return {
        type: 'Surface',
        handle,
        vertex_count: fixtures.surface.vertices.length / 3,
        face_count: fixtures.surface.faces.length / 3,
        hemisphere: 'left',
        surface_type: 'inflated',
      };
    },
    get_surface_geometry: ({ handle }: { handle: string }) => {
      if (!surfaces.has(handle)) throw new Error(`Surface '${handle}' not found`);
      return { vertices: fixtures.surface.vertices, faces: fixtures.surface.faces };
    },
    unload_surface: ({ handle }: { handle: string }) => {
      surfaces.delete(handle);
      return { success: true, message: 'unloaded' };
    },
    load_surface_overlay: ({ path, targetSurfaceId }: { path: string; targetSurfaceId: string }) => {
      if (path !== SURFACE_OVERLAY_PATH) throw new Error(`harness: no overlay fixture for ${path}`);
      overlayCounter += 1;
      return {
        type: 'SurfaceData',
        handle: `overlay_${targetSurfaceId}_sensorimotor_${overlayCounter}`,
        data_count: fixtures.surface.overlay.length,
        intent: 'functional',
      };
    },
    get_surface_overlay_data: () => Array.from(fixtures.surface.overlay),
    unload_surface_overlay: () => ({ success: true, message: 'unloaded' }),

    list_analyses: () => ANALYSIS_DESCRIPTORS,
    start_analysis: ({ request }: { request: { analysis_id: string } }) => {
      jobCounter += 1;
      const jobId = `job-${jobCounter}`;
      jobs.set(jobId, request.analysis_id);
      return jobId;
    },
    get_analysis_job_status: ({ jobId }: { jobId: string }) => {
      const analysisId = jobs.get(jobId);
      return analysisId ? completedJob(jobId, analysisId) : null;
    },
    cancel_analysis: () => false,

    check_bids_directory: ({ path }: { path: string }) => path === BIDS_SUMMARY.path,
    scan_bids_dataset: ({ datasetPath }: { datasetPath: string }) => {
      if (datasetPath !== BIDS_SUMMARY.path) throw new Error(`Not a BIDS dataset: ${datasetPath}`);
      return BIDS_SUMMARY;
    },
    get_bids_events: () => BIDS_EVENTS,

    render_view: ({ stateJson }: { stateJson: string }) => {
      const state = JSON.parse(stateJson);
      const view = state.requestedView ?? defaultRequestedView(state);
      const rgba = renderRequested(state, view);
      const packet = new Uint8Array(8 + rgba.length);
      const dv = new DataView(packet.buffer);
      dv.setUint32(0, Number(view.width), true);
      dv.setUint32(4, Number(view.height), true);
      packet.set(rgba, 8);
      return packet;
    },
    render_views: ({ stateJson }: { stateJson: string }) => {
      const state = JSON.parse(stateJson);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const views: any[] = state.requestedViews ?? [];
      const payloads = views.map((view) => ({ view, rgba: renderRequested(state, view) }));
      const total = 4 + payloads.length * 13 + payloads.reduce((s, p) => s + p.rgba.length, 0);
      const buffer = new Uint8Array(total);
      const dv = new DataView(buffer.buffer);
      dv.setUint32(0, payloads.length, true);
      let offset = 4;
      for (const { view, rgba } of payloads) {
        buffer[offset] = VIEW_CODES[view.type] ?? 0;
        dv.setUint32(offset + 1, Number(view.width), true);
        dv.setUint32(offset + 5, Number(view.height), true);
        dv.setUint32(offset + 9, rgba.length, true);
        offset += 13;
      }
      for (const { rgba } of payloads) {
        buffer.set(rgba, offset);
        offset += rgba.length;
      }
      return buffer;
    },
    submit_view: ({ stateJson }: { stateJson: string }) => {
      const state = JSON.parse(stateJson);
      const view = state.requestedView ?? { type: 'axial', width: 512, height: 512 };
      const visible = (state.layers ?? []).filter(
        (l: { visible?: boolean }) => l.visible !== false,
      ).length;
      return {
        requested_view: view.type,
        format: 'rgba',
        parse_ms: 0,
        service_lock_ms: 0,
        target_setup_ms: 0,
        layer_processing_ms: 0,
        render_loop_ms: 0,
        encode_ms: 0,
        total_ms: 0,
        visible_layer_count: visible,
        output_bytes: 0,
        output_dimensions: [view.width, view.height],
        warnings: [],
        frame: {
          prepare_ms: 0,
          render_ms: 0,
          readback_ms: 0,
          total_ms: 0,
          visible_layers: visible,
          updated_layer_slots: visible,
          reused_layer_state: false,
          readback_mode: 'skip',
        },
      };
    },
    batch_render_slices: ({
      batchRequest,
    }: {
      batchRequest: { view_states_json: string; width_per_slice: number; height_per_slice: number };
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const states: any[] = JSON.parse(batchRequest.view_states_json);
      const W = batchRequest.width_per_slice;
      const H = batchRequest.height_per_slice;
      const out = new Uint8Array(12 + states.length * W * H * 4);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, W, true);
      dv.setUint32(4, H, true);
      dv.setUint32(8, states.length, true);
      states.forEach((st, i) => {
        const frame: SliceFrame = {
          origin: vec3(st.camera.frame_origin),
          U: vec3(st.camera.frame_u_vec),
          V: vec3(st.camera.frame_v_vec),
          width: W,
          height: H,
          crosshair: null,
        };
        out.set(renderSlice(frame, toSliceLayers(st.layers)), 12 + i * W * H * 4);
      });
      return out.buffer;
    },
  };

  return {
    handlers,
    volumes,
    layers,
    setHandler(cmd, handler) {
      handlers[cmd] = handler;
    },
  };
}
