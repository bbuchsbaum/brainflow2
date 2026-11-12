import { getFileLoadingService } from '@/services/FileLoadingService';
import { getLayerService } from '@/services/LayerService';
import { getTemplateService } from '@/services/TemplateService';
import { planLayerPlacement } from '@/services/layerPlacement';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SpatialFieldSetSummary } from '@/types/studio';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { markStudioMemberLoad } from './studioMemberLoads';
import {
  studioMapOpacity,
  onStudioPopulationScale,
  clearStudioPopulationScales,
  sameAlphaMod,
  sameStudioWindow,
  studioMapDisplay,
  studioMemberKind,
  studioPopulationScale,
  studioWindowLimit,
  type StudioMapKind,
  type StudioMapWindow,
} from './studioMapDisplay';
import { fetchStudioRobustLimit } from './studioMapLimit';
import { requestStudioPopulationScale } from './PopulationSliceService';

/**
 * How long a member waits for its set's population limit (measured when
 * Population has not drawn yet) before it is drawn on its own robust scale;
 * a limit that comes later re-scales it (`applyPopulationScale`).
 */
export const POPULATION_SCALE_WAIT_MS = 1500;

/** The Studio is the active mode right now. */
function isStudioActive(): boolean {
  return useAppModeStore.getState().mode === 'studio';
}

type LayerStoreState = ReturnType<typeof useLayerStore.getState>;

/** What became of a background request (see `syncBackground`). */
export interface StudioBackgroundResult {
  /**
   * `ready`: the template's layer is loaded. `none`: no background wanted.
   * `failed`: it could not be loaded. `stale`: a later request, or leaving
   * the Studio, replaced this one, and nothing of it remains.
   */
  status: 'ready' | 'none' | 'failed' | 'stale';
  sourcePath: string | null;
  layerId?: string;
}

/**
 * The layer loaded from `sourcePath`, if any (a store selector). The layer
 * store is global; the views draw one workspace's layers. With `inView` (the
 * ids of the active view's layers) only a layer that view draws is found: a
 * copy open in another tab is not one the Studio can show (review item 2).
 */
export function findLayerIdForSourcePath(
  state: Pick<LayerStoreState, 'layers' | 'layerMetadata'>,
  sourcePath: string | null | undefined,
  inView?: ReadonlySet<string> | null,
): string | null {
  const path = sourcePath?.trim();
  if (!path) return null;
  const matchingLayer = state.layers.find((layer) => {
    if (inView && !inView.has(layer.id)) return false;
    const metadata = state.layerMetadata.get(layer.id);
    return metadata?.sourcePath === path || layer.sourcePath === path;
  });
  return matchingLayer?.id ?? null;
}

/** The ids of the layers the active view draws. */
function activeViewLayerIds(): Set<string> {
  return new Set(useViewStateStore.getState().viewState.layers.map((layer) => layer.id));
}

/** The workspace whose view is in front: the Studio's, while it is active. */
function activeWorkspaceKey(): string {
  return useViewStateStore.getState().activeWorkspaceKey;
}

/**
 * The layers one workspace's view draws, whichever tab is in front now. A
 * load puts its layer in the view of the workspace it started in, and the
 * Studio's writes belong to the Studio's view: neither may follow the user to
 * another tab.
 */
function workspaceViewLayers(workspaceKey: string) {
  return useViewStateStore.getState().workspaceViewStates.get(workspaceKey)?.layers ?? [];
}

export class StudioDisplayService {
  private static instance: StudioDisplayService | null = null;
  /**
   * Loads in flight, per source path: a second request for the same path
   * joins the first. One slot for all paths let a load of another path
   * clear it, so the first path loaded twice (QA F44).
   */
  private readonly inFlight = new Map<string, Promise<string | null>>();
  /**
   * Layers the Studio loaded to display its members. They belong to the
   * Studio session: leaving the Studio removes them, so a member such as
   * "Faces beta (sub-01)" never stays in the imaging scene (QA §11).
   */
  private readonly owned = new Set<string>();
  /** Visibility of user layers the Studio changed, restored on release. */
  private readonly userVisibility = new Map<string, boolean>();
  /** Bumped by release, so a load can tell it outlived its session. */
  private session = 0;
  /** The release in progress: a quick re-entry waits for it. */
  private releasing: Promise<void> | null = null;
  /** The member layer shown last, which keeps the selection and readouts. */
  private displayedMemberLayerId: string | null = null;
  /** The latest member display, which a background load waits behind. */
  private memberDisplay: Promise<void> | null = null;
  /**
   * Bumped per display request (and by release): only the latest one shows.
   * Set members and other sources (an artifact opened from the inspector or
   * the Compare panes) are counted apart, so opening an artifact does not
   * supersede the member still downloading for the Deck.
   */
  private displayRequest = { member: 0, source: 0 };
  /**
   * Member layers whose opacity the Studio set: the value it wrote, and for
   * a layer the user had before the Studio, what it had (`prior`), so that
   * leaving the background or the Studio puts it back exactly. A layer whose
   * opacity no longer equals `applied` was changed by hand and is left alone.
   * `workspaceKey` is the view the value was written in (the Studio's): it is
   * read and restored there, also once another tab is in front.
   */
  private readonly memberOpacity = new Map<
    string,
    {
      applied: number;
      prior: { view: number; props: number | undefined } | null;
      workspaceKey: string;
    }
  >();
  /**
   * Member layers drawn by the Studio's map rule (studioMapDisplay.ts): the
   * display the Studio wrote last. A layer whose display no longer equals
   * `applied` was changed by hand (Inspector), and the Studio writes no
   * default over it; it is not an entry once a user's display was carried to
   * it. `workspaceKey` is the view it was written in (the Studio's).
   */
  private readonly styled = new Map<string, { applied: StudioMapWindow; workspaceKey: string }>();
  /**
   * Member layers that have been on display this session. Only such a layer
   * (or one the user opened) hands its display to the next member: a Studio
   * layer still as its load left it (a load a later request overtook) holds
   * nobody's choice.
   */
  private readonly presented = new Set<string>();
  /**
   * Robust window ends of Studio members, by layer (null: no histogram, the
   * rule then uses the data's own extreme). Asked for once per layer.
   */
  private readonly memberLimits = new Map<string, number | null>();
  /**
   * The robust window end of the group mean beside the member (Compare pane
   * B), while that pane shares the member's scale: the member's default
   * window is at least this wide, so one window serves both.
   */
  private compareMeanLimit: number | null = null;
  /** The source path each member layer was asked for by: its set's population scale. */
  private readonly memberSources = new Map<string, string>();
  /** The set each member layer is shown for: its population limit is keyed by it. */
  private readonly memberSets = new Map<string, string>();
  /** The background asked for last, and what became of it. */
  private background: { desired: string | null; run: Promise<StudioBackgroundResult> | null } = {
    desired: null,
    run: null,
  };
  /** Bumped per background request (and by release): older ones are stale. */
  private backgroundRequest = 0;
  /** Background layers this session loaded, by source path. */
  private readonly backgroundLayers = new Map<string, string>();
  /** The background layer in use: member visibility syncing leaves it alone. */
  private backgroundLayerId: string | null = null;
  /**
   * "Open in viewer" keeps the Studio's layers while its viewer tab is in
   * front (`openInViewerTab`): leaving the Studio for that tab defers the
   * release, so coming back neither reloads nor re-fetches the members.
   * Any other tab in front, or the Studio's tab closed, runs the release.
   */
  private awayHold: {
    studioId: string;
    /** Null while the viewer tab is being made. */
    viewerId: string | null;
    unsubscribe: (() => void) | null;
  } | null = null;

