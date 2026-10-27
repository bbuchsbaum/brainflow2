/**
 * Deterministic backend model for the full-app harness.
 *
 * Response shapes follow the Rust command signatures in
 * core/api_bridge/src/lib.rs and the generated bindings in
 * packages/api/src/generated. IDs come from counters, never clocks/RNG.
 */
import type { ExtremumKind, StatisticInfo, StatisticKind } from '@brainflow/api';
import { findClusters, findExtremum, nonzeroBbox, type ClusterQuery } from './volumeQueries';

interface QueryTarget {
  volumeId?: string | null;
  layerId?: string | null;
}
import type { HarnessFixtures, VolumeFixture } from './fixtures';
import { rawBody, rawHeader, type Handler, type InvokeOptions } from './harnessTransport';
import {
  flatColumnMajor,
  flatRowMajor,
  fullExtent,
  invertAffine,
  volumeBounds,
  volumeCenter,
  type Orientation,
  type Vec3,
} from './geometry';
import { renderSlice, type SliceFrame, type SliceLayer } from './slicer';
import { noteStep } from './harnessLog';
import {
  ANALYSIS_DESCRIPTORS,
  BIDS_EVENTS,
  BIDS_ROOT,
  BIDS_SUMMARY,
  completedJob,
  REMOTE_MOUNT_OFFLINE_ERROR,
  REMOTE_MOUNT_PROFILES,
} from './scenarioData';

/** Paths the harness "file system" serves. */
export const HARNESS_ROOT = '/harness/study';
export const MNI_PATH = `${HARNESS_ROOT}/anat/MNI152_T1_2mm_brain.nii.gz`;
export const STATS_PATH = `${HARNESS_ROOT}/stats/task-motor_zstat1.nii.gz`;
export const SURFACE_PATH = `${HARNESS_ROOT}/surf/lh.inflated.gii`;
export const SURFACE_OVERLAY_PATH = `${HARNESS_ROOT}/surf/lh.sensorimotor.func.gii`;
/** Phase 3 synthetic statistics (fixtures/app/p3_fixtures.json). Listed under stats/, which
 * the gate scenarios never expand, so the gate baselines do not see them. */
export const ZMAP_PATH = `${HARNESS_ROOT}/stats/zmap_synthetic.nii.gz`;
export const TMAP_PATH = `${HARNESS_ROOT}/stats/tmap_synthetic_df24.nii.gz`;
/** Native-like noisy copies (v6), loadable by path; not listed in the tree. */
export const ZMAP_NOISY_PATH = `${HARNESS_ROOT}/stats/zmap_native_noise.nii.gz`;
export const TMAP_NOISY_PATH = `${HARNESS_ROOT}/stats/tmap_native_noise_df24.nii.gz`;
export const ATLAS_PATH = `${HARNESS_ROOT}/stats/atlas-synth3_dseg.nii.gz`;
export const ATLAS_LUT_PATH = `${HARNESS_ROOT}/stats/atlas-synth3_dseg.tsv`;

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
    { name: 'zmap_synthetic.nii.gz', isDir: false },
    { name: 'tmap_synthetic_df24.nii.gz', isDir: false },
    { name: 'atlas-synth3_dseg.nii.gz', isDir: false },
    { name: 'atlas-synth3_dseg.tsv', isDir: false },
  ],
  [`${HARNESS_ROOT}/surf`]: [
    { name: 'lh.inflated.gii', isDir: false },
    { name: 'lh.sensorimotor.func.gii', isDir: false },
  ],
};

