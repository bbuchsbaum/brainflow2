/**
 * LabelTableService: give a user-loaded label volume its label table
 * (UI redesign phase 3, item 4).
 *
 * After a label/integer volume loads from a file, look for a sidecar with the
 * same stem (BIDS `dseg.tsv`, or a FreeSurfer-style `.lut` / `.txt`; see
 * utils/labelTable.ts). When one parses:
 * - the layer becomes a label layer with a discrete colour table: the LUT is
 *   registered with `register_categorical_colormap` (the same path catalogue
 *   atlases use) and the view layer gets `colormapId`, `layerMode: 'label'`
 *   and nearest sampling. Without it a label layer reads its colours from the
 *   grayscale LUT texel by texel (label 1 renders near-black);
 * - the layer's `atlasPaletteLegend` is set, so the status Region slot and
 *   the atlas hover provider name the region at the crosshair.
 *
 * The sidecar is read with tauri-plugin-fs `read_text_file` (granted as
 * `fs:read-files` in src-tauri/capabilities/default.json, scoped to $HOME,
 * Documents, Desktop and Downloads). Paths outside that scope fail like a
 * missing sidecar and the layer keeps its plain rendering.
 */
import { getTransport, type BackendTransport } from './transport';
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { statisticUnits } from '@/utils/statistic';
import { DEFAULT_LABEL_OUTLINE } from '@/utils/labelDisplay';
import {
  buildLabelPalette,
  labelSidecarCandidates,
  MAX_CATEGORICAL_LABEL,
  parseLabelTable,
  type LabelTableEntry,
  type LabelTablePalette,
} from '@/utils/labelTable';

export const READ_TEXT_FILE_COMMAND = 'plugin:fs|read_text_file';

export interface LabelTableResult {
  /** The sidecar read, or null for a generated palette. */
  path: string | null;
  regions: number;
  colormapId: number | null;
}

export function decodeText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  // tauri-plugin-fs answers an ArrayBuffer (raw IPC body) or a number[];
  // test realms may hand over a foreign-realm ArrayBuffer, hence the tag check.
  if (Object.prototype.toString.call(raw) === '[object ArrayBuffer]') {
    return new TextDecoder().decode(new Uint8Array(raw as ArrayBuffer));
  }
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw as Uint8Array);
  if (Array.isArray(raw)) return new TextDecoder().decode(Uint8Array.from(raw as number[]));
  return null;
}

/**
 * Custom colormap slots are a shared, fixed pool on the GPU (64, with atlases
 * and parcels), keyed by string, and the bridge has no command to free one.
 * So keys are recycled here (review D2): each layer holds its key, refcounted
 * (two layers of the same table or the same generated range share one); when
 * the last holder goes, the key returns to a free list and the next NEW table
 * registers its colours under it, overwriting that row instead of taking
 * another slot. Loading and unloading label maps all session never runs out.
 */
export class LabelColormapPool {
  private readonly holders = new Map<string, string>();
  private readonly refs = new Map<string, number>();
  private readonly physicalOf = new Map<string, string>();
  private readonly free: string[] = [];

  /** The key `layerId` registers under for the table `logicalKey`. */
  acquire(layerId: string, logicalKey: string): string {
    this.release(layerId);
    let physical = this.physicalOf.get(logicalKey);
    if (!physical) {
      physical = this.free.shift() ?? logicalKey;
      this.physicalOf.set(logicalKey, physical);
    }
    this.refs.set(physical, (this.refs.get(physical) ?? 0) + 1);
    this.holders.set(layerId, physical);
    return physical;
  }

  /** `layerId` no longer uses its key (removed, or given another table). */
  release(layerId: string): void {
    const physical = this.holders.get(layerId);
    if (!physical) return;
    this.holders.delete(layerId);
    const left = (this.refs.get(physical) ?? 1) - 1;
    if (left > 0) {
      this.refs.set(physical, left);
      return;
    }
    this.refs.delete(physical);
    for (const [logical, p] of this.physicalOf) if (p === physical) this.physicalOf.delete(logical);
    this.free.push(physical);
  }

  /** Distinct slots this pool has ever taken (in use or free). */
  get slotsTaken(): number {
    return new Set([...this.refs.keys(), ...this.free]).size;
  }
}

export class LabelTableService {
  private readonly transport: BackendTransport;
  readonly pool = new LabelColormapPool();

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  /**
   * First sidecar next to `imagePath` that parses to at least one region. A
   * sidecar that exists but cannot be read (e.g. outside the fs scope) logs
   * a warning; a missing one is silent.
   */
  async readSidecar(imagePath: string): Promise<{ path: string; entries: LabelTableEntry[] } | null> {
    for (const path of labelSidecarCandidates(imagePath)) {
      let text: string | null = null;
      try {
        text = decodeText(await this.transport.invoke(READ_TEXT_FILE_COMMAND, { path }));
      } catch (error) {
        if (!isMissingFileError(error)) {
          console.warn(`[LabelTableService] Label table ${path} could not be read:`, error);
        }
        continue;
      }
      if (!text) continue;
      const entries = parseLabelTable(text);
      if (entries.some((e) => e.id > 0)) return { path, entries };
    }
    return null;
  }