  /** Measures the active set's population limit (replaced in tests). */
  populationScaleSource: (workspaceKey: string) => Promise<number | null> =
    requestStudioPopulationScale;

  static getInstance(): StudioDisplayService {
    if (!StudioDisplayService.instance) {
      StudioDisplayService.instance = new StudioDisplayService();
      // A population limit drawn after the member was shown (the Population
      // lens ran later) re-scales a member still at its default.
      onStudioPopulationScale(() => StudioDisplayService.instance?.applyPopulationScale());
    }
    return StudioDisplayService.instance;
  }

  async ensureMemberDisplayed(
    activeSet: SpatialFieldSetSummary | null,
    memberId: string | null
  ): Promise<void> {
    if (!activeSet || !memberId) {
      return;
    }

    const member = activeSet.memberSummaries.find((candidate) => candidate.id === memberId);
    const sourcePath = member?.sourcePath?.trim();
    if (!sourcePath) {
      return;
    }

    const managedPaths = activeSet.memberSummaries
      .map((candidate) => candidate.sourcePath?.trim() ?? '')
      .filter((path): path is string => path.length > 0);
    const run = this.displaySourcePath(sourcePath, managedPaths, member?.id, 'member', activeSet.id);
    this.memberDisplay = run;
    await run;
  }

  ensureSourcePathDisplayed(
    sourcePath: string,
    managedSourcePaths: string[] = [],
    memberLabel?: string | null
  ): Promise<void> {
    const run = this.displaySourcePath(
      sourcePath,
      managedSourcePaths,
      memberLabel,
      'source',
      useSetStudioStore.getState().selection.activeSetId,
    );
    this.memberDisplay = run;
    return run;
  }

  private async displaySourcePath(
    sourcePath: string,
    managedSourcePaths: string[],
    memberLabel: string | null | undefined,
    kind: 'member' | 'source',
    /** The set the source is shown as a member of (its population limit applies). */
    setId: string | null = null
  ): Promise<void> {
    const normalizedPath = this.normalizePath(sourcePath);
    if (!normalizedPath) {
      return;
    }

    // The latest request wins (review item 4): a slow load that finishes
    // after a later member was asked for stays loaded, but must not hide
    // that member or take the selection from it. Members and other sources
    // are counted apart (see `displayRequest`).
    const request = ++this.displayRequest[kind];
    const previous = this.visibleManagedLayerId(managedSourcePaths);
    // The Studio's view, read before any wait: the member's default display
    // is written there also when another workspace tab is in front by then.
    const workspaceKey = activeWorkspaceKey();
    const layerId = await this.ensureLayerLoaded(normalizedPath, 'default', memberLabel);
    if (!layerId) {
      return;
    }
    if (request !== this.displayRequest[kind]) {
      this.shelveSupersededMember(layerId);
      return;
    }
    this.memberSources.set(layerId, normalizedPath);
    if (setId) this.memberSets.set(layerId, setId);
    else this.memberSets.delete(layerId);

    // The robust window end of a member the rule draws, before anything is
    // written: one write, and no window sized to the noise meanwhile. A
    // member of a set is drawn on the set's population limit, measured now
    // when the Population lens has not drawn it (one map, one scale).
    const scale = setId ? this.preparePopulationScale(layerId, setId, workspaceKey) : null;
    const own = this.prepareMemberLimit(layerId);
    const limit = own || scale ? Promise.all([own, scale]) : null;
    if (limit) {
      const session = this.session;
      await limit;
      // The Studio was left, or a later member asked for, while that ran.
      if (session !== this.session) return;
      if (request !== this.displayRequest[kind]) {
        this.shelveSupersededMember(layerId);
        return;
      }
    }

    // Deck cards share one scale (QA F33): each member shown takes the
    // display of the member shown before it, its window widened to cover
    // both members' windows at both ends, so stepping compares like with like.
    this.styleMember(previous && previous !== layerId ? previous : null, layerId, workspaceKey);
    this.syncSourcePathVisibility(managedSourcePaths, layerId);
    this.displayedMemberLayerId = layerId;
    this.syncMemberOpacity(layerId);
    useLayerStore.getState().selectLayer(layerId);
  }

  /**
   * A member that finished loading after a later one was asked for: it
   * stays loaded for the next visit, hidden, and gives back a selection its
   * load took. The member on display is not touched.
   */
  private shelveSupersededMember(layerId: string): void {
    const displayed = this.displayedMemberLayerId;
    if (layerId === displayed || layerId === this.backgroundLayerId) return;
    if (!this.owned.has(layerId)) return;
    const layerState = useLayerStore.getState();
    const layer = layerState.layers.find((candidate) => candidate.id === layerId);
    if (layer?.visible) getLayerService().toggleVisibility(layerId, false);
    if (displayed && layerState.selectedLayerId === layerId) layerState.selectLayer(displayed);
  }

