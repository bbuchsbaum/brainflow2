import { useStudioMapSliceKeys } from '@/hooks/useStudioMapSliceKeys';
import { useStudioInFront, useStudioWorkspaceKey } from '@/hooks/useStudioWorkspace';
import { useMirrorsView } from '@/stores/viewDisplaySettingsStore';
import { Button, IconButton, Pager, Select, Tabs } from '@/components/ui/bf';
import { inferenceChannelNames, inferenceChannel } from '@/services/studio/inferenceCatalog';
import {
  inferenceOperandsCurrent,
  selectInferenceChannel,
} from '@/services/studio/populationInference';
import { openDockTab } from '@/components/layout/openDockTab';
import { POPULATION_VALUES_TAB } from './populationDock';
import { SimilarityStrip } from './SimilarityStrip';
import { similarityGroupingView } from '@/services/studio/similarityGroupingView';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import {
  EXPLORATORY_LABEL,
  EXPLORATORY_REASON,
  isExploratorySelection,
  selectionFromDataOrder,
} from './exploratorySelection';
import {
  populationAnatomyStatus,
  populationCountsSummary,
  populationDiverging,
  populationHiddenBand,
  populationSharesEffectScale,
  POPULATION_CUTOUT_MAX_DIM,
  POPULATION_CUTOUT_NATIVE,
  POPULATION_CUTOUT_VALUE_BUDGET,
} from '@/services/studio/PopulationSliceService';
import { PopulationColorbar } from './PopulationColorbar';
import { PopulationIssueNotice } from './PopulationIssueNotice';
import { StudioToolbarMore, StudioToolbarPortal } from './StudioToolbarSlot';
import {
  STUDIO_MIN_VIEW_PX,
  StudioMenuDataSlotContext,
  StudioMenuSlotContext,
  StudioProvenanceSlotContext,
  StudioToolbarSlotContext,
  StudioViewportHeightContext,
  StudioViewSlotContext,
} from './studioToolbarSlots';
import { populationLensMemory } from './populationLensMemory';
import {
  populationRelationshipService,
  relationshipSource,
} from '@/services/studio/PopulationRelationshipService';
import { PopulationGroupViews } from './PopulationGroupViews';
import { ALL_CARD_STATISTICS, allCardStatistic, positiveFractionTick } from './summaryCards';
import { comparableGroups, unassignedGroup } from '@/services/studio/populationGroups';
import { PopulationNavigation } from './PopulationNavigation';
import { PopulationExportControls } from './PopulationExportControls';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import {
  populationArrangementLabel,
  populationBindingKey,
  populationOrderSourceStatus,
} from '@/services/studio/populationWitnesses';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ReusableSliceViewport,
  SliceViewerImageSurface,
  clientPointToWorld,
  type SliceViewerPlacement,
} from '@/components/views/sliceViewer';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { getLineDash } from '@/utils/crosshairUtils';
import { PopulationCutoutGrid } from './PopulationCutoutGrid';
import { PopulationMontage } from './PopulationMontage';
import { useSubjectDifference } from './useSubjectDifference';
import {
  groupStatisticTitle,
  neighbouringSubject,
  planeValueAt,
  unitCountText,
  type SubjectPaneView,
} from './summaryPaneModel';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { limitDisplay } from './montageModel';
import { Choice as ToolbarChoiceField, MontageToolbar } from './MontageToolbar';
import { MontageFooter } from './MontageFooter';
import { createPortal } from 'react-dom';
import { useMontageArrangement } from './useMontageArrangement';
import { compareSelectionWithTheRest, sameMembers } from './inferenceDraft';
import {
  MONTAGE_PAGE_SIZE,
  clampTilesPerRow,
  defaultTilesPerRow,
  fitTilesPerRow,
  montagePageSize,
  tileWidthPx,
  tilesPerRowRange,
  groupedPages,
  resolutionNote,
  tileDrawnPixelated,
  montageFooterText,
  montageGroups,
  montageOrderLabel,
  orderByValueWithin,
  sortColumn,
  sliceReadout,
  withinPlaces,
} from './montageModel';
import { populationMemberHover } from '@/services/studio/populationMemberHover';
import {
  commonIdPrefix,
  createMontageCropMemory,
  montageLinkedId,
  montageSprites,
} from './montageTileSupport';
import { getEventBus } from '@/events/EventBus';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import {
  populationSupportKey,
  buildPopulationProbeQuery,
  PopulationProbeController,
} from '@/services/studio/PopulationProbeController';
import { resolvePopulation } from '@/services/studio/populationContext';
import { resolveStudioPopulationPreview } from '@/services/studio/observationStatus';
import {
  buildPopulationSliceQuery,
  populationSliceActions,
  populationSliceStepMm,
  populationAxisLabel,
  PopulationSliceService,
  type PopulationOrientation,
  type PopulationSummary,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import { formatWorldPoint } from '@/utils/valueFormat';
import type { MontageOption } from './montageModel';

const names: Record<PopulationSummary, string> = {
  mean: 'Mean',
  median: 'Median',
  mad: 'Median absolute deviation (unscaled)',
  sampleSd: 'Observed sample SD',
  cancellation: 'Cancellation',
  meanAbsolute: 'Mean absolute magnitude',
  coverage: 'Coverage',
  oneSampleT: 'One-sample t',
  positiveFraction: '% positive',
};

/** The summary pane shows the sign share (drawn about its even split). */
const sharePane = (result: { query: { request: PopulationSliceRequest } }) =>
  !result.query.request.inference && result.query.request.summary === 'positiveFraction';

/** Both panes use Brainflow's shared viewport geometry and image surface. The
 * service supplies visible-support bitmaps, so no global GPU layer is registered. */
const noProbeSubscription = () => () => {};
/**
 * The section's padding and border, a pane's label row, and the one footer
 * line below the maps (px): the maps and the footer fit the visible height.
 */
const POPULATION_MAP_CHROME_PX = 100;
/** The pane label row inside the chrome above (px): grouped cards draw their own. */
const GROUPED_LABEL_ROW_PX = 24;
const noProbeSnapshot = () => null;
/**
 * Sorted by the value at the probe, the montage follows the probe live: when
 * the values for a new point (the pointer, with Follow hover) have rested this
 * long, the order is taken again and the tiles glide to it.
 */
export const MONTAGE_LIVE_ORDER_SETTLE_MS = 120;
/**
 * Follow hover writes on the next animation frame: a probe written this soon
 * after the pointer left the tiles is still the tiles' own.
 */
const MONTAGE_TILE_LEAVE_GRACE_MS = 100;
/** A tile's height over its width before the first image says (MNI axial). */
const MONTAGE_DEFAULT_ASPECT = 1.2;

/** `ids` with the identity of the last equal list, so a store update that
 * changes nothing here does not re-sort, re-page or restart playback. */
function useStableIds(ids: readonly string[]): readonly string[] {
  const last = useRef(ids);
  if (
    last.current !== ids &&
    (last.current.length !== ids.length || last.current.some((id, i) => id !== ids[i]))
  )
    last.current = ids;
  return last.current;
}

export function PopulationLens({
  service: supplied,
  probeController,
}: { service?: PopulationSliceService; probeController?: PopulationProbeController } = {}) {
  const studio = useSetStudioState();
  // Bound to the Studio's own workspace: a lens left mounted behind another
  // tab must not request, jump to a peak, or move that tab's crosshair (F44).
  const workspaceId = useStudioWorkspaceKey();
  const inFront = useStudioInFront();
  const crosshair = useViewStateStore(
    (state) => state.getWorkspaceViewState(workspaceId).crosshair,
  );
  const [service] = useState(() => supplied ?? new PopulationSliceService());
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const relationshipSnapshot = useSyncExternalStore(
    populationRelationshipService.subscribe,
    populationRelationshipService.getSnapshot,
  );
  const probeSnapshot = useSyncExternalStore(
    probeController?.subscribe ?? noProbeSubscription,
    probeController?.getSnapshot ?? noProbeSnapshot,
  );
  const probeDefinition = useMemo(
    () => buildPopulationProbeQuery(studio, workspaceId),
    [studio, workspaceId],
  );
  const arrangement =
    probeSnapshot?.arrangement &&
    probeDefinition.query &&
    populationBindingKey(probeSnapshot.arrangement.query) ===
      populationBindingKey(probeDefinition.query)
      ? probeSnapshot.arrangement
      : null;
  // The values shown are those of the probe in force (the pin, else the
  // pointer while the Values tab follows it), with nothing newer on the way.
  const probeValuesReady =
    !!probeSnapshot?.displayed &&
    !probeSnapshot.pending &&
    !probeSnapshot.error &&
    probeSnapshot.displayed.query.key === probeDefinition.query?.key;
  const followHover = usePopulationViewStore((state) => state.followHover);
  const pinHeld = !!studio.population.pinnedProbe;
  // The pointer stands in for a pin only while nothing is pinned (a pin wins).
  const hoverInForce = !pinHeld && followHover && !!studio.population.hoverProbe;
  // An order by value can be taken at the pin, or at the pointer.
  const canArrange = probeValuesReady && (pinHeld || hoverInForce);
  // Reopening the lens in the same session keeps its view (QA F44: the
  // Summary fell back from Median to Mean); a new session or restore resets it.
  const remembered = populationLensMemory.recall(
    studio.population.sessionRevision,
    studio.population.restoredView,
  );
  const [orientation, setOrientation] = useState<PopulationOrientation>(
    remembered?.orientation ?? 'axial',
  );
  const [summary, setSummary] = useState<PopulationSummary>(remembered?.summary ?? 'mean');
  const [zoom, setZoom] = useState(remembered?.zoom ?? 1);
  // Hold-to-preview lives in the store as presentation state, so the values
  // table (another React root) shows the same preview.
  const withoutFocused = studio.populationPreview.holding;
  const [showCutouts, setShowCutouts] = useState(false);
  // One home for the width: the Values tab header.
  const cutoutWidth = usePopulationViewStore((state) => state.cutoutWidthMm);
  const playbackSpeed = usePopulationViewStore((state) => state.playbackSpeed);
  // The subject under the pointer in the grid, and the one on the similarity map.
  const [hoveredTile, setHoveredTile] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<string | null>(null);
  // Hover from another root (the Inspector's lists, the Values dock) marks its
  // tile even while the strip is hidden; the montage's own hover is not echoed.
  const externalHover = useSyncExternalStore(
    populationMemberHover.subscribe,
    populationMemberHover.getSnapshot,
  );
  const externalHoverId =
    externalHover.source && externalHover.source !== 'montage' ? externalHover.memberId : null;
  useEffect(() => () => populationMemberHover.set(null, 'montage'), []);
  const [cutoutPage, setCutoutPage] = useState(0);
  const [groupPage, setGroupPage] = useState(0);
  // Whole tiles per row; null until chosen, when the width decides.
  const [tilesPerRowChoice, setTilesPerRowChoice] = useState<number | null>(
    remembered?.tilesPerRow ?? null,
  );
  const [montageWidth, setMontageWidth] = useState(760);
  // The grid's visible height: with no size chosen, one shared tile size is
  // fitted so the whole page shows without scrolling.
  const [montageHeight, setMontageHeight] = useState(0);
  const tilesRange = tilesPerRowRange(montageWidth);
  // The image's own resolution along a tile's edge, as the last result reported it.
  const [nativeDim, setNativeDim] = useState<{ key: string; dim: number } | null>(null);
  useEffect(() => {
    const restored = studio.population.restoredView;
    if (populationLensMemory.recall(studio.population.sessionRevision, restored)) return;
    setOrientation(restored?.orientation ?? 'axial');
    setSummary(restored?.summary ?? 'mean');
    setZoom(restored?.zoom ?? 1);
    setShowCutouts(false);
    setCutoutPage(0);
    setGroupPage(0);
  }, [studio.population.sessionRevision, studio.population.restoredView]);
  useEffect(() => {
    populationLensMemory.remember({
      session: studio.population.sessionRevision,
      restored: studio.population.restoredView,
      orientation,
      summary,
      zoom,
      tilesPerRow: tilesPerRowChoice ?? undefined,
    });
  }, [
    studio.population.sessionRevision,
    studio.population.restoredView,
    orientation,
    summary,
    zoom,
    tilesPerRowChoice,
  ]);

  const population = useMemo(() => resolvePopulation(studio), [studio]);
  const participants = useMemo(
    () => resolvePopulationParticipants(studio, population.workingMemberIds),
    [studio, population.workingMemberIds],
  );
  const preview = useMemo(
    () => resolveStudioPopulationPreview(studio, population),
    [studio, population],
  );
  const previewParticipant = preview.participant;
  const previewSet = preview.members;
  const previewLabel = preview.label;
  // A held preview must not outlive the control that holds it. The hold is
  // global, which is safe: Set Studio is a singleton, so only one Population
  // lens exists. The chosen target deliberately persists across unmount and
  // remount (it clears only when it stops resolving or on a session reset).
  useEffect(() => () => populationProbeActions.releasePreview(), []);
  const selectedIds = useMemo(
    () => new Set(population.workingMemberIds),
    [population.workingMemberIds],
  );
  const presentation = studio.population.presentation;
  const montage = !withoutFocused && presentation.arrangement === 'montage';
  const grouped = !withoutFocused && presentation.arrangement === 'groups';
  const comparing =
    presentation.arrangement === 'comparison' || presentation.arrangement === 'difference';
  const difference = presentation.arrangement === 'difference';
  const activeTest =
    !comparing &&
    !grouped &&
    studio.population.inference?.featureId === studio.selection.activeFeatureId &&
    studio.population.inference?.setId === studio.selection.activeSetId &&
    // Shown only for the A and B it was Run on: a new selection waits for Run.
    inferenceOperandsCurrent(studio)
      ? studio.population.inference
      : null;
  const partition = studio.population.partition;
  // A fit's unassigned observations are noted, never tiled or chosen as contributors.
  const groupPages = Math.max(1, Math.ceil((partition ? comparableGroups(partition).length : 0) / 4));
  const unassigned = partition ? unassignedGroup(partition) : null;
  const currentGroupPage = Math.min(groupPage, groupPages - 1);
  const contributors =
    presentation.arrangement === 'montage'
      ? (partition ? comparableGroups(partition) : []).find(
          (g) => g.id === presentation.contributorsGroupId,
        )
      : null;
  const savedOrder =
    presentation.order?.featureId === studio.selection.activeFeatureId &&
    presentation.order.orderedIds.length === population.context.memberIds.length &&
    presentation.order.orderedIds.every((id) => population.context.memberIds.includes(id))
      ? presentation.order
      : null;
  const savedOrderLabel = savedOrder
    ? `${savedOrder.label}${
        savedOrder.rule !== 'similarity'
          ? ''
          : savedOrder.fitId !== relationshipSnapshot.fit?.fitId
            ? ' · earlier fit'
            : relationshipSnapshot.stale
              ? ' · inputs changed'
              : ''
      }`
    : undefined;
  const contextIds = useStableIds(population.context.memberIds);
  const orderedIds = useMemo(
    () => savedOrder?.orderedIds ?? arrangement?.orderedIds ?? contextIds,
    [savedOrder, arrangement, contextIds],
  );
  // The montage's Sort and Group: the shared order, or one the lens applies
  // itself (distance from the mean, a design column, reversal).
  const summaryView =
    !withoutFocused && (presentation.arrangement === 'inspect' || presentation.arrangement === 'groups');
  const montageArrangement = useMontageArrangement({
    active: montage,
    summary: summaryView,
    studio,
    workspaceId,
    contextIds,
    sharedOrder: orderedIds,
    savedOrder,
    hasResponseOrder: !!arrangement,
    responseWitnesses: arrangement?.mode === 'witnesses',
    // The values table drives the controller; once it has stopped there are no values.
    responseAvailable: !!probeController && probeController.isActive(),
    responseReady: canArrange,
    responseError:
      (pinHeld || hoverInForce) && probeSnapshot?.error ? String(probeSnapshot.error) : null,
    applyResponseOrder: (mode) => fitOrder(mode),
    clearOrder: () => {
      probeController?.clearArrangement();
      const state = useSetStudioStore.getState();
      state.setPopulationPresentation({ ...state.population.presentation, order: null });
    },
  });
  // Twelve across the range: the montage shows the sampled subjects only.
  const witnessIds =
    montage && montageArrangement.sort === 'witnesses' && arrangement?.mode === 'witnesses'
      ? arrangement.witnessIds
      : null;
  const shownOrder = useMemo(() => {
    const order = montage ? montageArrangement.order : orderedIds;
    return witnessIds ? order.filter((id) => witnessIds.includes(id)) : order;
  }, [montage, montageArrangement.order, orderedIds, witnessIds]);
  // Stable IDs prevent focus updates from restarting playback.
  const navigationIds = useMemo(
    () =>
      contributors
        ? shownOrder.filter((id) => contributors.memberIds.includes(id))
        : [...shownOrder],
    [shownOrder, contributors],
  );
  const galleryIds = montage
    ? navigationIds
    : arrangement
      ? arrangement.mode === 'witnesses'
        ? arrangement.witnessIds
        : arrangement.orderedIds
      : contextIds;
  // Grouped montage: one row per group (one group alone when the view came
  // from that group's contributors), each opened on request.
  const montagePartition = montage ? partition : null;
  const montageGroupList = useMemo(() => {
    if (!montagePartition) return null;
    const groups = montageGroups(montagePartition, shownOrder);
    return contributors ? groups.filter((group) => group.id === contributors.id) : groups;
  }, [montagePartition, shownOrder, contributors]);
  const pinned = studio.population.pinnedProbe;
  const currentProbe =
    pinned?.supportKey === populationSupportKey(studio, workspaceId) ? pinned : null;
  // In the montage a tile is the whole slice unless a pinned region was asked for.
  const tilesWholePlane = montage && (!currentProbe || presentation.montageScope !== 'probe');
  const nativeKey = `${studio.selection.activeSetId}:${studio.selection.activeFeatureId}:${orientation}:${tilesWholePlane ? 'plane' : cutoutWidth}`;
  // The montage asks for the image's own resolution: the tile size on screen
  // is not part of the request, so changing it asks for nothing.
  const cutoutDim = montage ? POPULATION_CUTOUT_NATIVE : 40;
  const knownNative = nativeDim?.key === nativeKey ? nativeDim.dim : null;
  // The page is as long as the request's budget allows at that resolution:
  // it depends on the image alone, so it does not move with the tile size.
  const pageSize = montage
    ? montagePageSize({
        nativeDim: knownNative,
        maxDim: POPULATION_CUTOUT_MAX_DIM,
        valueBudget: POPULATION_CUTOUT_VALUE_BUDGET,
      })
    : MONTAGE_PAGE_SIZE;
  // Every member of every group is shown, wrapped; pages only bound the request.
  const groupPageList = useMemo(
    () => (montageGroupList ? groupedPages(montageGroupList, pageSize) : null),
    [montageGroupList, pageSize],
  );
  const pages = groupPageList
    ? groupPageList.length
    : Math.max(1, Math.ceil(galleryIds.length / pageSize));
  const focusedMemberId = studio.selection.activeMemberId ?? '';
  const focusedGroupPage = groupPageList
    ? groupPageList.findIndex((rows) => rows.some((row) => row.shown.includes(focusedMemberId)))
    : -1;
  const focusPage = groupPageList
    ? focusedGroupPage < 0
      ? null
      : focusedGroupPage
    : Math.floor(Math.max(0, galleryIds.indexOf(focusedMemberId)) / pageSize);
  const page = Math.min(cutoutPage, pages - 1);
  useEffect(() => {
    if (montage && focusPage !== null) setCutoutPage(focusPage);
  }, [montage, focusPage]);
  const groupRows = useMemo(
    () => (groupPageList ? (groupPageList[page] ?? []) : null),
    [groupPageList, page],
  );
  const tileIds = useMemo(
    () =>
      groupRows
        ? groupRows.flatMap((row) => row.shown)
        : galleryIds.slice(page * pageSize, (page + 1) * pageSize),
    [groupRows, galleryIds, page, pageSize],
  );
  // The montage asks for its page's subjects in one fixed order (the
  // context's): the sprite sheet is indexed by ID, so a new order on screen
  // (a re-sort, a live value-at-pointer order) asks for nothing new.
  const requestedTileIds = useMemo(() => {
    if (!montage) return tileIds;
    const position = new Map(contextIds.map((id, i) => [id, i]));
    const rank = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    return [...tileIds].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  }, [montage, tileIds, contextIds]);
  // The prefix every ID in the set shares ("sub-"): stripped from the tile
  // labels and said once in the toolbar, grouped or not.
  const idPrefix = useMemo(() => commonIdPrefix(contextIds), [contextIds]);
  const cutouts = useMemo(
    () =>
      montage || (showCutouts && currentProbe)
        ? {
            wholePlane: tilesWholePlane,
            centerMm: [...(currentProbe?.worldMm ?? crosshair.world_mm)] as [
              number,
              number,
              number,
            ],
            widthMm: cutoutWidth,
            dimPx: cutoutDim,
            memberIds: requestedTileIds,
          }
        : null,
    [
      montage,
      tilesWholePlane,
      showCutouts,
      currentProbe,
      crosshair.world_mm,
      cutoutWidth,
      cutoutDim,
      requestedTileIds,
    ],
  );
  const settings = useCrosshairSettingsStore((state) => state.settings);
  const style = useMemo(
    () => ({
      color: settings.activeColor,
      lineWidth: settings.activeThickness,
      lineDash: getLineDash(settings.activeStyle, settings.activeThickness),
    }),
    [settings],
  );
  const canvases = useRef<Record<string, HTMLCanvasElement>>({});
  const placements = useRef<Record<string, SliceViewerPlacement>>({});
  const [width, setWidth] = useState(760);
  const host = useRef<HTMLDivElement>(null);
  const compact = width < 600;
  const paneWidth = Math.max(100, Math.floor(compact ? width : (width - 12) / 2));
  // The maps fill the column's visible height under the toolbar (QA N13),
  // never below the minimum view height; stacked panes share it.
  const viewportHeight = useContext(StudioViewportHeightContext);
  const available = viewportHeight === null ? null : viewportHeight - POPULATION_MAP_CHROME_PX;
  const paneHeight =
    available === null
      ? compact
        ? 220
        : 320
      : Math.max(STUDIO_MIN_VIEW_PX, Math.floor(compact ? (available - 36) / 2 : available));
  const slot = useContext(StudioToolbarSlotContext);
  // In the Studio the view switch sits beside the lens switch and the rarely
  // used controls go in its one menu; a lens on its own keeps them in its row.
  const viewSlot = useContext(StudioViewSlotContext);
  const menuSlot = useContext(StudioMenuSlotContext);
  // Parts of the Studio's ⋯ menu (B5); null on their own, falling back to menuSlot.
  const menuDataSlot = useContext(StudioMenuDataSlotContext);
  const provenanceSlot = useContext(StudioProvenanceSlotContext);
  const [slotWidth, setSlotWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!slot || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setSlotWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);
  // Summary, plane, arrangement, Save calculation and More need about 520 px.
  const toolbarRoom = slotWidth === null || slotWidth >= 520;
  // Bound evaluation independent of display/device pixel ratio. The shared
  // canvas fits the returned raster uniformly, preserving anatomical aspect.
  const rasterWidth = Math.min(256, paneWidth);
  const rasterHeight = Math.min(256, paneHeight);
  const definition = useMemo(
    () =>
      buildPopulationSliceQuery(studio, workspaceId, {
        crosshairMm: [...crosshair.world_mm],
        orientation,
        summary,
        zoom,
        dimPx: [rasterWidth, rasterHeight],
        withoutFocused: withoutFocused && !previewSet,
        withoutMembers: withoutFocused && previewSet ? previewSet.memberIds : undefined,
        groupPage: currentGroupPage,
        withoutParticipant: previewParticipant,
        cutouts: cutouts?.memberIds.length ? cutouts : null,
      }),
    [
      studio,
      workspaceId,
      crosshair.world_mm,
      orientation,
      summary,
      zoom,
      rasterWidth,
      rasterHeight,
      withoutFocused,
      previewSet,
      currentGroupPage,
      previewParticipant,
      cutouts,
    ],
  );

  useEffect(() => {
    service.setPeakNavigator({
      scope: `population:${workspaceId}`,
      navigate: (world) => populationSliceActions.moveTo(workspaceId, world),
    });
    const unsubscribe = populationSliceActions.onUserSlice((id) => {
      if (id === workspaceId) service.noteUserSlice();
    });
    return () => {
      unsubscribe();
      service.setPeakNavigator(null);
    };
  }, [service, workspaceId]);
  useEffect(() => {
    service.start();
    return () => service.stop();
  }, [service]);
  useEffect(() => {
    if (!inFront) return;
    service.request(definition.query ? { ...definition.query, focusOrder: navigationIds } : null);
  }, [service, definition.query, navigationIds, inFront]);
  useLayoutEffect(() => snapshot.displayed?.images.retain(), [snapshot.displayed?.images]);
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const result = snapshot.displayed;
  useEffect(() => {
    if (result)
      populationRelationshipService.observeSources(
        result.data.sources,
        result.data.maskRevision?.sha256,
      );
  }, [result]);
  const orderSourceStatus =
    arrangement && result
      ? populationOrderSourceStatus(
          arrangement,
          result.data.sources.map((source) => ({
            memberId: source.memberId,
            sha256: source.revision.sha256,
            maskSha256: result.data.maskRevision?.sha256,
          })),
        )
      : 'unknown';
  const current = !!result && result.query.key === definition.query?.key;
  const reportedNative = current ? result?.data.cutouts?.nativeDimPx : undefined;
  const shownTileDim = result?.data.cutouts?.plane.dim_px[0] ?? null;
  // Radiological convention: axial and coronal panes drawn mirrored; the
  // shared placement keeps clicks, hover and the crosshair on the same world
  // points (sagittal never mirrors).
  const mirrorX = useMirrorsView(result?.query.request.orientation ?? orientation);
  // The montage's sprites, made once here with the lens's one crop memory
  // and passed down: the tile fit (aspect), the pixel-for-pixel decision and
  // the drawing all use the same crop, even after the montage remounts.
  const [cropMemory] = useState(createMontageCropMemory);
  const baseSprites = useMemo(
    () => montageSprites(result?.data.cutouts ? result : null, mirrorX, true, cropMemory),
    [result, mirrorX, cropMemory],
  );
  const shownCrop = baseSprites?.crop ?? null;
  const shownCropWidth = shownCrop?.width ?? null;
  // One shared tile size: chosen on the slider, else the largest with which
  // the whole page fits the pane.
  const fittedTilesPerRow = montage
    ? fitTilesPerRow({
        width: montageWidth,
        height: montageHeight,
        aspect: shownCrop ? shownCrop.height / shownCrop.width : MONTAGE_DEFAULT_ASPECT,
        blocks: groupRows ? groupRows.map((row) => row.shown.length) : [tileIds.length],
        headings: !!groupRows,
      })
    : null;
  const tilesPerRow = clampTilesPerRow(
    tilesPerRowChoice ?? fittedTilesPerRow ?? defaultTilesPerRow(montageWidth),
    montageWidth,
  );
  useEffect(() => {
    if (!reportedNative) return;
    setNativeDim((previous) =>
      previous?.key === nativeKey && previous.dim === reportedNative
        ? previous
        : { key: nativeKey, dim: reportedNative },
    );
  }, [reportedNative, nativeKey]);
  // Tiles shown at or above their sampled size are drawn pixel for pixel.
  const montagePixelated =
    !shownTileDim ||
    tileDrawnPixelated(
      tileWidthPx(montageWidth, tilesPerRow),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      // After the shared crop a tile shows the crop's width, not the cell's.
      shownCropWidth ?? shownTileDim,
    );
  const montageTileSprites = useMemo(
    () =>
      baseSprites && baseSprites.pixelated !== montagePixelated
        ? { ...baseSprites, pixelated: montagePixelated }
        : baseSprites,
    [baseSprites, montagePixelated],
  );
  const issue = definition.issue ?? snapshot.error;
  // ↑/↓ over (or with focus in) the maps step the population slice (N9).
  // Repeated keys step on from the crosshair while the next image is still
  // evaluating (the shown plane fixes the axis), so ↑ ↑ moves two slices.
  useStudioMapSliceKeys(
    host,
    (direction) => {
      if (result && result.query.request.orientation === orientation)
        populationSliceActions.step(
        workspaceId,
        result.data.plane,
        crosshair.world_mm,
        direction * populationSliceStepMm(result.data),
      );
    },
    inFront,
  );
  const fitOrder = (mode: 'all' | 'witnesses') => {
    const response = probeSnapshot?.displayed;
    if (!response || !probeController?.arrange(mode)) return;
    const fit = probeController.getSnapshot().arrangement;
    if (!fit || response.query.request.locus.kind !== 'set') return;
    const revisions = new Map(
      response.frame.meta?.sources?.map((source) => [
        source.memberId,
        source.sourceRevision?.sha256,
      ]),
    );
    studio.setPopulationPresentation({
      ...presentation,
      order: {
        featureId: studio.selection.activeFeatureId!,
        rule: 'response',
        tieRule: 'source',
        orderedIds: fit.orderedIds,
        unavailableIds: fit.unavailableIds,
        label: populationArrangementLabel(fit),
        probe: fit.query.probe,
        bindings: response.query.request.locus.members.map((member) => ({
          ...member,
          expectedSha256: revisions.get(member.memberId) ?? undefined,
        })),
        mask: response.query.request.locus.mask
          ? {
              ...response.query.request.locus.mask,
              expectedSha256: response.frame.meta?.sources?.[0]?.maskRevision?.sha256 ?? undefined,
            }
          : null,
      },
    });
  };
  // Sorted by the value at the probe, the order follows the probe live (B3):
  // when values for a new point have arrived and rested, the order is taken
  // again and the tiles reflow. A new pin re-sorts the whole set (and is
  // saved); the pointer (Follow hover, nothing pinned) re-sorts only the
  // tiles on screen, below.
  const liveOrderMode =
    montage &&
    savedOrder?.rule === 'response' &&
    !montageArrangement.sortBusy &&
    (montageArrangement.sort === 'crosshair' || montageArrangement.sort === 'witnesses')
      ? montageArrangement.sort === 'witnesses'
        ? ('witnesses' as const)
        : ('all' as const)
      : null;
  // The order in force was taken at another point than the values now shown.
  const shownProbeKey = probeSnapshot?.displayed?.query.key ?? null;
  const liveOrderKey =
    liveOrderMode && pinHeld && canArrange && arrangement?.query.key !== shownProbeKey
      ? shownProbeKey
      : null;
  const latestFitOrder = useRef(fitOrder);
  latestFitOrder.current = fitOrder;
  useEffect(() => {
    if (!liveOrderKey || !liveOrderMode) return;
    const timer = setTimeout(
      () => latestFitOrder.current(liveOrderMode),
      MONTAGE_LIVE_ORDER_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [liveOrderKey, liveOrderMode]);
  // Following the pointer, the order is the page's own: the tiles on screen
  // are put in order of their values at the pointer, and nobody moves to
  // another page (nothing new is asked for). The values are taken once they
  // have rested, and never while the pointer is over the tiles themselves (a
  // tile hovered moves the probe too): tiles must not move under the pointer.
  const hoverLive = liveOrderMode !== null && hoverInForce;
  const hoverValuesKey = hoverLive && probeValuesReady ? shownProbeKey : null;
  const [hoverValues, setHoverValues] = useState<{
    key: string;
    values: ReadonlyMap<string, number | null>;
  } | null>(null);
  const overTiles = useRef(false);
  const leftTilesAt = useRef(Number.NEGATIVE_INFINITY);
  // The last pointer probe written from the tiles (or just after leaving
  // them: Follow hover writes on the next frame): its values never re-sort.
  const tileProbe = useRef<readonly number[] | null>(null);
  useEffect(
    () =>
      useSetStudioStore.subscribe((now, before) => {
        const probe = now.population.hoverProbe;
        if (probe === before.population.hoverProbe || !probe) return;
        if (overTiles.current || performance.now() - leftTilesAt.current < MONTAGE_TILE_LEAVE_GRACE_MS)
          tileProbe.current = [...probe.worldMm];
      }),
    [],
  );
  useEffect(() => {
    if (!montage) overTiles.current = false;
  }, [montage]);
  useEffect(() => {
    if (!hoverLive) setHoverValues((previous) => (previous === null ? previous : null));
  }, [hoverLive]);
  const latestProbeShown = useRef(probeSnapshot?.displayed ?? null);
  latestProbeShown.current = probeSnapshot?.displayed ?? null;
  useEffect(() => {
    if (!hoverValuesKey || hoverValues?.key === hoverValuesKey) return;
    const timer = setTimeout(() => {
      const shown = latestProbeShown.current;
      if (overTiles.current || !shown || shown.query.key !== hoverValuesKey) return;
      const at = tileProbe.current;
      if (at && shown.query.probe.worldMm.every((v, i) => v === at[i])) return;
      setHoverValues({
        key: hoverValuesKey,
        values: new Map(
          shown.frame.rows.map((row) => [
            String(row.member),
            typeof row.value === 'number' ? row.value : null,
          ]),
        ),
      });
    }, MONTAGE_LIVE_ORDER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [hoverValuesKey, hoverValues?.key]);
  const pointerValues = hoverLive ? (hoverValues?.values ?? null) : null;
  const montageReversed = montageArrangement.reversed;
  const shownTileIds = useMemo(
    () =>
      pointerValues && !groupRows
        ? orderByValueWithin(tileIds, pointerValues, montageReversed)
        : tileIds,
    [pointerValues, groupRows, tileIds, montageReversed],
  );
  const shownGroupRows = useMemo(() => {
    if (!pointerValues || !groupRows) return groupRows;
    let moved = false;
    const rows = groupRows.map((row) => {
      const shown = orderByValueWithin(row.shown, pointerValues, montageReversed);
      if (shown === row.shown) return row;
      moved = true;
      return { ...row, shown: [...shown] };
    });
    return moved ? rows : groupRows;
  }, [pointerValues, groupRows, montageReversed]);
  // The whole sequence (the transport, the Subjects list, the Values strip)
  // with this page in the order on screen.
  const shownNavigationIds = useMemo(
    () =>
      pointerValues
        ? withinPlaces(
            navigationIds,
            shownGroupRows ? shownGroupRows.flatMap((row) => row.shown) : shownTileIds,
          )
        : navigationIds,
    [pointerValues, navigationIds, shownGroupRows, shownTileIds],
  );
  // The view switch (Summary | Montage) stays on the toolbar while it has
  // room, else it moves under More: the row never wraps (QA N13). A grouped
  // Summary (the groups' means) and a comparison are the Summary view.
  const arr = (
    <div className="flex shrink-0 items-center" aria-label="Population arrangement">
      {/* Lighter than the lens switch: flat text tabs with a neutral 2px edge. */}
      <Tabs
        aria-label="Population view"
        items={[
          { value: 'inspect', label: 'Summary' },
          { value: 'montage', label: 'Montage' },
        ]}
        value={presentation.arrangement === 'montage' ? 'montage' : 'inspect'}
        onValueChange={(value) => {
          if ((value === 'montage') === (presentation.arrangement === 'montage')) return;
          studio.setPopulationPresentation({
            ...presentation,
            arrangement:
              value === 'montage' ? 'montage' : studio.population.partition ? 'groups' : 'inspect',
            contributorsGroupId: undefined,
          });
        }}
      />
    </div>
  );
  // An explicit selection only: with none, every subject is in play and no tile is marked.
  const montageSelection =
    studio.population.working.kind === 'members' ? population.workingMemberIds : [];
  const montageSelectedIds = new Set(montageSelection);
  // Picking subjects off an order or grouping the data made (similarity,
  // distance from the mean, value at the pin, similarity groups) is
  // choosing from the data: such a selection is exploratory.
  const pickOrigin: 'manual' | 'map-derived' = selectionFromDataOrder({
    sort: montage ? montageArrangement.sort : null,
    savedOrder: !!savedOrder,
    responseOrder: !!arrangement,
    partitionOrigin: partition?.origin ?? null,
  })
    ? 'map-derived'
    : 'manual';
  const toggleSubject = (id: string) => {
    if (studio.population.working.kind !== 'members') {
      populationProbeActions.select([id], 'replace', pickOrigin, 'Montage selection');
      return;
    }
    const rest = montageSelection.filter((member) => member !== id);
    // Adding one picked off a data-made order makes the selection exploratory;
    // removing one keeps its origin (an exploratory selection stays so).
    if (rest.length === montageSelection.length)
      populationProbeActions.select([id], 'union', pickOrigin, 'Montage selection');
    else if (rest.length) populationProbeActions.toggle(id);
    // Deselecting the last subject returns to everyone, not to an empty population.
    else populationProbeActions.selectAll();
  };
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectSubjects = (ids: string[], additive: boolean) => {
    const outcome = populationProbeActions.select(
      ids,
      additive && studio.population.working.kind === 'members' ? 'union' : 'replace',
      pickOrigin,
      'Montage selection',
    );
    setSelectionError(outcome.ok ? null : outcome.reason);
  };
  const notify = (message: string) =>
    getEventBus().emit('ui.notification', { type: 'success', message });
  // What can be done with the selection: on the montage's own line above the tiles.
  const montageSelectionActions = {
    count: montageSelection.length,
    onClear: () => populationProbeActions.selectAll(),
    defaultGroupName: `${montageSelection.length} ${montageSelection.length === 1 ? 'subject' : 'subjects'} from the montage`,
    onSaveGroup: (name: string) => {
      const id = studio.createSavedCohort({
        memberIds: [...montageSelection],
        label: name,
        originLabel:
          studio.population.working.kind === 'members'
            ? studio.population.working.origin
            : 'context',
        description: 'Frozen observation membership from Population',
      });
      if (id) notify(`Saved as "${useSetStudioStore.getState().cohorts[id]?.label ?? 'group'}".`);
      else setSelectionError('The selection could not be saved as a group.');
    },
    // B = the live rest, the comparison shown, and Compare and test opened in the Inspector.
    onCompareRest:
      montageSelection.length < population.context.memberIds.length
        ? () => void compareSelectionWithTheRest()
        : undefined,
  };
  const stepSlice = (direction: -1 | 1) => {
    if (result && result.query.request.orientation === orientation)
      populationSliceActions.step(
        workspaceId,
        result.data.plane,
        crosshair.world_mm,
        direction * populationSliceStepMm(result.data),
      );
  };
  const montageStale = montage && !!result && !current;
  const orderNote = montageArrangement.sort === 'similarity' && savedOrder?.rule === 'similarity'
    ? savedOrder.fitId !== relationshipSnapshot.fit?.fitId
      ? 'from an earlier fit'
      : relationshipSnapshot.stale
        ? 'images changed since this order'
        : null
    : pointerValues
      ? pages > 1
        ? 'this page follows the pointer'
        : 'follows the pointer'
      : montageArrangement.sort === 'crosshair' && arrangement
      ? orderSourceStatus === 'changed'
        ? 'images changed since this order'
        : arrangement.query.key !== probeDefinition.query?.key
          ? 'from an earlier point'
          : null
      : null;
  // The Summary arrangement's second pane: the focused subject's own map, or
  // its difference from the group statistic beside it. The difference is
  // made here from the two planes the result carries; nothing is requested.
  const [subjectViewChoice, setSubjectViewChoice] = useState<SubjectPaneView>('map');
  // The difference under the pointer, while it is over the difference pane.
  const [differenceAt, setDifferenceAt] = useState<number | null | undefined>(undefined);
  const focusedSubject = result?.query.request.focusMemberId ?? null;
  // Stepping moves from the subject asked for last, not the one on screen, so
  // quick clicks while an image is fetched each move one subject.
  const steppedSubject = studio.selection.activeMemberId ?? focusedSubject;
  const shownRequest = result?.query.request;
  const canDiffer =
    !!shownRequest &&
    !shownRequest.inference &&
    !shownRequest.reference &&
    // Averaged per participant, one observation minus a participant mean
    // mixes units: the difference is not offered there.
    !shownRequest.aggregation &&
    !shownRequest.groups?.length &&
    ['mean', 'median'].includes(shownRequest.summary);
  const differenceReference = shownRequest?.summary === 'median' ? 'median' : 'mean';
  // Participants among the observations the shown statistic was computed
  // over; null when no participant identity is declared.
  const shownParticipants = useMemo(() => {
    if (!shownRequest || shownRequest.aggregation || !studio.population.participants) return null;
    const resolved = resolvePopulationParticipants(studio, shownRequest.workingMemberIds);
    return resolved.issue ? null : resolved.groups.length;
  }, [shownRequest, studio]);
  const subjectView: SubjectPaneView = canDiffer ? subjectViewChoice : 'map';
  const difference_ = useSubjectDifference(
    result,
    subjectView === 'difference' && !montage && !grouped && !comparing,
  );
  const localOrder =
    montage &&
    (montageArrangement.reversed ||
      montageArrangement.sort === 'distance' ||
      !!sortColumn(montageArrangement.sort));
  const exploratory = isExploratorySelection(studio.population.working);
  const orderName = localOrder
    ? montageOrderLabel(montageArrangement.sort, montageArrangement.reversed)
    : pointerValues
      ? `Value at the pointer${pages > 1 ? ', within each page' : ''}`
      : (savedOrderLabel ?? (arrangement ? populationArrangementLabel(arrangement) : 'Source order'));
  const transport = (
    <PopulationNavigation
      ids={shownNavigationIds}
      focusedId={studio.selection.activeMemberId}
      ready={current && !snapshot.pending}
      failed={!!issue}
      scope={`${workspaceId}:${studio.population.sessionRevision}:${studio.selection.activeFeatureId}`}
      onFocus={populationProbeActions.focus}
      // The movie follows the order on screen, so the label names that order.
      label={orderName}
      // The grid is its own scrubber.
      scrubber={!montage}
    />
  );
  // The order on screen, for the Subjects list (another root) to follow.
  const setLensOrder = usePopulationViewStore((state) => state.setLensOrder);
  useEffect(() => {
    setLensOrder({ ids: shownNavigationIds, label: orderName });
  }, [setLensOrder, shownNavigationIds, orderName]);
  useEffect(() => () => setLensOrder(null), [setLensOrder]);
  // The statistic on show, for the Inspector's centre of the selection.
  const publishSummary = usePopulationViewStore((state) => state.setSummary);
  useEffect(() => publishSummary(summary), [publishSummary, summary]);
  // Coverage and sources, for the Inspector (another root).
  const setCoverage = usePopulationViewStore((state) => state.setCoverage);
  useEffect(() => {
    // Only a result of the current query: an earlier image's coverage is never shown as this one's.
    setCoverage(
      result && current
        ? {
            key: result.query.key,
            scope: `${studio.selection.activeSetId}:${studio.selection.activeFeatureId}`,
            eligible: result.query.request.members.length,
            selectedRows: result.data.eligibleCount,
            units: result.data.unitCount,
            unitKind: result.query.request.aggregation ? 'participant' : 'observation',
            sources: result.data.sources.map((source) => ({
              memberId: source.memberId,
              sha256: source.revision.sha256,
            })),
          }
        : null,
    );
    // The scope is read with the result it describes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCoverage, result, current]);
  useEffect(() => () => setCoverage(null), [setCoverage]);
  // A fit belongs to the population it was made on: another one starts afresh.
  const relationshipScope = useMemo(
    () => relationshipSource().scope,
    // relationshipSource reads the stores; these are what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio, workspaceId],
  );
  useEffect(() => {
    populationRelationshipService.resetScope(relationshipScope);
  }, [relationshipScope]);
  // A fit belongs to its region: the pin moving, its radius or "Compare within" changing makes it out of date.
  const pinnedForRegion = studio.population.pinnedProbe;
  const wantedRegion =
    studio.population.similarityRegion === 'probe' && pinnedForRegion && pinnedForRegion.radiusMm > 0
      ? { worldMm: pinnedForRegion.worldMm, radiusMm: pinnedForRegion.radiusMm }
      : null;
  const wantedRegionKey = wantedRegion ? JSON.stringify(wantedRegion) : null;
  useEffect(() => {
    populationRelationshipService.observeRegion(wantedRegionKey ? JSON.parse(wantedRegionKey) : null);
  }, [wantedRegionKey, relationshipSnapshot.fit]);
  // Similarity groups wear the same marks in the grid's headers and on the map.
  const groupingView = useMemo(
    () => similarityGroupingView(relationshipSnapshot.fit, partition),
    [relationshipSnapshot.fit, partition],
  );
  const glyphs = useMemo(() => {
    const marks = new Map(groupingView.classes.map((entry) => [entry.id, entry.shape]));
    // A saved grouping's one-member groups read as outliers.
    for (const group of partition?.origin === 'map-derived' ? partition.groups : [])
      if (!marks.has(group.id) && group.memberIds.length === 1)
        marks.set(group.id, groupingView.classes.find((c) => c.outliers)?.shape ?? 'diamond-hollow');
    return marks;
  }, [groupingView, partition]);
  const datasetKey = studio.selection.activeSetId ?? '';
  const stripCollapsed = usePopulationViewStore(
    (state) => state.stripCollapsed[datasetKey] ?? false,
  );
  const setStripCollapsed = usePopulationViewStore((state) => state.setStripCollapsed);
  const stripShown = montage && montageArrangement.similarityShown;
  const subjects = (n: number) => `${n} ${n === 1 ? 'subject' : 'subjects'}`;
  // Show: the statistic, a test's channel, or A and B once B is defined.
  // A comparison of the set with itself is never offered (A = B).
  const referenceReady =
    population.referenceMemberIds.length > 0 &&
    !population.referenceIssue &&
    !sameMembers(population.workingMemberIds, population.referenceMemberIds);
  const statisticOptions: MontageOption[] = Object.entries(
    activeTest ? inferenceChannelNames(activeTest.method) : names,
  ).map(([value, label]) => ({ value, label }));
  // "A and B" and "A − B" once B is set: Show is their one home (grouped too).
  const compareShowOptions: MontageOption[] =
    !activeTest && (referenceReady || comparing)
      ? [
          {
            value: 'compare:ab',
            label: exploratory ? 'A and B · exploratory A' : 'A and B',
            description: exploratory
              ? `A is an ${EXPLORATORY_LABEL.toLowerCase()}: ${EXPLORATORY_REASON}`
              : 'The selection (A) beside the comparison group (B)',
          },
          {
            value: 'compare:diff',
            label: exploratory ? 'A − B · exploratory A' : 'A − B',
            description: 'The difference of the two means',
          },
        ]
      : [];
  const showOptions: MontageOption[] = [...statisticOptions, ...compareShowOptions];
  // Grouped, Show chooses the "All" card's statistic (the groups stay means),
  // or leaves the groups for A and B once B is set.
  const groupedShowOptions: MontageOption[] = [
    ...ALL_CARD_STATISTICS.map(({ value, label }) => ({
      value,
      label,
      description:
        value === 'oneSampleT'
          ? 'All card: one-sample t of the mean against zero, at each voxel'
          : value === 'positiveFraction'
            ? 'All card: share of nonzero members above zero, at each voxel (50 % is no lean)'
            : 'All card: mean of the members, at each voxel',
    })),
    ...compareShowOptions,
  ];
  const showValue = activeTest
    ? activeTest.channel
    : comparing
      ? difference
        ? 'compare:diff'
        : 'compare:ab'
      : grouped
        ? allCardStatistic(summary)
        : summary;
  const chooseShow = (value: string) => {
    if (activeTest) {
      selectInferenceChannel(value as typeof activeTest.channel);
      return;
    }
    if (value === 'compare:ab' || value === 'compare:diff') {
      studio.setPopulationPresentation({
        ...presentation,
        arrangement: value === 'compare:diff' ? 'difference' : 'comparison',
        contributorsGroupId: undefined,
      });
      return;
    }
    setSummary(value as PopulationSummary);
    if (comparing)
      studio.setPopulationPresentation({
        ...presentation,
        arrangement: studio.population.partition ? 'groups' : 'inspect',
      });
  };
  const groupToolbarProps = {
    group: montageArrangement.group,
    groupOptions: montageArrangement.groupOptions,
    groupBusy: montageArrangement.groupBusy,
    onGroup: (value: string) => {
      setSelectionError(null);
      montageArrangement.chooseGroup(value);
    },
    groupCount: montageArrangement.groupedBySimilarity
      ? {
          value: montageArrangement.groupCount,
          max: montageArrangement.groupCountMax,
          onChange: montageArrangement.chooseGroupCount,
          title: montageArrangement.groupCountTitle,
          auto: montageArrangement.groupCountAuto,
          suggested: montageArrangement.groupCountSuggested,
          cuts: montageArrangement.groupCountCuts,
          onAuto: montageArrangement.chooseAutoGroupCount,
        }
      : null,
  };
  const zoomChoice = {
    label: 'Zoom',
    value: String(zoom),
    options: [...new Set([0.5, 1, 2, 4, 8, zoom])]
      .sort((a, b) => a - b)
      .map((value) => ({ value: String(value), label: `${value}×` })),
    onChange: (value: string) => setZoom(Number(value)),
  };
  const tilesChoice = {
    label: 'Tiles',
    value: currentProbe && presentation.montageScope === 'probe' ? 'probe' : 'plane',
    options: [
      { value: 'plane', label: 'Whole slice', description: 'Each tile is the whole slice' },
      {
        value: 'probe',
        label: `Pinned region · ${cutoutWidth} mm`,
        // Nothing pins silently: the region is the one pinned in the Values tab.
        description: currentProbe
          ? `Each tile is the ${cutoutWidth} mm window at the pin (width in the Values tab)`
          : 'Pin a point first',
        disabled: !currentProbe,
      },
    ],
    onChange: (value: string) =>
      studio.setPopulationPresentation({
        ...presentation,
        montageScope: value as 'plane' | 'probe',
      }),
  };
  const cutoutsShown = showCutouts && !!currentProbe;
  const summaryStatus = [
    result
      ? `${result.query.request.orientation} · (${formatWorldPoint(result.query.request.crosshairMm)}) mm · nearest voxel`
      : 'Choose an audited volume set.',
    ...(result && !current ? ['previous query'] : []),
    ...(snapshot.pending ? ['updating'] : []),
    ...(result ? [populationAnatomyStatus(result).replace(/^ · /, '')].filter(Boolean) : []),
    // The order the transport plays, and where it came from.
    ...(orderName !== 'Source order' ? [orderName] : []),
    ...(comparing
      ? [
          `A ${result?.data.eligibleCount ?? population.workingMemberIds.length}${exploratory ? ` (${EXPLORATORY_LABEL.toLowerCase()})` : ''} · B ${population.referenceMemberIds.length} · overlap ${population.referenceMemberIds.filter((id) => selectedIds.has(id)).length}; descriptive means, not a test`,
        ]
      : []),
    ...(activeTest && exploratory ? [`A is an ${EXPLORATORY_LABEL.toLowerCase()}`] : []),
    ...(grouped && unassigned ? [`${unassigned.memberIds.length} not placed by the similarity fit`] : []),
    ...(withoutFocused
      ? [
          `temporary preview without ${
            previewSet
              ? previewLabel
              : previewParticipant
                ? `participant ${participants.identity?.get(studio.selection.activeMemberId ?? '')}`
                : `subject ${studio.selection.activeMemberId}`
          }; selection retained`,
        ]
      : []),
    ...(cutoutsShown && result?.data.cutouts
      ? [
          `${result.data.cutouts.members.length} of ${population.context.memberIds.length} cutouts · ${result.query.request.cutouts?.widthMm} mm at (${result.query.request.cutouts ? formatWorldPoint(result.query.request.cutouts.centerMm) : ''}) mm`,
        ]
      : []),
  ].join(' · ');
  const refreshImages = (
    <Button
      variant="secondary"
      size="sm"
      disabled={!definition.query || snapshot.pending}
      onClick={() => {
        // One refresh for the images and the values at the pin.
        service.request(definition.query, true);
        if (probeDefinition.query) probeController?.request(probeDefinition.query, true);
      }}
    >
      Refresh images
    </Button>
  );
  const moreControls = (
    <>
      {/* What each tile shows: the whole slice or the pinned region. */}
      {montage ? (
        <div data-testid="montage-tiles-extent" className="flex flex-wrap items-center gap-2">
          <ToolbarChoiceField choice={tilesChoice} showLabel />
        </div>
      ) : (
        <div data-testid="summary-zoom" className="flex flex-wrap items-center gap-2">
          <ToolbarChoiceField choice={zoomChoice} showLabel />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!result}
          onClick={() =>
            result && populationSliceActions.navigate(workspaceId, result.data.centerWorld)
          }
        >
          Center brain
        </Button>
        {/* In the Studio's menu it is plumbing, under Provenance… (B5). */}
        {provenanceSlot ? null : refreshImages}
        <label className="flex items-center gap-1 whitespace-nowrap text-bf-sm">
          Playback speed{' '}
          <Select
            className="w-auto max-w-full"
            aria-label="Playback speed"
            value={playbackSpeed}
            onChange={(event) =>
              usePopulationViewStore.getState().setPlaybackSpeed(Number(event.target.value))
            }
          >
            <option value={5}>5 subjects/s</option>
            <option value={10}>10 subjects/s</option>
          </Select>
        </label>
      </div>
      {viewSlot || toolbarRoom ? null : arr}
    </>
  );
  return (
    <section
      aria-label="Population brain views"
      className={
        // The montage has no box: its toolbar, grid and footer share the pane's gutter.
        montage
          ? 'flex min-h-0 flex-col gap-2'
          : 'flex min-h-0 flex-col gap-2 rounded-sm border border-border bg-card p-3'
      }
    >
      {/* One toolbar row with the lens switcher (QA N13): the controls used
          while reading the maps stay out; the rest is under Save calculation
          and More. */}
      <StudioToolbarPortal>
        <div
          // Beside the lens switcher while it fits; in a narrow column it
          // takes a row of its own and wraps there, never clipped.
          className={
            viewSlot
              ? 'flex min-w-0 flex-1 items-center gap-x-2 text-bf-sm'
              : 'flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 text-bf-sm'
          }
          aria-label="Population controls"
          title={`Population · ${studio.features[studio.selection.activeFeatureId ?? '']?.label ?? 'Selected feature'}`}
        >
          <MontageToolbar
            mode={montage ? 'montage' : 'summary'}
            show={{
              label: 'Show',
              value: showValue,
              options: grouped ? groupedShowOptions : showOptions,
              onChange: grouped
                ? (value) =>
                    value.startsWith('compare:')
                      ? chooseShow(value)
                      : setSummary(value as PopulationSummary)
                : chooseShow,
              title: grouped ? 'What the All card shows; the groups show their means' : undefined,
            }}
            // Offered once a point is pinned; never a disabled button on the row.
            cutouts={
              currentProbe
                ? {
                    shown: cutoutsShown,
                    onToggle: () => {
                      setShowCutouts((value) => !value);
                      setCutoutPage(0);
                    },
                    disabledReason: null,
                  }
                : null
            }
            // Zoom is in the ⋯ menu's View controls.
            zoom={null}
            sort={montageArrangement.sortValue}
            sortOptions={montageArrangement.sortOptions}
            sortBusy={montageArrangement.sortBusy}
            reversed={montageArrangement.reversed}
            onReverse={montageArrangement.toggleReversed}
            onSort={(value) => {
              setSelectionError(null);
              montageArrangement.chooseSort(value);
              setCutoutPage(0);
            }}
            {...groupToolbarProps}
            orientation={orientation}
            onOrientation={setOrientation}
            slice={sliceReadout(orientation, crosshair.world_mm)}
            canStep={!!result && result.query.request.orientation === orientation}
            onStep={stepSlice}
            tilesPerRow={tilesPerRow}
            tilesRange={tilesRange}
            onTilesPerRow={setTilesPerRowChoice}
            gridWidth={montageWidth}
          />
          {viewSlot ? createPortal(arr, viewSlot) : toolbarRoom ? arr : null}
          {menuSlot ? (
            // The Studio's ⋯ menu: Save calculation under Data, the view
            // controls under View, Refresh images under Provenance… (B5).
            <>
              {createPortal(
                <details className="text-bf-sm">
                  <summary className="cursor-pointer font-medium">Save calculation</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <PopulationExportControls
                      display={result}
                      current={current && !snapshot.pending}
                    />
                  </div>
                </details>,
                menuDataSlot ?? menuSlot,
              )}
              {createPortal(moreControls, menuSlot)}
              {provenanceSlot ? createPortal(refreshImages, provenanceSlot) : null}
            </>
          ) : (
            <>
              <StudioToolbarMore label="Save calculation" icon={false}>
                <PopulationExportControls display={result} current={current && !snapshot.pending} />
              </StudioToolbarMore>
              <StudioToolbarMore>{moreControls}</StudioToolbarMore>
            </>
          )}
        </div>
      </StudioToolbarPortal>
      {issue && !montage && <PopulationIssueNotice issue={issue} />}
      {/* Empty in the montage: hidden there, so it adds no gap above the tiles. */}
      <div ref={host} className={montage ? 'hidden' : 'min-w-0'}>
        {grouped && result && (
          <PopulationGroupViews
            display={result}
            width={width}
            // The cards carry their own label rows: the pane's is theirs.
            height={available === null ? null : available + GROUPED_LABEL_ROW_PX}
            current={current}
            crosshairStyle={style}
            crosshairVisible={settings.visible}
          />
        )}
        <div
          className={montage || grouped ? 'hidden' : 'grid gap-3'}
          style={{
            gridTemplateColumns:
              compact || difference ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
          }}
        >
          {(difference
            ? (['summary'] as const)
            : comparing
              ? (['summary', 'reference'] as const)
              : (['summary', 'focused'] as const)
          ).map((pane) => (
            <div key={pane} className="min-w-0">
              <div className="mb-1 flex min-h-6 min-w-0 items-center justify-between gap-2 text-bf-sm">
                {pane === 'focused' ? (
                  // One subject's own map, not a statistic: its ID leads, with
                  // the way to the next subject and what of it is shown.
                  <span className="flex min-w-0 items-center gap-1">
                    <IconButton
                      icon={<ChevronLeft />}
                      aria-label="Previous subject"
                      disabled={!neighbouringSubject(shownNavigationIds, steppedSubject, -1)}
                      onClick={() => {
                        const id = neighbouringSubject(shownNavigationIds, steppedSubject, -1);
                        if (id) populationProbeActions.focus(id);
                      }}
                    />
                    <span
                      data-testid="population-focused-subject"
                      className="min-w-0 truncate font-mono text-bf-md font-medium text-foreground"
                      title={focusedSubject ?? undefined}
                    >
                      {focusedSubject ?? 'No subject'}
                    </span>
                    <IconButton
                      icon={<ChevronRight />}
                      aria-label="Next subject"
                      disabled={!neighbouringSubject(shownNavigationIds, steppedSubject, 1)}
                      onClick={() => {
                        const id = neighbouringSubject(shownNavigationIds, steppedSubject, 1);
                        if (id) populationProbeActions.focus(id);
                      }}
                    />
                    {result?.query.request.focusStackIndex !== undefined && (
                      <span className="shrink-0 text-muted-foreground">
                        frame {result.query.request.focusStackIndex + 1}
                      </span>
                    )}
                    <Select
                      className="w-auto min-w-16 max-w-44 truncate"
                      aria-label="Subject view"
                      title={
                        canDiffer
                          ? undefined
                          : shownRequest?.aggregation
                            ? 'Not offered while participants are averaged: an observation minus a participant mean mixes units'
                            : 'A difference needs the group mean or median on the left'
                      }
                      value={subjectView}
                      onValueChange={(value) => setSubjectViewChoice(value as SubjectPaneView)}
                    >
                      <option value="map">Map</option>
                      <option value="difference" disabled={!canDiffer}>
                        Difference from {differenceReference}
                      </option>
                    </Select>
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">
                      {pane === 'summary'
                        ? `${result?.query.request.inference ? inferenceChannel(result.query.request.inference).label : result?.query.request.difference ? 'A − B mean difference' : result?.query.request.reference ? 'A mean' : groupStatisticTitle(names[result?.query.request.summary ?? summary])} · ${result?.query.request.inference && result.data.reference ? `A ${result.data.unitCount} / B ${result.data.reference.unitCount} ${result.query.request.aggregation ? 'participants' : 'observations'}` : unitCountText(result?.data.unitCount ?? 0, {
                            aggregated: !!result?.query.request.aggregation,
                            participants: shownParticipants,
                          })}`
                        : `B mean · ${result?.data.reference?.unitCount ?? 0} analysis units`}
                    </span>
                    {pane === 'summary' &&
                    exploratory &&
                    (result?.query.request.reference || result?.query.request.inference) ? (
                      <span
                        data-testid="population-exploratory-title"
                        className="shrink-0 text-bf-xs text-bf-text-muted"
                        title={EXPLORATORY_REASON}
                      >
                        {EXPLORATORY_LABEL}
                      </span>
                    ) : null}
                  </span>
                )}
                {result && (
                  <span className="shrink-0 tabular-nums" data-testid={`population-scale-${pane}`}>
                    {pane === 'focused' && subjectView === 'difference' && differenceAt !== undefined ? (
                      <span data-testid="population-difference-readout" className="mr-2 font-mono">
                        {differenceAt === null
                          ? 'no difference here'
                          : `${limitDisplay(differenceAt)} here`}
                      </span>
                    ) : null}
                    {/* The range is the colour bar's: the shared one below the
                        maps, or the pane's own when its scale is its own. */}
                  </span>
                )}
              </div>
              <div
                className="relative bg-black"
                style={{ height: paneHeight }}
                onMouseMove={(event) => {
                  const canvas = canvases.current[pane],
                    placement = placements.current[pane];
                  if (!current || !result || !canvas || !placement) return;
                  const world = clientPointToWorld(
                    event.clientX,
                    event.clientY,
                    canvas,
                    placement,
                    result.data.plane,
                  );
                  if (world) populationSliceActions.hover(workspaceId, world, orientation);
                  // Over the difference, the readout is the difference there.
                  if (pane === 'focused' && subjectView === 'difference' && difference_.values)
                    setDifferenceAt(
                      world ? planeValueAt(difference_.values, result.data.plane, world) : null,
                    );
                }}
                onMouseLeave={() => {
                  if (pane === 'focused') setDifferenceAt(undefined);
                }}
              >
                <ReusableSliceViewport
                  width={difference ? width : paneWidth}
                  height={paneHeight}
                  viewPlane={result?.data.plane}
                  crosshair={{ ...crosshair, visible: crosshair.visible && settings.visible }}
                  crosshairStyle={style}
                  onCanvasReady={(canvas) => {
                    canvases.current[pane] = canvas;
                  }}
                  onPlacementChange={(placement) => {
                    placements.current[pane] = placement;
                  }}
                  onWorldClick={(world) => {
                    if (!current) return;
                    // A click pins: the values there are in the dock's Values tab.
                    populationSliceActions.navigate(workspaceId, world, true);
                    openDockTab(POPULATION_VALUES_TAB);
                  }}
                  renderSurface={(props) => (
                    <SliceViewerImageSurface
                      {...props}
                      mirrorX={mirrorX}
                      image={
                        pane === 'focused' && subjectView === 'difference'
                          ? difference_.image
                          : (result?.images[pane] ?? null)
                      }
                      emptyFallback={
                        <p className="absolute inset-0 grid place-items-center text-bf-sm text-muted-foreground">
                          {snapshot.pending ? 'Evaluating population…' : 'No population image'}
                        </p>
                      }
                    />
                  )}
                />
                {/* One bar per distinct scale: a pane on the shared scale (the
                    members, a mean or median, a subject's difference from it,
                    B) uses the bar below the maps. */}
                {result &&
                  pane === 'summary' &&
                  !populationSharesEffectScale(result.query.request) && (
                  <PopulationColorbar
                    limit={
                      pane === 'summary'
                        ? result.summaryLimit
                        : pane === 'focused' && subjectView === 'difference'
                          ? (difference_.limit ?? result.effectLimit)
                          : result.effectLimit
                    }
                    band={
                      pane === 'summary'
                        ? populationHiddenBand(
                            result.summaryLimit,
                            populationCountsSummary(result.query.request),
                          )
                        : populationHiddenBand(
                            pane === 'focused' && subjectView === 'difference'
                              ? (difference_.limit ?? result.effectLimit)
                              : result.effectLimit,
                          )
                    }
                    diverging={pane !== 'summary' || populationDiverging(result.query.request)}
                    format={pane === 'summary' && sharePane(result) ? positiveFractionTick : undefined}
                    paneHeight={paneHeight}
                    label={
                      pane === 'summary'
                        ? names[result.query.request.summary]
                        : `${focusedSubject ?? 'subject'} minus the group ${differenceReference}`
                    }
                  />
                )}
                {result && (
                  <div
                    className="pointer-events-none absolute inset-0 text-bf-sm text-white/80"
                    aria-hidden
                  >
                    <span className="absolute left-1 top-1/2">
                      {populationAxisLabel(mirrorX ? result.data.plane.u_mm : result.data.plane.u_mm.map((v) => -v))}
                    </span>
                    <span className="absolute right-1 top-1/2">
                      {populationAxisLabel(mirrorX ? result.data.plane.u_mm.map((v) => -v) : result.data.plane.u_mm)}
                    </span>
                    <span className="absolute left-1/2 top-1">
                      {populationAxisLabel(result.data.plane.v_mm.map((v) => -v))}
                    </span>
                    <span className="absolute bottom-1 left-1/2">
                      {populationAxisLabel(result.data.plane.v_mm)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* Every subject at the pin, the group mean first, in the lens order. */}
        {cutoutsShown && !montage && result?.data.cutouts && (
          <div className="mt-2 min-w-0" data-testid="population-summary-cutouts">
            <PopulationCutoutGrid
              display={result}
              width={width}
              meanFirst
              meanLabel={groupStatisticTitle(names[result.query.request.summary])}
              focusedId={studio.selection.activeMemberId}
              selectedIds={selectedIds}
              onFocus={populationProbeActions.focus}
              onToggle={populationProbeActions.toggle}
              onHover={(world) =>
                populationSliceActions.hover(workspaceId, world, result.query.request.orientation)
              }
            />
            {pages > 1 && (
              <Pager
                label="Cutouts"
                noun="page"
                showNoun
                page={page + 1}
                count={pages}
                onPageChange={(next) => setCutoutPage(next - 1)}
              />
            )}
          </div>
        )}
      </div>
      {montage && (
        <PopulationMontage
          pending={!!montageArrangement.computing && !(stripShown && montageArrangement.similarityBusy)}
          height={
            viewportHeight === null
              ? 560
              : Math.max(STUDIO_MIN_VIEW_PX + 72, viewportHeight)
          }
          display={result?.data.cutouts ? result : null}
          mirrorX={mirrorX}
          pixelated={montagePixelated}
          sprites={montageTileSprites}
          ids={shownGroupRows ? [] : shownTileIds}
          groups={shownGroupRows}
          idPrefix={idPrefix}
          onClearSelection={() => populationProbeActions.selectAll()}
          onShowMean={(groupId) => {
            const index = partition
              ? comparableGroups(partition).findIndex((group) => group.id === groupId)
              : -1;
            if (index < 0) return;
            setGroupPage(Math.floor(index / 4));
            studio.setPopulationPresentation({
              ...presentation,
              arrangement: 'groups',
              contributorsGroupId: undefined,
            });
          }}
          onSelectGroup={(groupId) => {
            const group = partition?.groups.find((candidate) => candidate.id === groupId);
            if (!group || !partition) return;
            const outcome = populationProbeActions.select(
              group.memberIds,
              'replace',
              partition.origin,
              montageGroupList?.find((row) => row.id === groupId)?.label ?? group.label,
            );
            setSelectionError(outcome.ok ? null : outcome.reason);
          }}
          glyphs={glyphs}
          onShowAllGroups={
            contributors
              ? () =>
                  studio.setPopulationPresentation({
                    ...presentation,
                    contributorsGroupId: undefined,
                  })
              : undefined
          }
          columns={tilesPerRow}
          onWidth={(next) => setMontageWidth((previous) => (previous === next ? previous : next))}
          onHeight={(next) => setMontageHeight((previous) => (previous === next ? previous : next))}
          focusedId={studio.selection.activeMemberId}
          selectedIds={montageSelectedIds}
          onFocus={populationProbeActions.focus}
          onToggle={toggleSubject}
          // The Inspector's "Open in Deck": the subject alone, in the Subject lens.
          onOpen={(id) => {
            const state = useSetStudioStore.getState();
            state.setActiveMember(id);
            state.setActiveLens('deck');
          }}
          onSelect={selectSubjects}
          // On a line of its own above the tiles, never on the toolbar row.
          selection={montageSelectionActions}
          onHoverWorld={(world) => populationSliceActions.hover(workspaceId, world, orientation)}
          onPointerOverTiles={(over) => {
            overTiles.current = over;
            if (!over) leftTilesAt.current = performance.now();
          }}
          linkedId={montageLinkedId((stripShown ? hoveredPoint : null) ?? externalHoverId, hoveredTile)}
          onHoverSubject={(id) => {
            setHoveredTile((previous) => (previous === id ? previous : id));
            // Published for the other roots (Inspector, Values dock).
            populationMemberHover.set(id, 'montage');
          }}
          strip={
            stripShown
              ? {
                  collapsed: stripCollapsed,
                  render: ({ mode }) => (
                    <SimilarityStrip
                      mode={mode}
                      collapsed={stripCollapsed}
                      onCollapsedChange={(collapsed) => setStripCollapsed(datasetKey, collapsed)}
                      measure={montageArrangement.measure}
                      selected={montageSelectedIds}
                      focusedId={studio.selection.activeMemberId}
                      linkedId={hoveredTile}
                      onHoverMember={(id) =>
                        setHoveredPoint((previous) => (previous === id ? previous : id))
                      }
                      busy={
                        montageArrangement.similarityBusy
                          ? {
                              text: `Computing similarity for ${subjects(contextIds.length)}…`,
                              onCancel: montageArrangement.cancelPending,
                            }
                          : null
                      }
                      error={montageArrangement.similarityError}
                      onUseAmplitude={montageArrangement.retryWithAmplitude}
                      onRefit={montageArrangement.refit}
                      showing={
                        montageArrangement.groupedBySimilarity ? montageArrangement.groupCount : null
                      }
                      sliceService={service}
                    />
                  ),
                }
              : null
          }
          notice={issue ? <PopulationIssueNotice issue={issue} /> : null}
          emptyText={
            snapshot.pending
              ? 'Reading the maps…'
              : result
                ? 'No subjects to show.'
                : 'Choose an audited volume set.'
          }
          footer={{
            // The montage shows every subject at once: no transport or place.
            description: montageFooterText({
              shown: result?.data.cutouts
                ? tileIds.filter((id) =>
                    result.data.cutouts!.members.some((member) => member.memberId === id),
                  ).length
                : 0,
              total: montageGroupList
                ? montageGroupList.reduce((n, group) => n + group.memberIds.length, 0)
                : galleryIds.length,
              sort: montageArrangement.sort,
              reversed: montageArrangement.reversed,
              groups: montageGroupList ? montageGroupList.length : null,
              sortSimilarity: montageArrangement.sortSimilarity,
              groupSimilarity: montageArrangement.groupSimilarity,
              previous: montageStale,
              updating: snapshot.pending,
              orderNote,
              resolutionNote: current
                ? resolutionNote(shownTileDim, result?.data.cutouts?.nativeDimPx ?? null)
                : null,
              anatomyNote: result
                ? populationAnatomyStatus(result).replace(/^ · /, '').toLowerCase() || null
                : null,
            }),
            // Similarity's own failure and progress are said in the strip.
            error:
              (stripShown && montageArrangement.error === montageArrangement.similarityError
                ? null
                : montageArrangement.error) ?? selectionError,
            errorAction:
              !stripShown && montageArrangement.retryWithAmplitude
                ? {
                    label: 'Use amplitude instead',
                    onClick: montageArrangement.retryWithAmplitude,
                  }
                : null,
            busy:
              montageArrangement.computing &&
              !(stripShown && montageArrangement.similarityBusy)
                ? {
                    text: `Computing ${montageArrangement.computing} for ${subjects(contextIds.length)}…`,
                    onCancel: montageArrangement.cancelPending,
                  }
                : null,
            dataLimit: result?.data.contextRange
              ? Math.max(
                  Math.abs(result.data.contextRange[0]),
                  Math.abs(result.data.contextRange[1]),
                )
              : null,
            dataRange: result?.data.contextRange ?? null,
            scaleIdentity: `${studio.selection.activeSetId}:${studio.selection.activeFeatureId}`,
            limit: result?.effectLimit ?? null,
            onLimit: (limit) => service.setEffectLimit(limit),
            onFit: result?.data.contextRange ? () => service.fitEffectScale() : undefined,
            page: { page: page + 1, count: pages, onPage: (next) => setCutoutPage(next - 1) },
          }}
        />
      )}
      {/* One line below the images: the transport, the status, the shared scale. */}
      {!montage && (
        <MontageFooter
          // Grouped Summary shows group effects, not a subject: no transport.
          transport={grouped ? null : transport}
          description={summaryStatus}
          limit={result?.effectLimit ?? null}
          onLimit={(limit) => service.setEffectLimit(limit)}
          onFit={result?.data.contextRange ? () => service.fitEffectScale() : undefined}
          dataLimit={
            result?.data.contextRange
              ? Math.max(Math.abs(result.data.contextRange[0]), Math.abs(result.data.contextRange[1]))
              : null
          }
          dataRange={result?.data.contextRange ?? null}
          scaleIdentity={`${studio.selection.activeSetId}:${studio.selection.activeFeatureId}`}
          summaryLimit={
            result && !populationSharesEffectScale(result.query.request)
              ? { value: result.summaryLimit, onChange: (value) => service.setSummaryLimit(value) }
              : null
          }
          page={
            grouped && groupPages > 1
              ? {
                  page: currentGroupPage + 1,
                  count: groupPages,
                  onPage: (next) => setGroupPage(next - 1),
                  label: 'Groups',
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
