/**
 * Deterministic backend model for the full-app harness.
 *
 * Response shapes follow the Rust command signatures in
 * core/api_bridge/src/lib.rs and the generated bindings in
 * packages/api/src/generated. IDs come from counters, never clocks/RNG.
 */
import { BRIDGE_MODULES, type ExtremumKind, type StatisticInfo, type StatisticKind } from '@brainflow/api';
import {
  clusterLabelData,
  findClusters,
  findExtremum,
  nonzeroBbox,
  resampleMaskNearest,
  type ClusterQuery,
} from './volumeQueries';

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
  FIR_LAGS,
  firRevision,
  firValue,
  locusVoxels,
  parseFirPath,
  sampleFirMember,
  sampleFirVoxels,
} from './firStudy';
import { multirunFixture, parseMultirunPath } from './multirun';
import { computeSurfaceSulcalDepth } from '@brainflow/visualization/surface';
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
/** Simulated native latency of a 4D GPU upload and of a layer patch (ms). */
const GPU_4D_UPLOAD_MS = 150;
const PATCH_MS = 15;

/** The MNI brain mask (1 inside the brain, 0 outside): a search mask for clusters. */
export const MNI_MASK_PATH = `${HARNESS_ROOT}/anat/MNI152_T1_2mm_brain_mask.nii.gz`;
export const STATS_PATH = `${HARNESS_ROOT}/stats/task-motor_zstat1.nii.gz`;
export const SURFACE_PATH = `${HARNESS_ROOT}/surf/lh.inflated.gii`;
export const SURFACE_OVERLAY_PATH = `${HARNESS_ROOT}/surf/lh.sensorimotor.func.gii`;

/**
 * Phase 4 surface-figure fixtures (D2-D4), all derived from the fs_LR 32k
 * left inflated mesh at load time; not listed in the Files tree (the P3
 * specimens stay as they were):
 * - rh.inflated: the lh mesh mirrored in x (face winding flipped);
 * - lh.midthickness: SYNTHETIC folded stand-in (the lh mesh scaled 0.9 about
 *   its centroid), same topology: the anatomical mesh for the vertex readout;
 * - lh/rh.sulc.shape.gii: SYNTHETIC "sulc", the sulcal depth of the inflated
 *   mesh itself (its residual large-scale concavities: insula, medial wall);
 * - rh.sensorimotor: the lh overlay × 0.7 (mirrored with the mesh).
 */
export const FIG_ROOT = `${HARNESS_ROOT}/fig`;
export const FIG_LH_PATH = `${FIG_ROOT}/lh.inflated.gii`;
export const FIG_RH_PATH = `${FIG_ROOT}/rh.inflated.gii`;
export const FIG_LH_MID_PATH = `${FIG_ROOT}/lh.midthickness.gii`;
export const FIG_LH_OVERLAY_PATH = `${FIG_ROOT}/lh.sensorimotor.func.gii`;
export const FIG_RH_OVERLAY_PATH = `${FIG_ROOT}/rh.sensorimotor.func.gii`;
export const FIG_LH_SULC_PATH = `${FIG_ROOT}/lh.sulc.shape.gii`;
export const FIG_RH_SULC_PATH = `${FIG_ROOT}/rh.sulc.shape.gii`;
/** The rh overlay is the lh one scaled by this (a known answer). */
export const FIG_RH_OVERLAY_SCALE = 0.7;
/** Phase 3 synthetic statistics (fixtures/app/p3_fixtures.json). Listed under stats/, which
 * the gate scenarios never expand, so the gate baselines do not see them. */
export const ZMAP_PATH = `${HARNESS_ROOT}/stats/zmap_synthetic.nii.gz`;
export const TMAP_PATH = `${HARNESS_ROOT}/stats/tmap_synthetic_df24.nii.gz`;
/** Native-like noisy copies (v6), loadable by path; not listed in the tree. */
export const ZMAP_NOISY_PATH = `${HARNESS_ROOT}/stats/zmap_native_noise.nii.gz`;
export const TMAP_NOISY_PATH = `${HARNESS_ROOT}/stats/tmap_native_noise_df24.nii.gz`;
/** Phase 4 C1: the z map with two extra blobs in cluster 1 (sub-peaks); not listed. */
export const ZMAP_MULTIPEAK_PATH = `${HARNESS_ROOT}/stats/zmap_multipeak.nii.gz`;
export const ATLAS_PATH = `${HARNESS_ROOT}/stats/atlas-synth3_dseg.nii.gz`;
export const ATLAS_LUT_PATH = `${HARNESS_ROOT}/stats/atlas-synth3_dseg.tsv`;