  /**
   * The opacity a member is drawn with (review item 1): one rule for every
   * member the Studio shows, whenever it was loaded. Over a background it is
   * the start opacity the stack rule gives that image opened on the
   * template alone (layerPlacement.ts: a continuous image is translucent, a
   * statistic opaque). With no background a Studio-loaded member is opaque
   * (it is shown alone) and a layer the user had keeps what it had.
   */
  private syncMemberOpacity(layerId: string): void {
    const background = this.backgroundLayerId;
    if (layerId === background) return;
    const entry = this.memberOpacity.get(layerId);
    const workspaceKey = entry?.workspaceKey ?? activeWorkspaceKey();
    const viewLayer = workspaceViewLayers(workspaceKey).find(
      (candidate) => candidate.id === layerId,
    );
    if (!viewLayer) return;
    const current = viewLayer.opacity;
    // Changed by hand since the Studio set it: the user's value stands.
    if (entry && current !== entry.applied) return;
    const owned = this.owned.has(layerId);
    if (!background) {
      if (entry?.prior) {
        this.writeMemberOpacity(layerId, workspaceKey, entry.prior.view, entry.prior.props);
        this.memberOpacity.delete(layerId);
      } else if (owned) {
        // A signed map keeps its opacity ramp's peak (studioMapDisplay.ts).
        const alone = this.isStudioMap(layerId) ? studioMapOpacity(this.styled.get(layerId)?.applied) : 1;
        this.writeMemberOpacity(layerId, workspaceKey, alone, alone);
        this.memberOpacity.set(layerId, { applied: alone, prior: null, workspaceKey });
      }
      return;
    }
    const target = this.opacityOverBackground(layerId, background);
    const prior =
      entry?.prior ??
      (owned
        ? null
        : {
            view: current,
            props: useLayerStore.getState().layerMetadata.get(layerId)?.renderProps?.opacity,
          });
    // A user layer already at the rule's value is not the Studio's to restore.
    if (!entry && !owned && current === target) return;
    this.writeMemberOpacity(layerId, workspaceKey, target, target);
    this.memberOpacity.set(layerId, { applied: target, prior, workspaceKey });
  }

  /** Re-apply the member rule after the background came, went or failed. */
  private syncAllMemberOpacity(): void {
    const ids = new Set(this.memberOpacity.keys());
    if (this.displayedMemberLayerId) ids.add(this.displayedMemberLayerId);
    ids.forEach((layerId) => this.syncMemberOpacity(layerId));
  }

  /** The stack rule's start opacity for `layerId` opened on the background alone. */
  private opacityOverBackground(layerId: string, backgroundLayerId: string): number {
    const { layers, layerMetadata } = useLayerStore.getState();
    const member = layers.find((layer) => layer.id === layerId);
    const background = layers.find((layer) => layer.id === backgroundLayerId);
    if (!member || !background) return 1;
    // A map the rule draws is opaque over the template, as the computed
    // panes draw theirs: its hidden band is what lets the anatomy through.
    if (this.isStudioMap(layerId)) return studioMapOpacity(this.styled.get(layerId)?.applied);
    const plan = planLayerPlacement([{ ...background, visible: true }], member, (id) =>
      layerMetadata.get(id),
    );
    return plan.opacity ?? 1;
  }

  /**
   * Set a member's opacity in the view of `workspaceKey`, and in its default
   * render properties when it has them (they agree with the view, as at load).
   */
  private writeMemberOpacity(
    layerId: string,
    workspaceKey: string,
    view: number,
    props: number | undefined,
  ): void {
    useViewStateStore.getState().setViewState((draft) => {
      const viewLayer = draft.layers.find((candidate) => candidate.id === layerId);
      if (viewLayer && viewLayer.opacity !== view) viewLayer.opacity = view;
    }, workspaceKey);
    const layerState = useLayerStore.getState();
    const metadata = layerState.layerMetadata.get(layerId);
    if (!metadata?.renderProps || props === undefined || metadata.renderProps.opacity === props)
      return;
    layerState.setLayerMetadata(layerId, {
      ...metadata,
      renderProps: { ...metadata.renderProps, opacity: props },
    });
  }

  /**
   * Give back the opacity of a layer the Studio no longer manages, in the
   * view the Studio set it in. Leaving by a workspace tab swaps the active
   * view before the release runs, so the active view is not the one to read.
   */
  private restoreMemberOpacity(layerId: string): void {
    const entry = this.memberOpacity.get(layerId);
    if (!entry) return;
    this.memberOpacity.delete(layerId);
    const { workspaceKey } = entry;
    const viewLayer = workspaceViewLayers(workspaceKey).find(
      (candidate) => candidate.id === layerId,
    );
    if (!viewLayer || viewLayer.opacity !== entry.applied) return;
    if (entry.prior)
      this.writeMemberOpacity(layerId, workspaceKey, entry.prior.view, entry.prior.props);
    else this.writeMemberOpacity(layerId, workspaceKey, 1, 1);
  }

  /**
   * Show `sourcePath` (a `template:<id>` source) beneath the Studio's member
   * views, or none for null. The template is loaded as a Studio layer,
   * released with the member layers when the Studio is left; the views draw
   * it under the member through their render scope
   * (useStudioMemberRenderScope), so the workspace's own order is not relied
   * on. The same request repeated joins the first: paging members neither
   * reloads the template nor asks again after a failure.
   *
   * The latest request wins. A template that finishes loading after another
   * was asked for, or after the Studio was left, is removed again and its
   * result is `stale`. A failed load leaves the member as it was.
   */
  syncBackground(sourcePath: string | null | undefined): Promise<StudioBackgroundResult> {
    const desired = this.normalizePath(sourcePath) || null;
    if (this.background.run && this.background.desired === desired) return this.background.run;
    this.backgroundRequest += 1;
    const request = this.backgroundRequest;
    const run: Promise<StudioBackgroundResult> = this.applyBackground(desired, request).catch(
      (error) => {
        // A throw is a failure like any other, and is not kept: asking for
        // the same template again tries again (review item 6).
        console.warn(`[StudioDisplayService] Background ${desired ?? 'none'} failed:`, error);
        if (this.background.run === run) this.background = { desired: null, run: null };
        if (request !== this.backgroundRequest) return { status: 'stale', sourcePath: desired };
        this.backgroundLayerId = null;
        this.syncAllMemberOpacity();
        return { status: desired ? 'failed' : 'none', sourcePath: desired };
      },
    );
    this.background = { desired, run };
    return run;
  }