const NO_INTENT: NonNullable<VolumeFixture['header']> = {
  dataType: 'FLOAT32',
  intentCode: 0,
  intentName: '',
  intentP1: 0,
  intentP2: 0,
  intentP3: 0,
  description: '',
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

/** NIfTI intent codes decoded by `StatisticInfo::from_intent` (bridge_types). */
const INTENT_KINDS: Record<number, StatisticKind> = {
  0: 'none',
  2: 'correlation',
  3: 't',
  4: 'f',
  5: 'z',
  6: 'chi2',
  22: 'p',
  23: 'logp',
  24: 'log10p',
  1002: 'label',
};

/**
 * Mirror of `StatisticInfo::from_intent` for the Phase 3 fixture headers
 * (intent code set; the SPM-description fallback and the distribution names
 * of codes 7-21 are not needed here). The bridge serialises it camelCase as
 * `statistic` (generated StatisticInfo).
 */
export function statisticForHeader(h: NonNullable<VolumeFixture['header']>): StatisticInfo {
  const name = h.intentName.trim();
  const kind: StatisticKind =
    INTENT_KINDS[h.intentCode] ??
    (h.intentCode === 1001 && name
      ? 'estimate'
      : h.intentCode >= 7 && h.intentCode <= 21
        ? 'other'
        : 'data');
  const params: [number, number, number] = [h.intentP1, h.intentP2, h.intentP3];
  const valid = (df: number) => Number.isFinite(df) && df > 0;
  const dof =
    kind === 't' || kind === 'chi2' || kind === 'correlation'
      ? params.slice(0, 1).filter(valid)
      : kind === 'f' && valid(params[0]) && valid(params[1])
        ? params.slice(0, 2)
        : [];
  const fmt = (df: number) =>
    Math.abs(df - Math.round(df)) < 1e-3 ? String(Math.round(df)) : String(Number(df.toFixed(2)));
  const withDof = (base: string) => (dof.length ? `${base}(${dof.map(fmt).join(',')})` : base);
  const label: Record<StatisticKind, string> = {
    none: '',
    z: 'z',
    t: withDof('t'),
    f: withDof('F'),
    chi2: withDof('χ²'),
    correlation: withDof('r'),
    p: 'p',
    logp: 'ln(p)',
    log10p: 'log10(p)',
    estimate: name,
    label: 'label',
    other: name || `intent ${h.intentCode}`,
    data: '',
  };
  return {
    kind,
    intentCode: h.intentCode,
    intentParams: params,
    intentName: name,
    dof,
    label: label[kind],
    fromDescription: false,
    positiveDataLabel: kind === 'logp' ? '−ln(p)' : kind === 'log10p' ? '−log10(p)' : null,
  };
}

/**
 * `statistic` on VolumeHandleInfo: only for statistics
 * (`StatisticInfo::is_statistic`: not none, label or data), like
 * stat_metadata::statistic_for_path.
 */
function handleStatistic(fixture: VolumeFixture): { statistic?: StatisticInfo } {
  if (!fixture.header) return {};
  const statistic = statisticForHeader(fixture.header);
  return statistic.kind === 'none' || statistic.kind === 'label' || statistic.kind === 'data'
    ? {}
    : { statistic };
}

/** Image bytes for an RGBA buffer (what render_view returns for `format: 'png' | 'jpg'`). */
async function encodeImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg',
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('harness: no 2d context for image encoding');
  if (type === 'image/jpeg') {
    // JPEG has no alpha: composite over black like the backend encoder.
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    const tmp = new OffscreenCanvas(width, height);
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  }
  const blob = await canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.92 } : { type });
  return new Uint8Array(await blob.arrayBuffer());
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
  // register_categorical_colormap slots (custom slots follow the builtins).
  const categoricalLuts = new Map<number, Uint8Array>();
  const categoricalKeys = new Map<string, number>();

  const fixtureForPath = (path: string): VolumeFixture | null => {
    if (path === MNI_PATH) return fixtures.mni;
    if (path === STATS_PATH) return fixtures.stats;
    if (path === ZMAP_PATH) return fixtures.zmap;
    if (path === TMAP_PATH) return fixtures.tmap;
    if (path === ZMAP_NOISY_PATH) return fixtures.zmapNoisy;
    if (path === TMAP_NOISY_PATH) return fixtures.tmapNoisy;
    if (path === ATLAS_PATH) return fixtures.atlas;
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
      // The loader's storage type ("u8" for the UINT8 atlas); scaled or float data is f32.
      dtype: fixture.header?.dataType === 'UINT8' ? 'u8' : 'f32',
      volume_type: 'Volume3D',
      num_timepoints: null,
      current_timepoint: null,
      time_series_info: null,
      ...handleStatistic(fixture),
      // VolumeHandleInfo.is_label_map: NIfTI intent 1002 (the atlas fixture).
      ...(fixture.header?.intentCode === 1002 ? { is_label_map: true } : {}),
    };
  };

  const volumeFor = (volumeId: string): VolumeEntry => {
    const entry = volumes.get(volumeId);
    if (!entry) throw new Error(`Volume '${volumeId}' not found`);
    return entry;
  };

  /** resolve_volume: an explicit volume id wins, else the layer's volume. */
  const targetVolume = (target: QueryTarget): VolumeEntry => {
    if (target.volumeId && volumes.has(target.volumeId)) return volumeFor(target.volumeId);
    if (target.layerId) return volumeForLayer(target.layerId);
    throw new Error('Specify a volumeId or layerId');
  };

  const volumeForLayer = (layerId: string): VolumeEntry => {
    const layer = layers.get(layerId);
    if (layer) return volumeFor(layer.volumeId);
    // Some callers pass the volume id directly.
    return volumeFor(layerId);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toSliceLayers = (payloadLayers: any[]): SliceLayer[] => {
    let outlineTaken = 0;
    return (payloadLayers ?? [])
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
        const colormapId = l.colormapId ?? l.colormap_id;
        const labelLut =
          mode === 'label' && typeof colormapId === 'number'
            ? categoricalLuts.get(colormapId)
            : undefined;
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
            labelLut,
            // The renderer draws one outline: the first visible label layer with
            // it enabled (render_bridge_adapter slice_features).
            outline:
              mode === 'label' && l.outline?.enabled && !outlineTaken++
                ? {
                    color: l.outline.color,
                    thicknessPx: Number(l.outline.thicknessPx ?? 1),
                    selectedLabelId: Number(l.outline.selectedLabelId ?? 0),
                  }
                : undefined,
          },
        ];
      });
  };

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
        data_type: vol.fixture.header?.dataType ?? 'FLOAT32',
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
        description: vol.fixture.header?.description ?? 'Brainflow harness fixture',
        data_range: { min: s.min, max: s.max },
        // NiftiHeaderInfo.statistic is present whenever the header was re-read
        // (kind "none" for plain images).
        statistic: vol.fixture.header
          ? statisticForHeader(vol.fixture.header)
          : statisticForHeader({ ...NO_INTENT }),
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
        // Column-major, like the real backend's GPU info (lib.rs flattens
        // world_to_voxel / voxel_to_world per column for WGSL).
        world_to_voxel: flatColumnMajor(vol.worldToVoxel),
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
        voxel_to_world: flatColumnMajor(vol.fixture.affine),
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
    // Mirrors volume_queries::sample_nearest: world -> voxel through the inverse
    // affine, nearest voxel floor(v + 0.5) (so [-0.5, 0) reads voxel 0), 0 outside.
    sample_layer_value_at_world: ({
      layerId,
      worldCoords,
    }: {
      layerId: string;
      worldCoords: Vec3;
    }) => {
      const vol = volumeForLayer(layerId);
      const m = vol.worldToVoxel;
      const [wx, wy, wz] = vec3(worldCoords);
      const v = [0, 1, 2].map((r) => m[r][0] * wx + m[r][1] * wy + m[r][2] * wz + m[r][3]);
      const [nx, ny, nz] = vol.fixture.dims;
      const [i, j, k] = v.map((c) => Math.floor(c + 0.5));
      if (![i, j, k].every(Number.isFinite)) return 0;
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
      return vol.fixture.data[i + nx * (j + ny * k)];
    },

    compute_layer_histogram: (args: {
      layerId: string;
      binCount?: number;
      range?: [number, number];
      excludeZeros?: boolean;
    }) => {
      const vol = volumeForLayer(args.layerId).fixture;
      // histogram.rs filters before everything: excluded zeros leave the
      // bins, the range and mean/std alike.
      const s = stats(args.excludeZeros ? vol.data.filter((v) => v !== 0) : vol.data);
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

    render_view: ({ stateJson, format }: { stateJson: string; format?: string }) => {
      const state = JSON.parse(stateJson);
      const view = state.requestedView ?? defaultRequestedView(state);
      const rgba = renderRequested(state, view);
      // RenderFormat::from_str: "png" and "jpg"/"jpeg" encode; anything else is raw RGBA.
      const fmt = String(format ?? '').toLowerCase();
      if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg') {
        return encodeImage(
          rgba,
          Number(view.width),
          Number(view.height),
          fmt === 'png' ? 'image/png' : 'image/jpeg',
        );
      }
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
    // Volume queries (clusters.rs / volume_queries.rs), computed on the
    // fixture arrays by the mirrors in volumeQueries.ts.
    compute_clusters: ({ request }: { request: ClusterQuery & QueryTarget }) =>
      findClusters(targetVolume(request).fixture, request),
    volume_extremum: ({ request }: { request: QueryTarget & { kind: ExtremumKind } }) =>
      findExtremum(targetVolume(request).fixture, request.kind),
    volume_nonzero_bbox: ({ request }: { request: QueryTarget & { threshold?: number | null } }) =>
      nonzeroBbox(targetVolume(request).fixture, request.threshold ?? 0),
    // No catalogue atlases in the harness: like the backend, ROI search refuses
    // volumes without a parcel dictionary.
    get_atlas_roi_locations: () => {
      throw new Error('ROI search requires an atlas loaded through the atlas catalog');
    },
    // register_categorical_colormap(key, maxLabel, lutRgb) -> slot id; the
    // same key reuses its slot (upsert), like the render loop.
    register_categorical_colormap: ({
      key,
      maxLabel,
      lutRgb,
    }: {
      key: string;
      maxLabel: number;
      lutRgb: number[];
    }) => {
      if (lutRgb.length !== (maxLabel + 1) * 3) {
        throw new Error(
          `lut_rgb length ${lutRgb.length} does not match (max_label + 1) * 3 = ${(maxLabel + 1) * 3}`,
        );
      }
      const slot = categoricalKeys.get(key) ?? 64 + categoricalKeys.size;
      categoricalKeys.set(key, slot);
      categoricalLuts.set(slot, Uint8Array.from(lutRgb));
      return slot;
    },
    // save_image_bytes: raw Uint8Array body, suggested name in the
    // percent-encoded x-brainflow-suggested-name header -> written path | null.
    // The harness never shows a native dialog: it "writes" to a fixed fake
    // folder and logs the step. `null` (cancel) can be forced per scenario
    // with setHandler.
    save_image_bytes: (body: unknown, options?: InvokeOptions) => {
      const bytes = rawBody(body, 'save_image_bytes');
      const suggested = rawHeader(options, 'x-brainflow-suggested-name')?.trim();
      const path = `/harness/exports/${suggested || 'view.png'}`;
      noteStep(`save_image_bytes ${bytes.length} bytes -> ${path}`);
      return path;
    },
    // export_population_plot: raw body; x-brainflow-path / x-brainflow-format.
    export_population_plot: (body: unknown, options?: InvokeOptions) => {
      const bytes = rawBody(body, 'export_population_plot');
      const path = rawHeader(options, 'x-brainflow-path');
      const format = rawHeader(options, 'x-brainflow-format');
      if (!path || !format) throw new Error('Missing request header x-brainflow-path/format.');
      noteStep(`export_population_plot ${bytes.length} bytes (${format}) -> ${path}`);
      return path;
    },
    // tauri-plugin-fs read_text_file (scope: capabilities/default.json
    // fs:read-files). Only the atlas LUT sidecar exists; anything else fails
    // like a missing file.
    // tauri app version (export provenance): a fixed stub in the harness.
    'plugin:app|version': () => '0.0.0-harness',
    'plugin:fs|read_text_file': ({ path }: { path: string }) => {
      if (path === ATLAS_LUT_PATH) return new TextEncoder().encode(fixtures.atlasLut).buffer;
      throw new Error(`failed to open file at path: ${path} with error: No such file or directory (os error 2)`);
    },
    // Remote mounts: no saved profiles; anything that would reach the network
    // (only after the user presses Connect / answers a challenge) fails
    // deterministically instead.
    list_remote_mount_profiles: () => [...REMOTE_MOUNT_PROFILES],
    list_remote_mounts: () => [],
    remote_mount_connect: () => {
      throw new Error(REMOTE_MOUNT_OFFLINE_ERROR);
    },
    remote_mount_respond_host_key: () => {
      throw new Error(REMOTE_MOUNT_OFFLINE_ERROR);
    },
    remote_mount_respond_auth: () => {
      throw new Error(REMOTE_MOUNT_OFFLINE_ERROR);
    },
    remove_remote_mount_profile: () => {
      throw new Error(REMOTE_MOUNT_OFFLINE_ERROR);
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
