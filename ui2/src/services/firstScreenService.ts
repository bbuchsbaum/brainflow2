/**
 * First screen (qa-features-2026-10-31 §7). With no restored session, the
 * default view opens on the MNI152NLin2009cAsym T1 with the crosshair at the
 * origin and a quiet "Drop a map here" hint that goes away after the first
 * load.
 *
 * - The T1 comes from the template cache (1 mm when cached, else 2 mm).
 * - With neither cached, the 2 mm T1 (about 2 MB) downloads in the background
 *   with a status hint that never blocks; it is shown only if the view is
 *   still empty when it arrives.
 * - Settings › Start turns it off (`layoutSettingsStore.firstScreenTemplate`).
 * - At a cold start GoldenLayoutRoot starts it for the default view it
 *   created. A restored launch brings the tabs back but no layers, so it
 *   runs there too, in the front volume view (`restoredLaunchFirstScreenTarget`).
 */

import { create } from 'zustand';

import { useLayerStore } from '@/stores/layerStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { addLogEntry } from '@/stores/logStore';
import { resolveActiveDisplayMode } from '@/components/ui/displayModeSelector.helpers';
import type { WorkspaceType } from '@/types/workspace';

/** In order of preference; the last one is the one downloaded when none is cached. */
export const FIRST_SCREEN_TEMPLATES = [
  'MNI152NLin2009cAsym_T1w_1mm',
  'MNI152NLin2009cAsym_T1w_2mm',
] as const;
const DOWNLOAD_TEMPLATE = FIRST_SCREEN_TEMPLATES[FIRST_SCREEN_TEMPLATES.length - 1];
/** A download still running after this long gets the status hint. */
export const DOWNLOAD_HINT_DELAY_MS = 250;

export type FirstScreenPhase =
  /** Not running, or turned off. */
  | 'idle'
  /** Loading the cached T1. */
  | 'loading'
  /** Fetching the T1 in the background. */
  | 'downloading'
  /** The T1 is shown; the drop hint is up until the first load. */
  | 'shown'
  /** Over: the user loaded something, or it could not run. */
  | 'done';

interface FirstScreenState {
  phase: FirstScreenPhase;
  /** The default view it runs in (the hint shows only there). */
  workspaceId: string | null;
  /** Layers present once the T1 was shown; any other layer ends the first screen. */
  templateLayerIds: string[];
  setPhase: (phase: FirstScreenPhase) => void;
  begin: (workspaceId: string) => void;
  show: (templateLayerIds: string[]) => void;
}

export const useFirstScreenStore = create<FirstScreenState>((set, get) => ({
  phase: 'idle',
  workspaceId: null,
  templateLayerIds: [],
  setPhase: (phase) => {
    if (get().phase !== phase) set({ phase });
  },
  begin: (workspaceId) => set({ phase: 'loading', workspaceId, templateLayerIds: [] }),
  show: (templateLayerIds) => set({ phase: 'shown', templateLayerIds }),
}));

export interface FirstScreenBackend {
  /** Whether the template file is in the cache now (no download). */
  isCached(templateId: string): Promise<boolean>;
  /**
   * Download the template into the cache, without loading it. False when
   * this host cannot download (the dev harness): the first screen then stays
   * empty, silently.
   */
  cacheTemplate(templateId: string): Promise<boolean>;
  /** Load the template as a layer of the current view. */
  loadTemplate(templateId: string): Promise<void>;
  /** Put the crosshair at world (0, 0, 0). */
  crosshairToOrigin(): void;
}

export type FirstScreenOutcome = 'shown' | 'skipped' | 'superseded' | 'failed';

/**
 * Still the empty default view the first screen was started for: the switch
 * is on, nothing is loaded or loading, and the view is still open. "Loading"
 * includes the loading queue: a file's layer only appears in the layer store
 * after its I/O (review M2).
 */
export function firstScreenStillApplies(workspaceId: string): boolean {
  if (!useLayoutSettingsStore.getState().firstScreenTemplate) return false;
  const layers = useLayerStore.getState();
  if (layers.layers.length > 0 || layers.loadingLayers.size > 0) return false;
  const queue = useLoadingQueueStore.getState();
  if (queue.activeLoads.size > 0 || queue.queue.length > 0) return false;
  return useWorkspaceStore.getState().workspaces.has(workspaceId);
}

/**
 * Whether a launch gets the first screen: nothing the user made was
 * restored. The app's own empty default view does not count (QA 2026-10-31
 * N4: closing the last tab made one, so the next launch always looked
 * restored); any other tab, or a surface placeholder, does.
 */
export function firstScreenAppliesAtLaunch(restored: {
  restoredWorkspaces: number | Iterable<{ defaultView?: boolean }>;
  restoredSurfaceTabs: boolean;
}): boolean {
  if (restored.restoredSurfaceTabs) return false;
  if (typeof restored.restoredWorkspaces === 'number') return restored.restoredWorkspaces === 0;
  return [...restored.restoredWorkspaces].every((workspace) => workspace.defaultView === true);
}

/**
 * Where the first screen runs after a RESTORED launch (QA 2026-10-31 N21):
 * relaunch brings back the user's tabs but not their scene (layers are not
 * persisted across launches; see `workspaceRestorePolicy.ts`), so the
 * restored views open empty. With nothing loaded, the front tab gets the MNI
 * anatomy once it is a volume view (Orthogonal, Mosaic, Compare,
 * Integrated): now, or when the user first switches to one. A tool tab
 * (Set studio, BIDS, a module) never does. Null: not here.
 */