  /**
   * Forget a background request that failed, so the same template asked for
   * again is loaded again instead of joining the failure.
   */
  retryBackground(sourcePath: string | null | undefined): Promise<StudioBackgroundResult> {
    const desired = this.normalizePath(sourcePath) || null;
    if (this.background.desired === desired && !this.backgroundLayerId) {
      this.background = { desired: null, run: null };
    }
    return this.syncBackground(desired);
  }

  private async applyBackground(
    desired: string | null,
    request: number
  ): Promise<StudioBackgroundResult> {
    const stale = () => request !== this.backgroundRequest;
    const staleResult: StudioBackgroundResult = { status: 'stale', sourcePath: desired };
    // Another background is wanted: the one in use is no longer beneath the
    // members, whoever owns it. A template the user had is not removed by
    // `dropBackgroundLayers`, so it is let go of here; were it kept, a slow
    // or failed load would leave the members translucent over nothing.
    if (this.backgroundLayerId && this.layerSourcePath(this.backgroundLayerId) !== desired) {
      this.backgroundLayerId = null;
      this.syncAllMemberOpacity();
    }
    await this.dropBackgroundLayers(desired);
    if (stale()) return staleResult;
    if (!desired) {
      this.backgroundLayerId = null;
      // Nothing beneath the members any more: each gets back what it had.
      this.syncAllMemberOpacity();
      return { status: 'none', sourcePath: null };
    }
    // The member first: an empty view takes its geometry from the first
    // layer shown, which should be the member, and the member is not held
    // up behind a template download.
    await this.memberDisplay?.catch(() => undefined);
    if (stale()) return staleResult;

    const loadedBefore = this.findLayerIdBySourcePath(desired) !== null;
    let layerId: string | null = null;
    try {
      layerId = await this.ensureLayerLoaded(desired, 'add-layer', null, { background: true });
    } catch (error) {
      console.warn(`[StudioDisplayService] Could not load background ${desired}:`, error);
    }
    if (stale()) {
      // Wanted no longer (another template, none, or the Studio was left):
      // nothing provisional stays. A later request for this same template
      // keeps the layer it joined.
      if (layerId && this.background.desired !== desired) await this.discardBackgroundLayer(layerId);
      return staleResult;
    }
    if (!layerId) {
      // Nothing is beneath the members: the template before this one was
      // dropped or let go of above, and this one did not come.
      this.backgroundLayerId = null;
      this.syncAllMemberOpacity();
      return { status: 'failed', sourcePath: desired };
    }

    // A layer this session loaded as a background is the Studio's to make
    // opaque, also when it finished loading before this request looked (its
    // first request went stale, so nobody prepared it).
    const studioBackground = this.owned.has(layerId) && layerId !== this.displayedMemberLayerId;
    if (studioBackground) this.backgroundLayers.set(desired, layerId);
    this.backgroundLayerId = layerId;
    this.prepareBackgroundLayer(layerId, !loadedBefore || studioBackground);
    this.syncAllMemberOpacity();
    return { status: 'ready', sourcePath: desired, layerId };
  }

  /**
   * A background layer is visible and opaque, and does not take the
   * selection: the member stays the active layer, so the colorbar, the
   * inspector and the status readouts keep describing it.
   */
  private prepareBackgroundLayer(layerId: string, loadedNow: boolean): void {
    const layerState = useLayerStore.getState();
    const layer = layerState.layers.find((candidate) => candidate.id === layerId);
    if (layer && !layer.visible) {
      if (!this.owned.has(layerId) && !this.userVisibility.has(layerId)) {
        this.userVisibility.set(layerId, layer.visible);
      }
      getLayerService().toggleVisibility(layerId, true);
    }
    if (!loadedNow) return;
    const member = this.displayedMemberLayerId;
    // Loaded over a visible member, the stack rule may have opened the
    // template translucent: it is the bottom of what the Studio draws.
    useViewStateStore.getState().setViewState((draft) => {
      const viewLayer = draft.layers.find((candidate) => candidate.id === layerId);
      if (viewLayer && viewLayer.opacity !== 1) viewLayer.opacity = 1;
    });
    if (!member || member === layerId) return;
    if (layerState.selectedLayerId === layerId) layerState.selectLayer(member);
  }

  /** Remove the background layers this session loaded, except `keep`'s. */
  private async dropBackgroundLayers(keep: string | null): Promise<void> {
    const drop = [...this.backgroundLayers].filter(([path]) => path !== keep);
    for (const [path] of drop) this.backgroundLayers.delete(path);
    if (drop.some(([, layerId]) => layerId === this.backgroundLayerId)) {
      this.backgroundLayerId = null;
    }
    await Promise.all(drop.map(([, layerId]) => this.discardBackgroundLayer(layerId)));
  }

  /** Remove a layer loaded as a background, unless it is the member shown. */
  private async discardBackgroundLayer(layerId: string): Promise<void> {
    if (!this.owned.has(layerId) || layerId === this.displayedMemberLayerId) return;
    this.owned.delete(layerId);
    if (!useLayerStore.getState().layers.some((layer) => layer.id === layerId)) return;
    await getLayerService()
      .removeLayer(layerId)
      .catch((error) => {
        console.warn(`[StudioDisplayService] Could not remove background ${layerId}:`, error);
      });
  }

  /** The source path of a loaded layer. */
  private layerSourcePath(layerId: string): string | null {
    const { layers, layerMetadata } = useLayerStore.getState();
    return (
      layerMetadata.get(layerId)?.sourcePath ??
      layers.find((layer) => layer.id === layerId)?.sourcePath ??
      null
    );
  }