/** The E2 `region` argument of the sampling commands. */
type RegionArg = {
  labelSource: { type: 'layer'; layerId: string } | { type: 'volume'; volumeId: string } | { type: 'path'; path: string };
  labelIds: number[];
};

interface VolumeEntry {
  id: string;
  name: string;
  path: string;
  fixture: VolumeFixture;
  worldToVoxel: number[][];
  /** 4D fixtures: the frame on display. */
  timepoint?: number;
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
  // Phase 4 figure set (not linked from the study root: listed only for the
  // curvature service's sidecar lookup).
  [FIG_ROOT]: [
    'lh.inflated.gii',
    'rh.inflated.gii',
    'lh.midthickness.gii',
    'lh.sensorimotor.func.gii',
    'rh.sensorimotor.func.gii',
    'lh.sulc.shape.gii',
    'rh.sulc.shape.gii',
  ].map((name) => ({ name, isDir: false })),
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

/** Statistics over a fixture's values: every frame of a 4D fixture, as the backend's data range does. */
function fixtureStats(fixture: VolumeFixture) {
  if (!fixture.frames) return stats(fixture.data);
  const all = new Float32Array(fixture.frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of fixture.frames) {
    all.set(f, offset);
    offset += f.length;
  }
  return stats(all);
}

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
  const overlays = new Map<string, Float32Array>();
  // Phase 4 figure meshes and values, derived once (see FIG_ROOT).
  let figure: {
    rh: Float32Array;
    rhFaces: Uint32Array;
    mid: Float32Array;
    sulc: Float32Array | null;
    rhOverlay: Float32Array;
  } | null = null;
  const figureData = () => {
    if (figure) return figure;
    const { vertices, faces, overlay } = fixtures.surface;
    const rh = new Float32Array(vertices);
    for (let i = 0; i < rh.length; i += 3) rh[i] = -rh[i];
    const rhFaces = new Uint32Array(faces);
    for (let i = 0; i < rhFaces.length; i += 3) {
      const b = rhFaces[i + 1];
      rhFaces[i + 1] = rhFaces[i + 2];
      rhFaces[i + 2] = b;
    }
    const c = [0, 0, 0];
    const n = vertices.length / 3;
    for (let i = 0; i < vertices.length; i += 1) c[i % 3] += vertices[i] / n;
    const mid = new Float32Array(vertices.length);
    for (let i = 0; i < vertices.length; i += 1) mid[i] = c[i % 3] + 0.9 * (vertices[i] - c[i % 3]);
    figure = { rh, rhFaces, mid, sulc: null, rhOverlay: overlay.map((v) => v * FIG_RH_OVERLAY_SCALE) };
    return figure;
  };
  const surfaceMeshFor = (path: string) => {
    const { vertices, faces } = fixtures.surface;
    if (path === SURFACE_PATH || path === FIG_LH_PATH) {
      return { vertices, faces, hemisphere: 'left', surfaceType: 'inflated' };
    }
    if (path === FIG_RH_PATH) {
      const f = figureData();
      return { vertices: f.rh, faces: f.rhFaces, hemisphere: 'right', surfaceType: 'inflated' };
    }
    if (path === FIG_LH_MID_PATH) {
      return { vertices: figureData().mid, faces, hemisphere: 'left', surfaceType: 'midthickness' };
    }
    return null;
  };
  const overlayValuesFor = (path: string): Float32Array | null => {
    if (path === SURFACE_OVERLAY_PATH || path === FIG_LH_OVERLAY_PATH) return fixtures.surface.overlay;
    if (path === FIG_RH_OVERLAY_PATH) return figureData().rhOverlay;
    if (path === FIG_LH_SULC_PATH || path === FIG_RH_SULC_PATH) {
      const f = figureData();
      f.sulc ??= computeSurfaceSulcalDepth(fixtures.surface.vertices, fixtures.surface.faces, 'left');
      return f.sulc;
    }
    return null;
  };
  let jobCounter = 0;
  const jobs = new Map<string, string>();
  // register_categorical_colormap slots (custom slots follow the builtins).
  const categoricalLuts = new Map<number, Uint8Array>();
  const categoricalKeys = new Map<string, number>();