  /**
   * Apply the sidecar label table of `imagePath` to `layerId`. Returns null
   * (and changes nothing) when there is no usable sidecar or the layer was
   * removed while the table was read.
   */
  async applySidecar(layerId: string, imagePath: string): Promise<LabelTableResult | null> {
    const table = await this.readSidecar(imagePath);
    if (!table || !layerExists(layerId)) return null;
    return this.applyPalette(layerId, buildLabelPalette(table.entries), `label_table|${table.path}`, table.path);
  }

  /**
   * A label map with no table (NIfTI intent 1002 only): colour ids
   * 1..maxLabel with the deterministic categorical palette and name them by
   * id, so it renders as categories (never through a grayscale window).
   */
  async applyGeneratedPalette(layerId: string, maxLabel: number): Promise<LabelTableResult | null> {
    const top = Math.min(Math.floor(maxLabel), MAX_CATEGORICAL_LABEL);
    if (!(top > 0) || !layerExists(layerId)) return null;
    const entries: LabelTableEntry[] = [];
    for (let id = 1; id <= top; id += 1) entries.push({ id, name: `Label ${id}`, color: null });
    // The generated palette depends only on `top`: one shared key per range.
    return this.applyPalette(layerId, buildLabelPalette(entries), `label_ids|${top}`, null);
  }

  private async applyPalette(
    layerId: string,
    palette: LabelTablePalette,
    key: string,
    path: string | null,
  ): Promise<LabelTableResult | null> {
    let colormapId: number | null = null;
    if (palette.maxLabel > 0) {
      const slotKey = this.pool.acquire(layerId, key);
      try {
        const id = await this.transport.invoke<number>('register_categorical_colormap', {
          key: slotKey,
          maxLabel: palette.maxLabel,
          lutRgb: palette.lutRgb,
        });
        colormapId = typeof id === 'number' && Number.isInteger(id) ? id : null;
      } catch (error) {
        // Region names still work; the layer keeps its current colours.
        this.pool.release(layerId);
        console.warn('[LabelTableService] Failed to register label colours:', error);
      }
    }
    if (palette.uncoloured.length > 0) {
      console.warn(
        `[LabelTableService] ${palette.uncoloured.length} label id(s) above the categorical LUT width are named but not coloured`,
      );
    }

    // The layer may have been removed while the colormap registered.
    if (!layerExists(layerId)) {
      this.pool.release(layerId);
      return null;
    }

    if (colormapId !== null) {
      const viewStore = useViewStateStore.getState();
      for (const workspaceId of viewStore.workspaceViewStates.keys()) {
        const ws = viewStore.getWorkspaceViewState(workspaceId);
        if (!ws.layers.some((l) => l.id === layerId)) continue;
        viewStore.setViewState((state) => {
          const layer = state.layers.find((l) => l.id === layerId);
          if (!layer) return;
          layer.colormapId = colormapId!;
          layer.layerMode = 'label';
          layer.interpolation = 'nearest';
          layer.intensity = [-0.5, palette.maxLabel + 0.5];
          layer.threshold = [0, 0];
          layer.atlasMaxLabel = palette.maxLabel;
        }, workspaceId);
      }
    }

    useLayerStore.getState().updateLayer(layerId, {
      type: 'label',
      isLabelMap: true,
      atlasPaletteLegend: palette.legend,
    });
    if (colormapId !== null) applyLabelDisplayDefault(layerId);
    return { path, regions: palette.legend.length, colormapId };
  }
}

/**
 * Default display of a label layer drawn above a statistic map (v1 critics):
 * outline only, so a region's fill colour never covers or recolours the
 * statistic (a blue LUT region over a positive blob read as deactivation).
 * Elsewhere the label layer keeps its fill. Applied once, when the layer's
 * colours are set; the user can switch Fill / Outline / Both afterwards.
 */
export function applyLabelDisplayDefault(layerId: string): void {
  const { layers, layerMetadata } = useLayerStore.getState();
  const isStatistic = (id: string) => {
    const info = layers.find((l) => l.id === id);
    return !!info && statisticUnits(info.statistic, layerMetadata.get(id)?.dataRange) !== null;
  };
  const viewStore = useViewStateStore.getState();
  for (const workspaceId of viewStore.workspaceViewStates.keys()) {
    const ws = viewStore.getWorkspaceViewState(workspaceId);
    const index = ws.layers.findIndex((l) => l.id === layerId);
    if (index < 0 || ws.layers[index].labelDisplay) continue;
    const aboveStatistic = ws.layers.slice(0, index).some((l) => isStatistic(l.id));
    if (!aboveStatistic) continue;
    viewStore.setViewState((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.labelDisplay = 'outline';
      layer.outline = { ...(layer.outline ?? DEFAULT_LABEL_OUTLINE), enabled: true, selectedLabelId: 0 };
    }, workspaceId);
  }
}

function layerExists(layerId: string): boolean {
  return useLayerStore.getState().layers.some((l) => l.id === layerId);
}

/** tauri-plugin-fs reports a missing file as an OS "not found" error. */
export function isMissingFileError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /os error 2\b|no such file|not found|cannot find/i.test(text);
}

let instance: LabelTableService | null = null;

export function getLabelTableService(): LabelTableService {
  if (!instance) {
    instance = new LabelTableService();
    const service = instance;
    // A removed layer gives its colormap slot back to the pool.
    getEventBus().on('layer.removed', ({ layerId }) => service.pool.release(layerId));
  }
  return instance;
}