  /** The visible layer loaded from one of `sourcePaths`, if any. */
  private visibleManagedLayerId(sourcePaths: string[]): string | null {
    const paths = new Set(sourcePaths.map((path) => path.trim()).filter(Boolean));
    if (paths.size === 0) return null;
    const { layers, layerMetadata } = useLayerStore.getState();
    const inView = activeViewLayerIds();
    const managed = layers.filter((candidate) => {
      const path = layerMetadata.get(candidate.id)?.sourcePath ?? candidate.sourcePath;
      return (
        candidate.visible &&
        inView.has(candidate.id) &&
        candidate.id !== this.backgroundLayerId &&
        !!path &&
        paths.has(path)
      );
    });
    // The member on display, when it is one of them: a superseded load may
    // have left another visible for a moment.
    const displayed = managed.find((candidate) => candidate.id === this.displayedMemberLayerId);
    return (displayed ?? managed[0])?.id ?? null;
  }

  /** The kind of map the Studio rule draws `layerId` as; null when it is not one. */
  private memberKind(layerId: string): StudioMapKind | null {
    const { layers, layerMetadata } = useLayerStore.getState();
    const layer = layers.find((candidate) => candidate.id === layerId);
    return studioMemberKind(layer, layerMetadata.get(layerId));
  }

  /**
   * Whether `layerId` is a member the Studio draws by its map rule: a layer
   * the Studio loaded (never one the user opened) that is a map, not
   * anatomy. Its opacity over a background, and the group mean beside it in
   * Compare, follow from this.
   */
  isStudioMap(layerId: string | null | undefined): boolean {
    return !!layerId && this.owned.has(layerId) && this.memberKind(layerId) !== null;
  }

  /**
   * Ask once for the robust window end of a member the rule draws; null
   * when there is nothing to wait for.
   */
  private prepareMemberLimit(layerId: string): Promise<void> | null {
    if (this.memberLimits.has(layerId) || !this.owned.has(layerId)) return null;
    const kind = this.memberKind(layerId);
    if (!kind) return null;
    const session = this.session;
    return fetchStudioRobustLimit(layerId, kind).then((limit) => {
      if (session === this.session) this.memberLimits.set(layerId, limit);
    });
  }