export function restoredLaunchFirstScreenTarget(
  front: { id: string; type: WorkspaceType } | null | undefined,
): string | null {
  if (!front || !resolveActiveDisplayMode(front.type)) return null;
  if (sceneHasContent()) return null;
  return front.id;
}

/** Anything loaded or loading: a volume layer, a surface, or a queued open. */
export function sceneHasContent(): boolean {
  const layers = useLayerStore.getState();
  if (layers.layers.length > 0 || layers.loadingLayers.size > 0) return true;
  const queue = useLoadingQueueStore.getState();
  if (queue.activeLoads.size > 0 || queue.queue.length > 0) return true;
  return useSurfaceStore.getState().surfaces.size > 0;
}

/** The layer `templateId` added, when it is the only new one since `before`. */
function onlyNewTemplateLayer(before: ReadonlySet<string>, templateId: string): string | null {
  const { layers, layerMetadata } = useLayerStore.getState();
  const added = layers.filter((layer) => !before.has(layer.id));
  if (added.length !== 1) return null;
  const [layer] = added;
  const source =
    (layer as { sourcePath?: string }).sourcePath ?? layerMetadata.get(layer.id)?.sourcePath;
  return source === `template:${templateId}` ? layer.id : null;
}

async function firstCachedTemplate(backend: FirstScreenBackend): Promise<string | null> {
  for (const id of FIRST_SCREEN_TEMPLATES) {
    try {
      if (await backend.isCached(id)) return id;
    } catch {
      // An unknown id or a backend without the field: try the next one.
    }
  }
  return null;
}

/** Run the first screen in `workspaceId`, the default view of a cold start. */
export async function runFirstScreen(
  workspaceId: string,
  backend: FirstScreenBackend,
): Promise<FirstScreenOutcome> {
  const store = useFirstScreenStore.getState();
  if (!firstScreenStillApplies(workspaceId)) return 'skipped';
  store.begin(workspaceId);

  let templateId = await firstCachedTemplate(backend);
  if (!templateId) {
    try {
      const caching = backend.cacheTemplate(DOWNLOAD_TEMPLATE);
      // The status hint is for a real download: a host that answers at once
      // (cached meanwhile, or one that cannot download) never flashes it.
      const settled = await Promise.race([
        caching.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), DOWNLOAD_HINT_DELAY_MS)),
      ]);
      if (!settled) useFirstScreenStore.getState().setPhase('downloading');
      if (!(await caching)) {
        useFirstScreenStore.getState().setPhase('done');
        return 'skipped';
      }
      templateId = DOWNLOAD_TEMPLATE;
    } catch (error) {
      // Offline, or TemplateFlow unreachable: stay quiet, keep the empty view.
      addLogEntry({
        level: 'warn',
        source: 'template',
        message: `The MNI template could not be downloaded for the first screen: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      useFirstScreenStore.getState().setPhase('done');
      return 'failed';
    }
  }

  // The user may have loaded something while it was fetched: never add the
  // template under (or over) their data. The template loads into the front
  // tab, so that must still be this view.
  if (
    !firstScreenStillApplies(workspaceId) ||
    useWorkspaceStore.getState().activeWorkspaceId !== workspaceId
  ) {
    useFirstScreenStore.getState().setPhase('done');
    return 'superseded';
  }
  useFirstScreenStore.getState().setPhase('loading');
  const before = new Set(useLayerStore.getState().layers.map((layer) => layer.id));
  try {
    await backend.loadTemplate(templateId);
  } catch {
    useFirstScreenStore.getState().setPhase('done');
    return 'failed';
  }
  // Only the T1 arrived: the first screen is on. Anything else arrived with
  // it (a file the user opened meanwhile): no hint and the crosshair stays.
  const templateLayerId = onlyNewTemplateLayer(before, templateId);
  if (!templateLayerId || useLayerStore.getState().layers.length !== before.size + 1) {
    useFirstScreenStore.getState().setPhase('done');
    return useLayerStore.getState().layers.length > before.size ? 'superseded' : 'failed';
  }
  backend.crosshairToOrigin();
  useFirstScreenStore.getState().show([templateLayerId]);
  return 'shown';
}

/** The app's backend: the template commands, TemplateService and the crosshair. */
export async function defaultFirstScreenBackend(): Promise<FirstScreenBackend> {
  const [{ invokeBackend }, { getTemplateService }, { getCrosshairService }] = await Promise.all([
    import('@/services/transport'),
    import('@/services/TemplateService'),
    import('@/services/CrosshairService'),
  ]);
  return {
    isCached: async (templateId) => {
      const entry = await invokeBackend<{ is_cached?: boolean } | null>('get_template_entry', {
        templateId,
      });
      return Boolean(entry?.is_cached);
    },
    cacheTemplate: async (templateId) =>
      (await invokeBackend<boolean | null>('cache_template', { templateId })) !== false,
    // Not the user's request: no toast (the Log keeps its line).
    loadTemplate: (templateId) => getTemplateService().loadTemplateById(templateId, { quiet: true }),
    crosshairToOrigin: () => getCrosshairService().setCrosshair([0, 0, 0]),
  };
}