  // FIR 4D fixtures, built once per path (8 frames on the MNI grid).
  const firFixtures = new Map<string, VolumeFixture>();
  const firFixture = (path: string): VolumeFixture => {
    const cached = firFixtures.get(path);
    if (cached) return cached;
    const id = parseFirPath(path, 0)!;
    const { dims, affine } = fixtures.mni;
    const [nx, ny, nz] = dims;
    const frames = FIR_LAGS.map((lag) => {
      const data = new Float32Array(nx * ny * nz);
      for (let k = 0; k < nz; k += 1)
        for (let j = 0; j < ny; j += 1)
          for (let i = 0; i < nx; i += 1) {
            const n = i + nx * (j + ny * k);
            // Zero outside the brain, as a real FIR NIfTI is (v1 user 6: a
            // whole-grid offset turned the overlay into an opaque slab).
            if (!(fixtures.mni.data[n] > 0)) continue;
            const w = [0, 1, 2].map((r) => affine[r][0] * i + affine[r][1] * j + affine[r][2] * k + affine[r][3]);
            data[n] = firValue(w, id.subject, id.condition, lag);
          }
      return data;
    });
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of frames) for (const v of f) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const fixture: VolumeFixture = { dims: [nx, ny, nz], affine, data: frames[0], frames, range: [lo, hi] };
    firFixtures.set(path, fixture);
    return fixture;
  };

  /** Voxel centres (world mm) of a region locus; error 2027 when it holds none. */
  const regionVoxels = (region: RegionArg): number[][] => {
    const src = region.labelSource;
    const vol =
      src.type === 'layer'
        ? volumeForLayer(src.layerId).fixture
        : src.type === 'volume'
          ? volumeFor(src.volumeId).fixture
          : fixtureForPath(src.path);
    if (!vol) throw Object.assign(new Error(`Label source not found: ${JSON.stringify(src)}`), { code: 2027 });
    const ids = new Set(region.labelIds);
    const [nx, ny, nz] = vol.dims;
    const a = vol.affine;
    const out: number[][] = [];
    for (let k = 0; k < nz; k += 1)
      for (let j = 0; j < ny; j += 1)
        for (let i = 0; i < nx; i += 1)
          if (ids.has(Math.round(vol.data[i + nx * (j + ny * k)])))
            out.push([0, 1, 2].map((r) => a[r][0] * i + a[r][1] * j + a[r][2] * k + a[r][3]));
    if (!out.length)
      throw Object.assign(new Error(`The region holds no voxels (labels ${region.labelIds.join(', ')})`), { code: 2027 });
    return out;
  };

  let mask: VolumeFixture | null = null;
  const mniMask = (): VolumeFixture => {
    mask ??= {
      dims: fixtures.mni.dims,
      affine: fixtures.mni.affine,
      data: Float32Array.from(fixtures.mni.data, (v) => (v > 0 ? 1 : 0)),
      range: [0, 1],
    };
    return mask;
  };

  const voxelSpacing = (f: VolumeFixture) =>
    [0, 1, 2].map((c) => Math.hypot(f.affine[0][c], f.affine[1][c], f.affine[2][c]));
  /** Only 0 and 1 in every frame (a mask), as the loader's is_binary_like. */
  const isBinaryFixture = (f: VolumeFixture) => (f.frames ?? [f.data]).every((d) => d.every((v) => v === 0 || v === 1));

  const fixtureForPath = (path: string): VolumeFixture | null => {
    if (path === MNI_PATH) return fixtures.mni;
    if (path === MNI_MASK_PATH) return mniMask();
    if (path === STATS_PATH) return fixtures.stats;
    if (path === ZMAP_PATH) return fixtures.zmap;
    if (path === TMAP_PATH) return fixtures.tmap;
    if (path === ZMAP_NOISY_PATH) return fixtures.zmapNoisy;
    // Phase 4 E6: a FIR study's 4D lag series (one subject × condition), on the MNI grid.
    if (parseFirPath(path, 0) && path.endsWith('_fir.nii.gz')) return firFixture(path);
    if (path === ZMAP_MULTIPEAK_PATH) return fixtures.zmapMultipeak;
    // Phase 4 E5b: one subject's three BOLD runs (4 mm grid, TR 2 s).
    const run = parseMultirunPath(path);
    if (run !== null) return multirunFixture(run);
    if (path === TMAP_NOISY_PATH) return fixtures.tmapNoisy;
    if (path === ATLAS_PATH) return fixtures.atlas;
    return null;
  };

  const registerVolume = (path: string, name: string, fixture: VolumeFixture) => {
    volumeCounter += 1;
    const id = `vol-${volumeCounter}`;
    // Each registration displays its own frame (a fresh `data` reference).
    const own = fixture.frames ? { ...fixture, data: fixture.frames[0] } : fixture;
    volumes.set(id, { id, name, path, fixture: own, worldToVoxel: invertAffine(fixture.affine), timepoint: fixture.frames ? 0 : undefined });
    const frames = fixture.frames?.length ?? 0;
    if (frames > 1) {
      return {
        id,
        name,
        dims: [...fixture.dims, frames],
        dtype: 'f32',
        volume_type: 'TimeSeries4D',
        num_timepoints: frames,
        current_timepoint: 0,
        time_series_info: { num_timepoints: frames, tr: fixture.tr ?? null, temporal_unit: fixture.tr ? 's' : null, acquisition_time: null },
        ...handleStatistic(fixture),
      };
    }
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
            // Every drawn label layer with its outline enabled draws its own
            // (render_bridge_adapter slice_features, one entry per layer).
            outline:
              mode === 'label' && l.outline?.enabled
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
    // Mirrors api_bridge resolve_requested_render_timepoint: a drawn 4D layer
    // needs the request's timepoint (native R2-3: a view state without one
    // rendered black until the first frame change).
    const fourD = (state.layers ?? []).some(
      (l: { visible?: boolean; opacity?: number; volumeId?: string; volume_id?: string } | null) =>
        !!l &&
        l.visible !== false &&
        (l.opacity ?? 1) > 0 &&
        (volumes.get((l.volumeId ?? l.volume_id) as string)?.fixture.frames?.length ?? 0) > 1,
    );
    if (fourD && (state.timepoint === undefined || state.timepoint === null)) {
      throw Object.assign(new Error('Render request for a 4D volume must include a timepoint.'), { code: 4103 });
    }
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
      volume_texture_slots: 16,
      render_layer_capacity: 8,
    }),

    load_file: ({ path }: { path: string }) => {
      const fixture = fixtureForPath(path);
      if (!fixture) throw new Error(`harness: no fixture for path ${path}`);
      return registerVolume(path, path.split('/').pop() ?? path, fixture);
    },
    // The harness has no template cache and cannot download: the first
    // screen (firstScreenService) stays empty and logs nothing, so the empty
    // scenarios keep their empty state.
    get_template_entry: () => null,
    cache_template: () => false,
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
      const s = fixtureStats(vol.fixture);
      return {
        filename: vol.name,
        dimensions: [...vol.fixture.dims],
        voxel_spacing: voxelSpacing(vol.fixture),
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
    get_volume_timepoint: ({ volumeId }: { volumeId?: string } = {}) =>
      (volumeId && volumes.get(volumeId)?.timepoint) ?? 0,
    // 4D fixtures display the requested frame; 3D ones ignore it.
    set_volume_timepoint: ({ volumeId, timepoint }: { volumeId: string; timepoint: number }) => {
      const entry = volumes.get(volumeId);
      const frames = entry?.fixture.frames;
      if (entry && frames) {
        const t = Math.max(0, Math.min(frames.length - 1, Math.round(timepoint)));
        entry.timepoint = t;
        entry.fixture = { ...entry.fixture, data: frames[t] };
      }
      return null;
    },
    // sample_stack: the locus (nearest voxel, or a sphere reduced by `reduce`)
    // per frame of a 4D layer, one value for a 3D layer.
    sample_stack: ({
      layerId,
      worldMm,
      radiusMm,
      reduce,
      region,
    }: {
      layerId: string;
      worldMm: [number, number, number];
      radiusMm: number;
      reduce?: string;
      region?: RegionArg;
    }) => {
      const entry = volumeForLayer(layerId);
      const vol = entry.fixture;
      const [nx, ny] = vol.dims;
      const voxels = (region ? regionVoxels(region) : locusVoxels(vol, worldMm, radiusMm)).map((w) =>
        [0, 1, 2].map((r) => Math.round((w[r] - vol.affine[r][3]) / vol.affine[r][r])),
      );
      const frames = vol.frames ?? [vol.data];
      return frames.map((data) => {
        const values = voxels.map(([i, j, k]) => data[i + nx * (j + ny * k)]);
        if (!values.length) return Number.NaN;
        if (reduce === 'median') {
          const sorted = [...values].sort((a, b) => a - b);
          const m = sorted.length >> 1;
          return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
        }
        return values.reduce((a, b) => a + b, 0) / values.length;
      });
    },
    // sample_set_at_world (phase 4 E6): the synthetic FIR study's members,
    // evaluated analytically at voxel centres of the MNI grid (firStudy.ts).
    sample_set_at_world: ({
      members,
      worldMm,
      radiusMm,
      reduce,
      region,
    }: {
      members: Array<{ memberId: string; sourcePath: string; stackIndex?: number }>;
      worldMm: [number, number, number];
      radiusMm: number;
      reduce?: 'mean' | 'median';
      region?: RegionArg;
    }) => {
      // E2: a region replaces the point / sphere (its voxel centres).
      const voxels = region ? regionVoxels(region) : null;
      return members.map((m) => {
        const sampled = voxels
          ? sampleFirVoxels(m.sourcePath, m.stackIndex, voxels, reduce ?? 'mean')
          : sampleFirMember(fixtures.mni, m.sourcePath, m.stackIndex, worldMm, radiusMm, reduce ?? 'mean');
        if (!sampled) throw new Error(`harness: no set sampling fixture for ${m.sourcePath}`);
        return {
          memberId: m.memberId,
          value: sampled.value,
          count: sampled.count,
          sourceRevision: { sha256: firRevision(m.sourcePath), sourceBytes: 1 },
          error: null,
        };
      });
    },

    request_layer_gpu_resources: async ({
      layerSpec,
    }: {
      layerSpec: { Volume: { id: string; source_resource_id: string } };
    }) => {
      const spec = layerSpec.Volume;
      const vol = volumeFor(spec.source_resource_id);
      // Native round 3: a 4D upload takes real time, so loads and GPU promotions
      // finish after the UI has moved on (run groups form mid-load).
      if ((vol.fixture.frames?.length ?? 0) > 1) await new Promise((r) => setTimeout(r, GPU_4D_UPLOAD_MS));
      layers.set(spec.id, { layerId: spec.id, volumeId: vol.id });
      const s = fixtureStats(vol.fixture);
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
        // From the fixture (round 3 C8): the multirun BOLD is 4 mm, the brain mask binary.
        spacing: voxelSpacing(vol.fixture),
        data_range: { min: s.min, max: s.max },
        source_volume_id: vol.id,
        allocated_at: 0,
        is_binary_like: isBinaryFixture(vol.fixture),
      };
    },
    wait_for_layer_ready: () => true,
    // A backend round trip, as natively (visibility toggles await it).
    patch_layer: async () => {
      await new Promise((r) => setTimeout(r, PATCH_MS));
      return null;
    },
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
      allFrames?: boolean;
    }) => {
      const fixture = volumeForLayer(args.layerId).fixture;
      // all_frames: every frame of a 4D volume (v2 R3), else the one on display.
      const vol =
        args.allFrames && fixture.frames && fixture.frames.length > 1
          ? { ...fixture, data: Float32Array.from(fixture.frames.flatMap((f) => Array.from(f))) }
          : fixture;
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
      const mesh = surfaceMeshFor(path);
      if (!mesh) throw new Error(`harness: no surface fixture for ${path}`);
      surfaceCounter += 1;
      const handle = `surf-${surfaceCounter}`;
      surfaces.set(handle, path);
      return {
        type: 'Surface',
        handle,
        vertex_count: mesh.vertices.length / 3,
        face_count: mesh.faces.length / 3,
        hemisphere: mesh.hemisphere,
        surface_type: mesh.surfaceType,
      };
    },
    get_surface_geometry: ({ handle }: { handle: string }) => {
      const path = surfaces.get(handle);
      const mesh = path ? surfaceMeshFor(path) : null;
      if (!mesh) throw new Error(`Surface '${handle}' not found`);
      return { vertices: mesh.vertices, faces: mesh.faces };
    },
    unload_surface: ({ handle }: { handle: string }) => {
      surfaces.delete(handle);
      return { success: true, message: 'unloaded' };
    },
    load_surface_overlay: ({ path, targetSurfaceId }: { path: string; targetSurfaceId: string }) => {
      const values = overlayValuesFor(path);
      // Like the backend: a missing file is error 2010.
      if (!values) throw new Error(`Overlay file not found: ${path}`);
      overlayCounter += 1;
      const kind = path.includes('.sulc.') ? 'sulc' : 'sensorimotor';
      const handle = `overlay_${targetSurfaceId}_${kind}_${overlayCounter}`;
      overlays.set(handle, values);
      return {
        type: 'SurfaceData',
        handle,
        data_count: values.length,
        intent: kind === 'sulc' ? 'shape' : 'functional',
      };
    },
    get_surface_overlay_data: ({ handle }: { handle?: string } = {}) =>
      Array.from((handle ? overlays.get(handle) : undefined) ?? fixtures.surface.overlay),
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
    compute_clusters: ({ request }: { request: ClusterQuery & QueryTarget }) => {
      const entry = targetVolume(request);
      // S3: a registered mask volume bounds the search (nearest-voxel resampled).
      const maskId = request.searchMask ?? null;
      if (maskId && !volumes.has(maskId)) {
        throw Object.assign(new Error(`Search mask volume ${maskId} not found`), { code: 4041 });
      }
      const mask = maskId ? resampleMaskNearest(volumeFor(maskId).fixture, entry.fixture) : null;
      const table = findClusters(entry.fixture, request, mask, maskId);
      // E3: the cluster-id label volume, registered (hidden) so a row can be a region.
      if (request.emitLabelVolume) {
        const labels = clusterLabelData(entry.fixture, request, table, mask);
        const info = registerVolume(`${entry.path}#clusters`, `${entry.name} clusters`, {
          dims: entry.fixture.dims,
          affine: entry.fixture.affine,
          data: labels,
          range: [0, table.clusters.length],
        });
        table.labelVolumeId = info.id;
      }
      return table;
    },
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
    // No native population engine here: reject like an unavailable native
    // command rather than resolving null (review M4).
    evaluate_population_slice: () => {
      throw new Error('Population slices are unavailable in the app harness.');
    },
    population_peak_slice: () => {
      throw new Error('Population slices are unavailable in the app harness.');
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
    // tauri-plugin-fs read_file (FreeSurfer lh.sulc / lh.curv sidecars, D2):
    // the harness has none, so every read fails like a missing file.
    'plugin:fs|read_file': ({ path }: { path: string }) => {
      throw new Error(`failed to open file at path: ${path} with error: No such file or directory (os error 2)`);
    },
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

  // Bridge modules (core/api_bridge/src/modules): like the bridge, all start
  // enabled; the app's startup set_enabled_modules switches some off, and a
  // switched-off module's commands reject with ModuleDisabled (12001).
  let enabledModules = new Set<string>(Object.keys(BRIDGE_MODULES));
  const moduleInfos = () =>
    Object.values(BRIDGE_MODULES).map(({ id, title, version, stage }) => ({
      id,
      title,
      version,
      stage,
      enabled: enabledModules.has(id),
    }));
  handlers.list_modules = () => moduleInfos();
  // src-tauri host command: the native menu's module items (no menu here).
  handlers.set_module_menu_items = () => null;
  handlers.set_enabled_modules = ({ moduleIds }: { moduleIds: string[] }) => {
    const unknown = moduleIds.find((id) => !(id in BRIDGE_MODULES));
    if (unknown) throw new Error(`Unknown module id '${unknown}'`);
    enabledModules = new Set(moduleIds);
    return moduleInfos();
  };
  for (const [id, module] of Object.entries(BRIDGE_MODULES)) {
    for (const cmd of module.commands as readonly string[]) {
      const inner = handlers[cmd];
      if (!inner) continue;
      handlers[cmd] = (args, options) => {
        if (!enabledModules.has(id)) throw new Error(`ModuleDisabled (12001): the ${id} module is off`);
        return inner(args, options);
      };
    }
  }

  return {
    handlers,
    volumes,
    layers,
    setHandler(cmd, handler) {
      handlers[cmd] = handler;
    },
  };
}