  /**
   * Ask for the population limit of `setId` when it has none, for a member
   * the rule draws signed; wait at most `POPULATION_SCALE_WAIT_MS`. Null
   * when there is nothing to wait for.
   */
  private preparePopulationScale(
    layerId: string,
    setId: string,
    workspaceKey: string,
  ): Promise<void> | null {
    if (!this.owned.has(layerId) || this.memberKind(layerId) === null) return null;
    if (studioPopulationScale(setId, this.memberSources.get(layerId)) !== null) return null;
    if (useSetStudioStore.getState().selection.activeSetId !== setId) return null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, POPULATION_SCALE_WAIT_MS);
    });
    return Promise.race([
      this.populationScaleSource(workspaceKey).then(() => undefined),
      waited,
    ]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  /** The display of `layerId` in the view of `workspaceKey`. */
  private viewWindow(layerId: string, workspaceKey: string): StudioMapWindow | null {
    const layer = workspaceViewLayers(workspaceKey).find((candidate) => candidate.id === layerId);
    return layer?.intensity && layer.threshold ? layer : null;
  }

  /**
   * The Studio default `layerId` still shows, untouched; null when it never
   * had one or its colour map, window or threshold was changed since.
   */
  private untouchedDefault(layerId: string): StudioMapWindow | null {
    const entry = this.styled.get(layerId);
    if (!entry) return null;
    return sameStudioWindow(this.viewWindow(layerId, entry.workspaceKey), entry.applied)
      ? entry.applied
      : null;
  }

  /**
   * The display of the member now shown, given the member shown before it.
   *
   * By default it is the Studio's map rule (studioMapDisplay.ts), the one
   * the computed panes follow: diverging and symmetric about zero for signed
   * data, sequential for nonnegative data, the band nearest zero hidden. The
   * window end is the member's robust limit, never narrower than that of the
   * member before it (Deck cards share one scale, QA F33) or of the group
   * mean beside it in Compare; a set shown diverging stays diverging for a
   * member that happens to have no negative value.
   *
   * It is a default. Once the member before this one shows a display the
   * Studio did not write (the user changed its colour map, window or
   * threshold, or it is a layer the user opened), that display is carried
   * to this member as before, and no default is written over it. A layer
   * the Studio does not own never receives a default, from the rule or
   * from another member.
   */
  private styleMember(shownBefore: string | null, layerId: string, workspaceKey: string): void {
    const previousId =
      shownBefore && (this.presented.has(shownBefore) || !this.owned.has(shownBefore))
        ? shownBefore
        : null;
    this.presented.add(layerId);
    const carried = previousId ? this.untouchedDefault(previousId) : null;
    if (previousId && !carried) {
      this.styled.delete(layerId);
      this.shareDisplay(previousId, layerId);
      return;
    }
    const kind = this.owned.has(layerId) ? this.memberKind(layerId) : null;
    if (!kind) return;
    // A member the user changed by hand on an earlier visit keeps it; one
    // still at its default keeps the scale it had reached.
    const existing = this.untouchedDefault(layerId);
    if (this.styled.has(layerId) && !existing) return;
    const reached = [carried, existing].filter((display): display is StudioMapWindow => !!display);
    const range = useLayerStore.getState().layerMetadata.get(layerId)?.dataRange;
    const signed = kind === 'diverging' || reached.some((display) => display.intensity[0] < 0);
    // A signed member of a set the Population lens has drawn takes that
    // scale (one map, one scale in every lens); otherwise its own robust one.
    const population = signed ? studioPopulationScale(this.memberSets.get(layerId), this.memberSources.get(layerId)) : null;
    const own = studioMapDisplay(range, { signed, limit: this.memberLimits.get(layerId) });
    const limit = Math.max(
      ...(population !== null
        ? [population]
        : [studioWindowLimit(own), ...reached.map(studioWindowLimit)]),
      this.compareMeanLimit ?? 0,
    );
    this.writeMemberDefault(layerId, studioMapDisplay(range, { signed, limit }), workspaceKey);
  }

  /**
   * The member on display, while it shows its signed Studio default, takes
   * its set's population limit (widened for the mean beside it, as ever).
   */
  private applyPopulationScale(): void {
    const layerId = this.displayedMemberLayerId;
    if (!layerId) return;
    const applied = this.untouchedDefault(layerId);
    if (!applied || !(applied.intensity[0] < 0)) return;
    const population = studioPopulationScale(this.memberSets.get(layerId), this.memberSources.get(layerId));
    if (population === null) return;
    const limit = Math.max(population, this.compareMeanLimit ?? 0);
    if (studioWindowLimit(applied) === limit) return;
    const range = useLayerStore.getState().layerMetadata.get(layerId)?.dataRange;
    this.writeMemberDefault(layerId, studioMapDisplay(range, { signed: true, limit }));
  }

  /** Write a Studio default and remember it as the Studio's. */
  private writeMemberDefault(
    layerId: string,
    display: StudioMapWindow,
    workspaceKey = this.styled.get(layerId)?.workspaceKey ?? activeWorkspaceKey(),
  ): void {
    const applied: StudioMapWindow = {
      colormap: display.colormap,
      intensity: [display.intensity[0], display.intensity[1]],
      threshold: [display.threshold[0], display.threshold[1]],
      // A signed map's opacity rises with |v|, as in Population.
      ...(display.alphaMod ? { alphaMod: { ...display.alphaMod } } : {}),
    };
    // Remembered first: a reader told of the write finds it the Studio's.
    this.styled.set(layerId, { applied, workspaceKey });
    useViewStateStore.getState().setViewState((draft) => {
      const layer = draft.layers.find((candidate) => candidate.id === layerId);
      if (!layer) return;
      // The applied display replaces the ramp too: a flat default removes a
      // ramp an earlier (signed) default or the loader left on the layer.
      const ramp = applied.alphaMod;
      if (ramp) {
        if (!sameAlphaMod(layer.alphaMod, ramp)) layer.alphaMod = { ...ramp };
      } else if (layer.alphaMod) {
        delete layer.alphaMod;
      }
      if (sameStudioWindow(layer, applied)) return;
      layer.colormap = applied.colormap;
      layer.intensity = [applied.intensity[0], applied.intensity[1]];
      layer.threshold = [applied.threshold[0], applied.threshold[1]];
    }, workspaceKey);
  }

  /**
   * The robust window end of the group mean that shares the member's scale
   * (Compare pane B), or null when no mean does. The member on display, if
   * it still shows its Studio default, is widened to cover it; a window is
   * not narrowed again when the mean goes, as paging never narrows one.
   */
  setCompareMeanLimit(limit: number | null): void {
    this.compareMeanLimit = limit !== null && Number.isFinite(limit) && limit > 0 ? limit : null;
    const layerId = this.displayedMemberLayerId;
    if (!this.compareMeanLimit || !layerId) return;
    const applied = this.untouchedDefault(layerId);
    if (!applied || studioWindowLimit(applied) >= this.compareMeanLimit) return;
    const range = useLayerStore.getState().layerMetadata.get(layerId)?.dataRange;
    this.writeMemberDefault(
      layerId,
      studioMapDisplay(range, { signed: applied.intensity[0] < 0, limit: this.compareMeanLimit }),
    );
  }

  /**
   * Give `toId` the threshold and colour map of `fromId`, and a window that
   * covers both layers' windows (the lower ends too).
   */
  private shareDisplay(fromId: string, toId: string): void {
    useViewStateStore.getState().setViewState((draft) => {
      const from = draft.layers.find((layer) => layer.id === fromId);
      const to = draft.layers.find((layer) => layer.id === toId);
      if (!from || !to) return;
      to.intensity = [
        Math.min(from.intensity[0], to.intensity[0]),
        Math.max(from.intensity[1], to.intensity[1]),
      ];
      to.threshold = [from.threshold[0], from.threshold[1]];
      to.colormap = from.colormap;
    });
  }

  async openComparisonForPaths(args: {
    currentSourcePath: string;
    compareSourcePath: string;
    managedCurrentSourcePaths?: string[];
    compareLabel?: string | null;
  }): Promise<void> {
    const currentSourcePath = this.normalizePath(args.currentSourcePath);
    const compareSourcePath = this.normalizePath(args.compareSourcePath);
    if (!currentSourcePath || !compareSourcePath || currentSourcePath === compareSourcePath) {
      return;
    }

    await this.ensureSourcePathDisplayed(
      currentSourcePath,
      args.managedCurrentSourcePaths ?? []
    );

    const currentLayerId = this.findLayerIdBySourcePath(currentSourcePath);
    if (!currentLayerId) {
      return;
    }

    const compareLayerId = await this.ensureLayerLoaded(
      compareSourcePath,
      'add-layer',
      args.compareLabel
    );
    if (!compareLayerId) {
      return;
    }

    // Opening a Compare view is an explicit hand-off: both layers now
    // belong to that workspace and stay when the Studio is left.
    this.adopt(currentLayerId);
    this.adopt(compareLayerId);

    const compareLayer = useLayerStore
      .getState()
      .layers.find((layer) => layer.id === compareLayerId);
    if (compareLayer && !compareLayer.visible) {
      getLayerService().toggleVisibility(compareLayerId, true);
    }

    const comparisonWorkspaceId = await this.ensureComparisonWorkspace();
    const layerNames = new Map<string, string>();
    useLayerStore.getState().layers.forEach((layer) => {
      layerNames.set(layer.id, layer.name ?? layer.id);
    });
    useComparisonStore.getState().ensurePanelsForLayers(
      comparisonWorkspaceId,
      [currentLayerId, compareLayerId],
      layerNames
    );
    useWorkspaceStore.getState().activateWorkspace(comparisonWorkspaceId);
  }

  /** The layer of `sourcePath` in the active view (not one in another tab). */
  private findLayerIdBySourcePath(sourcePath: string): string | null {
    return findLayerIdForSourcePath(useLayerStore.getState(), sourcePath, activeViewLayerIds());
  }

  private syncSourcePathVisibility(
    sourcePaths: string[],
    visibleLayerId: string
  ): void {
    const managedSourcePaths = new Set(
      sourcePaths.map((path) => path.trim()).filter((path): path is string => path.length > 0)
    );
    if (managedSourcePaths.size === 0) {
      return;
    }

    const layerState = useLayerStore.getState();
    const layerService = getLayerService();
    const inView = activeViewLayerIds();
    layerState.layers.forEach((layer) => {
      // A copy of a member open in another tab is not the Studio's to hide.
      if (!inView.has(layer.id)) return;
      const metadata = layerState.layerMetadata.get(layer.id);
      const sourcePath = metadata?.sourcePath ?? layer.sourcePath;
      if (!sourcePath || !managedSourcePaths.has(sourcePath)) {
        return;
      }

      const shouldBeVisible = layer.id === visibleLayerId;
      // The background stays as it is, even when a member has its source.
      if (layer.id === this.backgroundLayerId && !shouldBeVisible) return;
      if (layer.visible !== shouldBeVisible) {
        if (!this.owned.has(layer.id) && !this.userVisibility.has(layer.id)) {
          this.userVisibility.set(layer.id, layer.visible);
        }
        layerService.toggleVisibility(layer.id, shouldBeVisible);
      }
    });
  }

  private normalizePath(sourcePath: string | null | undefined): string {
    return sourcePath?.trim() ?? '';
  }

  private isTemplateSource(sourcePath: string): boolean {
    return sourcePath.startsWith('template:');
  }

  private async ensureLayerLoaded(
    sourcePath: string,
    intent: 'default' | 'add-layer',
    memberLabel?: string | null,
    options: { background?: boolean } = {}
  ): Promise<string | null> {
    // Re-entering the Studio while its last session's layers are being
    // removed: wait, or this would reuse a layer that is about to go.
    if (this.releasing) await this.releasing;
    const existingLayerId = this.findLayerIdBySourcePath(sourcePath);
    if (existingLayerId) {
      return existingLayerId;
    }

    const pending = this.inFlight.get(sourcePath);
    if (pending) {
      return pending;
    }

    const load = this.loadLayer(sourcePath, intent, memberLabel, options);
    this.inFlight.set(sourcePath, load);
    try {
      return await load;
    } finally {
      if (this.inFlight.get(sourcePath) === load) {
        this.inFlight.delete(sourcePath);
      }
    }
  }

  private async loadLayer(
    sourcePath: string,
    intent: 'default' | 'add-layer',
    memberLabel?: string | null,
    options: { background?: boolean } = {}
  ): Promise<string | null> {
    const session = this.session;
    // The Studio's view, where the load puts its layer. The user may have
    // another workspace tab in front by the time it finishes; looked up in
    // that tab's view the layer would not be found, and so neither owned nor
    // removed (its volume and GPU lease would never be released).
    const workspaceKey = activeWorkspaceKey();
    // The log attributes this load to the Studio member, not to a plain file
    // (a background template is logged as the template it is).
    const unmark = options.background
      ? () => undefined
      : markStudioMemberLoad(
          sourcePath,
          memberLabel?.trim() || sourcePath.split(/[\\/]/).pop() || sourcePath
        );
    // A load someone else started (the Templates menu) and this one joined
    // makes that user's layer, not a Studio one.
    let joined = false;
    try {
      if (this.isTemplateSource(sourcePath)) {
        // A background is not announced by a toast; the Background control
        // reports a failure itself.
        if (options.background) {
          const outcome = await getTemplateService().loadTemplateBySourcePath(sourcePath, {
            quiet: true,
          });
          joined = outcome?.joined === true;
        } else {
          await getTemplateService().loadTemplateBySourcePath(sourcePath);
        }
      } else {
        await getFileLoadingService().loadFile(sourcePath, 'programmatic', intent);
      }
      const layerId = findLayerIdForSourcePath(
        useLayerStore.getState(),
        sourcePath,
        new Set(workspaceViewLayers(workspaceKey).map((layer) => layer.id)),
      );
      if (!layerId) return null;
      if (session !== this.session && !isStudioActive()) {
        // The Studio was left while this loaded (and not re-entered). A load
        // the user started and this one joined made the user's layer: it
        // stays. The Studio's own is removed.
        if (!joined) {
          await getLayerService()
            .removeLayer(layerId)
            .catch((error) => {
              console.warn('[StudioDisplayService] Could not discard a late member layer:', error);
            });
        }
        return null;
      }
      if (!joined) this.owned.add(layerId);
      return layerId;
    } finally {
      unmark();
    }
  }

  /** The Studio is in front again: a deferred release is no longer wanted. */
  resumeStudio(): void {
    this.clearAwayHold();
  }

  /** Whether the Studio's layers are being kept for its viewer tab (tests, diagnostics). */
  holdingLayersForViewer(): boolean {
    return this.awayHold !== null;
  }

  private awayHoldApplies(): boolean {
    const hold = this.awayHold;
    if (!hold) return false;
    const workspaces = useWorkspaceStore.getState();
    if (!workspaces.workspaces.has(hold.studioId)) return false;
    const active = workspaces.activeWorkspaceId;
    return active === hold.studioId || hold.viewerId === null || active === hold.viewerId;
  }

  private deferReleaseWhileAway(): void {
    const hold = this.awayHold;
    if (!hold || hold.unsubscribe) return;
    hold.unsubscribe = useWorkspaceStore.subscribe(() => {
      if (this.awayHold !== hold || this.awayHoldApplies() || isStudioActive()) return;
      // Another tab is in front, or the Studio was closed: release now.
      void this.releaseStudioLayers();
    });
  }

  private clearAwayHold(): void {
    this.awayHold?.unsubscribe?.();
    this.awayHold = null;
  }

  /**
   * Open a file the Studio shows in a new viewer tab ("Orthogonal N") and
   * bring that tab to the front. The tab starts empty (not as a copy of the
   * Studio's view), receives the Studio's background template as its
   * underlay when one is shown, then the file as an ordinary layer through
   * the app's file loader, with the colour map, window and threshold the
   * Studio shows it with. The Studio's view and layers are not changed, and
   * stay loaded while this tab is in front (see `awayHold`). Returns the new
   * tab's id, or null when there is nothing to open.
   */
  async openInViewerTab(sourcePath: string | null | undefined): Promise<string | null> {
    const path = this.normalizePath(sourcePath ?? '');
    if (!path) return null;
    const studioId = useWorkspaceStore.getState().activeWorkspaceId;
    const studioKey = activeWorkspaceKey();
    const studioLayers = workspaceViewLayers(studioKey);
    const inStudio = new Set(studioLayers.map((layer) => layer.id));
    const shownId = findLayerIdForSourcePath(useLayerStore.getState(), path, inStudio);
    const shown = shownId ? studioLayers.find((layer) => layer.id === shownId) : null;
    const display = shown
      ? {
          colormap: shown.colormap,
          intensity: [shown.intensity[0], shown.intensity[1]] as [number, number],
          threshold: [shown.threshold[0], shown.threshold[1]] as [number, number],
        }
      : null;
    const backgroundPath =
      this.backgroundLayerId && inStudio.has(this.backgroundLayerId)
        ? this.background.desired
        : null;

    if (studioId && isStudioActive()) {
      this.clearAwayHold();
      this.awayHold = { studioId, viewerId: null, unsubscribe: null };
    }
    const hold = this.awayHold;
    let viewerId: string;
    try {
      viewerId = await useWorkspaceStore.getState().createWorkspace('orthogonal-locked');
    } catch (error) {
      if (this.awayHold === hold && hold) {
        hold.viewerId = studioId ?? '';
        if (!isStudioActive()) void this.releaseStudioLayers();
      }
      throw error;
    }
    if (hold && this.awayHold === hold) hold.viewerId = viewerId;
    // A new tab is seeded with the view in front; this one starts empty.
    useViewStateStore.getState().setViewState((draft) => {
      draft.layers = [];
    }, viewerId);

    if (backgroundPath) {
      if (this.isTemplateSource(backgroundPath))
        await getTemplateService().loadTemplateBySourcePath(backgroundPath, { quiet: true });
      else await getFileLoadingService().loadFile(backgroundPath, 'programmatic', 'add-layer', viewerId);
    }
    await getFileLoadingService().loadFile(path, 'programmatic', 'add-layer', viewerId);
    if (display) {
      const opened = findLayerIdForSourcePath(
        useLayerStore.getState(),
        path,
        new Set(workspaceViewLayers(viewerId).map((layer) => layer.id)),
      );
      if (opened)
        useViewStateStore.getState().setViewState((draft) => {
          const layer = draft.layers.find((candidate) => candidate.id === opened);
          if (!layer) return;
          layer.colormap = display.colormap;
          layer.intensity = [display.intensity[0], display.intensity[1]];
          layer.threshold = [display.threshold[0], display.threshold[1]];
        }, viewerId);
    }
    return viewerId;
  }

  /** Keep a Studio-loaded layer after the Studio is left. */
  adopt(layerId: string): void {
    // It leaves with the opacity it would have without the Studio.
    this.restoreMemberOpacity(layerId);
    this.owned.delete(layerId);
    this.userVisibility.delete(layerId);
    // It keeps the display it shows; the Studio no longer writes to it.
    this.styled.delete(layerId);
    this.presented.delete(layerId);
    this.memberLimits.delete(layerId);
    this.memberSources.delete(layerId);
    this.memberSets.delete(layerId);
  }

  /** Whether the Studio session owns `layerId` (tests, diagnostics). */
  ownsLayer(layerId: string): boolean {
    return this.owned.has(layerId);
  }

  /**
   * Leaving the Studio: remove the layers it loaded (full teardown through
   * the layer service) and restore the visibility of user layers it hid.
   */
  releaseStudioLayers(): Promise<void> {
    if (this.awayHold && this.awayHoldApplies()) {
      this.deferReleaseWhileAway();
      return Promise.resolve();
    }
    this.clearAwayHold();
    const run = this.releaseOnce();
    this.releasing = run;
    return run.finally(() => {
      if (this.releasing === run) this.releasing = null;
    });
  }

  private async releaseOnce(): Promise<void> {
    this.session += 1;
    // Background requests in flight are stale; its layers go with the rest.
    this.backgroundRequest += 1;
    this.background = { desired: null, run: null };
    this.backgroundLayers.clear();
    this.backgroundLayerId = null;
    this.displayedMemberLayerId = null;
    this.memberDisplay = null;
    // Only layers the Studio loaded were given its default, and they are
    // removed below: no display is left to put back.
    this.styled.clear();
    this.presented.clear();
    this.memberLimits.clear();
    this.memberSources.clear();
    this.memberSets.clear();
    // The session's population limits go with it.
    clearStudioPopulationScales();
    this.compareMeanLimit = null;
    this.displayRequest.member += 1;
    this.displayRequest.source += 1;
    const owned = [...this.owned];
    this.owned.clear();
    const restore = [...this.userVisibility];
    this.userVisibility.clear();
    // User layers get back the opacity they had; Studio layers are removed.
    for (const layerId of [...this.memberOpacity.keys()]) {
      if (owned.includes(layerId)) this.memberOpacity.delete(layerId);
      else this.restoreMemberOpacity(layerId);
    }

    const layerService = getLayerService();
    const present = new Set(useLayerStore.getState().layers.map((layer) => layer.id));
    for (const [layerId, visible] of restore) {
      const layer = useLayerStore.getState().getLayer(layerId);
      if (layer && layer.visible !== visible) layerService.toggleVisibility(layerId, visible);
    }
    await Promise.all(
      owned
        .filter((layerId) => present.has(layerId))
        .map((layerId) =>
          layerService.removeLayer(layerId).catch((error) => {
            console.warn(`[StudioDisplayService] Could not remove Studio layer ${layerId}:`, error);
          }),
        ),
    );
  }

  private async ensureComparisonWorkspace(): Promise<string> {
    const workspaceStore = useWorkspaceStore.getState();
    const existing = Array.from(workspaceStore.workspaces.values()).find(
      (workspace) => workspace.type === 'comparison'
    );

    if (existing) {
      workspaceStore.activateWorkspace(existing.id);
      return existing.id;
    }

    return workspaceStore.createWorkspace('comparison');
  }
}

let instance: StudioDisplayService | null = null;

export function getStudioDisplayService(): StudioDisplayService {
  if (!instance) {
    instance = StudioDisplayService.getInstance();
  }
  return instance;
}
