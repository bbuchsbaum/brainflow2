import { Button, Notice, NumberField, SegmentedControl, Select } from '@/components/ui/bf';
import { inferenceChannelNames, inferenceChannel } from '@/services/studio/inferenceCatalog';
import { PopulationInferenceControls } from './PopulationInferenceControls';
import { selectInferenceChannel } from '@/services/studio/populationInference';
import {
  populationDiverging,
  populationSharesEffectScale,
} from '@/services/studio/PopulationSliceService';
import { PopulationRelationshipPanel } from './PopulationRelationshipPanel';
import { populationRelationshipService } from '@/services/studio/PopulationRelationshipService';
import { PopulationGroupViews } from './PopulationGroupViews';
import { PopulationSelectionRange } from './PopulationSelectionRange';
import { PopulationNavigation } from './PopulationNavigation';
import { PopulationExportControls } from './PopulationExportControls';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import {
  populationArrangementLabel,
  populationBindingKey,
  populationOrderSourceStatus,
} from '@/services/studio/populationWitnesses';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReusableSliceViewport,
  SliceViewerImageSurface,
  clientPointToWorld,
  type SliceViewerPlacement,
} from '@/components/views/sliceViewer';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { getLineDash } from '@/utils/crosshairUtils';
import { PopulationCutoutGrid } from './PopulationCutoutGrid';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import {
  populationSupportKey,
  buildPopulationProbeQuery,
  PopulationProbeController,
} from '@/services/studio/PopulationProbeController';
import { resolvePopulation } from '@/services/studio/populationContext';
import {
  buildPopulationSliceQuery,
  populationSliceActions,
  populationAxisLabel,
  PopulationSliceService,
  type PopulationOrientation,
  type PopulationSummary,
} from '@/services/studio/PopulationSliceService';
import { formatWorldPoint } from '@/utils/valueFormat';

const names: Record<PopulationSummary, string> = {
  mean: 'Mean',
  median: 'Median',
  mad: 'Median absolute deviation (unscaled)',
  sampleSd: 'Observed sample SD',
  cancellation: 'Cancellation',
  meanAbsolute: 'Mean absolute magnitude',
  coverage: 'Coverage',
};

/** Both panes use Brainflow's shared viewport geometry and image surface. The
 * service supplies visible-support bitmaps, so no global GPU layer is registered. */
const noProbeSubscription = () => () => {};
const noProbeSnapshot = () => null;
export function PopulationLens({
  service: supplied,
  probeController,
}: { service?: PopulationSliceService; probeController?: PopulationProbeController } = {}) {
  const studio = useSetStudioStore();
  const workspaceId = useViewStateStore((state) => state.activeWorkspaceKey);
  const crosshair = useViewStateStore((state) => state.viewState.crosshair);
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
  const canArrange =
    !!studio.population.pinnedProbe &&
    !!probeSnapshot?.displayed &&
    !probeSnapshot.pending &&
    !probeSnapshot.error &&
    probeSnapshot.displayed.query.key === probeDefinition.query?.key;
  const hasFiniteResponse =
    probeSnapshot?.displayed?.frame.rows.some(
      (row) => typeof row.value === 'number' && Number.isFinite(row.value),
    ) ?? false;
  const [orientation, setOrientation] = useState<PopulationOrientation>('axial');
  const [summary, setSummary] = useState<PopulationSummary>('mean');
  const [zoom, setZoom] = useState(1);
  const [withoutFocused, setWithoutFocused] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [showCutouts, setShowCutouts] = useState(false);
  const [cutoutWidth, setCutoutWidth] = useState(32);
  const [cutoutPage, setCutoutPage] = useState(0);
  const [groupPage, setGroupPage] = useState(0);
  useEffect(() => {
    const restored = studio.population.restoredView;
    setOrientation(restored?.orientation ?? 'axial');
    setSummary(restored?.summary ?? 'mean');
    setZoom(restored?.zoom ?? 1);
    setWithoutFocused(false);
    setShowCutouts(false);
    setCutoutPage(0);
    setGroupPage(0);
  }, [studio.population.sessionRevision, studio.population.restoredView]);

  const population = useMemo(() => resolvePopulation(studio), [studio]);
  const participants = useMemo(
    () => resolvePopulationParticipants(studio, population.workingMemberIds),
    [studio, population.workingMemberIds],
  );
  const previewParticipant =
    !!participants.identity &&
    (previewTarget ??
      (studio.population.participants?.reduction !== 'observations'
        ? 'participant'
        : 'observation')) === 'participant';
  const previewSet = useMemo(() => {
    if (previewTarget?.startsWith('group:'))
      return studio.population.partition?.groups.find((g) => `group:${g.id}` === previewTarget);
    if (previewTarget?.startsWith('set:')) return studio.cohorts[previewTarget.slice(4)];
    return null;
  }, [previewTarget, studio.population.partition, studio.cohorts]);
  const previewLabel = previewSet
    ? `${previewSet.label} (${previewSet.memberIds.length} ${previewSet.memberIds.length === 1 ? 'observation' : 'observations'})`
    : `focused ${previewParticipant ? 'participant' : 'observation'}`;
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
    studio.population.inference?.setId === studio.selection.activeSetId
      ? studio.population.inference
      : null;
  const groupPages = Math.max(1, Math.ceil((studio.population.partition?.groups.length ?? 0) / 4));
  const currentGroupPage = Math.min(groupPage, groupPages - 1);
  const contributors =
    presentation.arrangement === 'montage'
      ? studio.population.partition?.groups.find((g) => g.id === presentation.contributorsGroupId)
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
  const orderedIds = useMemo(
    () => savedOrder?.orderedIds ?? arrangement?.orderedIds ?? population.context.memberIds,
    [savedOrder, arrangement, population.context.memberIds],
  );
  // Stable IDs prevent focus updates from restarting playback.
  const orderKey = JSON.stringify(
    contributors ? orderedIds.filter((id) => contributors.memberIds.includes(id)) : orderedIds,
  );
  const navigationIds = useMemo(() => JSON.parse(orderKey) as string[], [orderKey]);
  const galleryIds = montage
    ? navigationIds
    : arrangement
      ? arrangement.mode === 'witnesses'
        ? arrangement.witnessIds
        : arrangement.orderedIds
      : population.context.memberIds;
  const pages = Math.max(1, Math.ceil(galleryIds.length / 80));
  const focusPage = Math.floor(
    Math.max(0, galleryIds.indexOf(studio.selection.activeMemberId ?? '')) / 80,
  );
  const page = Math.min(cutoutPage, pages - 1);
  useEffect(() => {
    if (montage) setCutoutPage(focusPage);
  }, [montage, focusPage]);
  const pinned = studio.population.pinnedProbe;
  const currentProbe =
    pinned?.supportKey === populationSupportKey(studio, workspaceId) ? pinned : null;
  const cutouts = useMemo(
    () =>
      montage || (showCutouts && currentProbe)
        ? {
            wholePlane: montage && (!currentProbe || presentation.montageScope === 'plane'),
            centerMm: [...(currentProbe?.worldMm ?? crosshair.world_mm)] as [
              number,
              number,
              number,
            ],
            widthMm: cutoutWidth,
            dimPx: 40,
            memberIds: galleryIds.slice(page * 80, (page + 1) * 80),
          }
        : null,
    [
      montage,
      presentation.montageScope,
      showCutouts,
      currentProbe,
      crosshair.world_mm,
      cutoutWidth,
      galleryIds,
      page,
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
  const paneHeight = compact ? 220 : 320;
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
    service.start();
    return () => service.stop();
  }, [service]);
  useEffect(() => {
    service.request(definition.query ? { ...definition.query, focusOrder: navigationIds } : null);
  }, [service, definition.query, navigationIds]);
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
  const issue = definition.issue ?? snapshot.error;
  const moveSlice = (direction: number) => {
    if (result && current)
      populationSliceActions.step(workspaceId, result.data.plane, crosshair.world_mm, direction);
  };
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
  return (
    <section
      aria-label="Population brain views"
      className="flex min-h-0 flex-col gap-2 rounded-sm border border-border bg-card p-3"
    >
      <details className="text-bf-sm">
        <summary className="w-fit cursor-pointer rounded-sm border border-border px-2 py-1 text-muted-foreground hover:bg-accent">
          Save calculation
        </summary>
        <div className="pt-2">
          <PopulationExportControls display={result} current={current && !snapshot.pending} />
        </div>
      </details>
      <p className="text-bf-md font-medium">
        Population ·{' '}
        {studio.features[studio.selection.activeFeatureId ?? '']?.label ?? 'Selected feature'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-bf-sm">
          {activeTest ? 'Channel' : 'Summary'}{' '}
          <Select className="w-auto max-w-full"
            aria-label={activeTest ? 'Displayed test channel' : 'Summary'}
            disabled={comparing || grouped}
            value={activeTest?.channel ?? (comparing || grouped ? 'mean' : summary)}
            onChange={(event) =>
              activeTest
                ? selectInferenceChannel(event.target.value as typeof activeTest.channel)
                : setSummary(event.target.value as PopulationSummary)
            }
          >
            {Object.entries(activeTest ? inferenceChannelNames(activeTest.method) : names).map(
              ([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ),
            )}
          </Select>
        </label>
        <label className="text-bf-sm">
          Plane{' '}
          <Select className="w-auto max-w-full"
            aria-label="Plane"
            value={orientation}
            onChange={(event) => setOrientation(event.target.value as PopulationOrientation)}
          >
            <option value="axial">Axial</option>
            <option value="coronal">Coronal</option>
            <option value="sagittal">Sagittal</option>
          </Select>
        </label>
        <label className="text-bf-sm">
          Zoom{' '}
          <Select className="w-auto max-w-full"
            aria-label="Zoom"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {[...new Set([0.5, 1, 2, 4, 8, zoom])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
          </Select>
        </label>
        <Button variant="secondary" size="sm"
          disabled={!current}
          onClick={() => moveSlice(-1)}
          aria-label="Previous population slice"
        >
          −1 mm
        </Button>
        <Button variant="secondary" size="sm"
          disabled={!current}
          onClick={() => moveSlice(1)}
          aria-label="Next population slice"
        >
          +1 mm
        </Button>
        <Button variant="secondary" size="sm"
          disabled={!result}
          onClick={() =>
            result && populationSliceActions.navigate(workspaceId, result.data.centerWorld)
          }
        >
          Center brain
        </Button>
        <Button variant="secondary" size="sm"
          disabled={!definition.query || snapshot.pending}
          onClick={() => service.request(definition.query, true)}
        >
          Refresh images
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-bf-sm">
        {(participants.identity ||
          studio.population.partition ||
          studio.sets[studio.selection.activeSetId ?? '']?.savedCohortIds.length) && (
          <label>
            Preview exclusion{' '}
            <Select className="w-auto max-w-full"
              aria-label="Preview exclusion unit"
              value={
                previewSet ? previewTarget! : previewParticipant ? 'participant' : 'observation'
              }
              onChange={(event) => setPreviewTarget(event.target.value)}
            >
              <option value="observation">Focused observation</option>
              {participants.identity && <option value="participant">Focused participant</option>}
              {studio.population.partition?.groups.map((g) => (
                <option key={`group:${g.id}`} value={`group:${g.id}`}>
                  Group: {g.label} (observations)
                </option>
              ))}
              {studio.sets[studio.selection.activeSetId ?? '']?.savedCohortIds.map(
                (id) =>
                  studio.cohorts[id] && (
                    <option key={`set:${id}`} value={`set:${id}`}>
                      Set: {studio.cohorts[id].label} (observations)
                    </option>
                  ),
              )}
            </Select>
          </label>
        )}
        <Button variant="secondary" size="sm"
          disabled={
            (!previewSet && !studio.selection.activeMemberId) ||
            (previewParticipant &&
              !participants.identity?.has(studio.selection.activeMemberId ?? ''))
          }
          title={
            previewParticipant && !participants.identity?.has(studio.selection.activeMemberId ?? '')
              ? 'The focused observation has no saved participant identity.'
              : undefined
          }
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setWithoutFocused(true);
          }}
          onPointerUp={() => setWithoutFocused(false)}
          onPointerCancel={() => setWithoutFocused(false)}
          onBlur={() => setWithoutFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setWithoutFocused(false);
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              setWithoutFocused(true);
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') setWithoutFocused(false);
          }}
        >
          Hold to preview without {previewLabel}
        </Button>
        {withoutFocused && (
          <span role="status">
            Temporary preview without{' '}
            {previewSet
              ? previewLabel
              : previewParticipant
                ? `participant ${participants.identity?.get(studio.selection.activeMemberId ?? '')}`
                : `observation ${studio.selection.activeMemberId}`}
            ; selection retained.
          </span>
        )}
      </div>
      {issue && (
        <Notice role="alert" severity="danger">
          {issue}
        </Notice>
      )}
      <PopulationInferenceControls />
      <PopulationRelationshipPanel />
      <PopulationNavigation
        ids={navigationIds}
        focusedId={studio.selection.activeMemberId}
        ready={current && !snapshot.pending}
        failed={!!issue}
        scope={`${workspaceId}:${studio.population.sessionRevision}:${studio.selection.activeFeatureId}`}
        onFocus={populationProbeActions.focus}
        label={
          savedOrderLabel ??
          (arrangement ? populationArrangementLabel(arrangement) : 'Source order')
        }
      />
      <PopulationSelectionRange
        ids={navigationIds}
        origin={
          savedOrder || arrangement
            ? 'map-derived'
            : contributors
              ? (studio.population.partition?.origin ?? 'metadata')
              : 'manual'
        }
        scope={`${workspaceId}:${studio.population.sessionRevision}`}
      />
      <div
        className="flex flex-wrap items-center gap-2 text-bf-sm"
        aria-label="Population arrangement"
      >
        <SegmentedControl
          aria-label="Population view"
          hideWhenSingle={false}
          options={(
            [
              'inspect',
              'montage',
              ...(studio.population.partition ? (['groups'] as const) : []),
            ] as const
          ).map((value) => ({
            value,
            label: value === 'inspect' ? 'Inspect' : value === 'groups' ? 'Groups' : 'Montage',
          }))}
          value={presentation.arrangement}
          onValueChange={(value) =>
            studio.setPopulationPresentation({
              ...presentation,
              arrangement: value as typeof presentation.arrangement,
              contributorsGroupId: undefined,
            })
          }
        />
        <Button variant="secondary" size="sm" disabled={!canArrange} onClick={() => fitOrder('all')}>
          Order observations by pinned response
        </Button>
        {(savedOrder || arrangement) && (
          <Button variant="secondary" size="sm"
            onClick={() => {
              probeController?.clearArrangement();
              studio.setPopulationPresentation({ ...presentation, order: null });
            }}
          >
            Restore source order
          </Button>
        )}
      </div>
      {comparing && (
        <div
          className="flex flex-wrap items-center gap-2 text-bf-sm"
          aria-label="Descriptive comparison"
        >
          <span>
            A: {result?.data.eligibleCount ?? population.workingMemberIds.length} observations · B:{' '}
            {population.referenceMemberIds.length} · overlap:{' '}
            {population.referenceMemberIds.filter((id) => selectedIds.has(id)).length} observations.
            Descriptive means; not a t-test.
          </span>
          <Button variant="secondary" size="sm"
            onClick={() =>
              studio.setPopulationPresentation({
                ...presentation,
                arrangement: difference ? 'comparison' : 'difference',
              })
            }
          >
            {difference ? 'Expand A and B' : 'Show A − B'}
          </Button>
        </div>
      )}
      {grouped && groupPages > 1 && (
        <div className="flex gap-2 text-bf-sm">
          <Button variant="secondary" size="sm"
            disabled={currentGroupPage === 0}
            onClick={() => setGroupPage(currentGroupPage - 1)}
          >
            Previous groups
          </Button>
          <span>
            Groups page {currentGroupPage + 1} / {groupPages}
          </span>
          <Button variant="secondary" size="sm"
            disabled={currentGroupPage + 1 === groupPages}
            onClick={() => setGroupPage(currentGroupPage + 1)}
          >
            Next groups
          </Button>
        </div>
      )}
      <div ref={host} className="min-w-0">
        {grouped && result && (
          <PopulationGroupViews
            display={result}
            width={width}
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
              <div className="mb-1 flex min-w-0 justify-between gap-2 text-bf-sm">
                <span className="truncate">
                  {pane === 'summary'
                    ? `${result?.query.request.inference ? inferenceChannel(result.query.request.inference).label : result?.query.request.difference ? 'A − B mean difference' : result?.query.request.reference ? 'A mean' : names[result?.query.request.summary ?? summary]} · ${result?.query.request.inference && result.data.reference ? `A ${result.data.unitCount} / B ${result.data.reference.unitCount}` : (result?.data.unitCount ?? 0)} ${result?.query.request.aggregation ? 'participants' : 'observations'}`
                    : pane === 'reference'
                      ? `B mean · ${result?.data.reference?.unitCount ?? 0} analysis units`
                      : `Actual observation · ${result?.query.request.focusMemberId ?? 'none'}${result?.query.request.focusStackIndex !== undefined ? ` · frame ${result.query.request.focusStackIndex + 1}` : ''}`}
                </span>
                {result && (
                  <span className="shrink-0 tabular-nums">
                    {pane === 'summary' && !populationDiverging(result.query.request) ? '0' : '−'}
                    {pane === 'summary' && !populationDiverging(result.query.request)
                      ? ''
                      : (pane === 'summary' ? result.summaryLimit : result.effectLimit).toPrecision(
                          3,
                        )}{' '}
                    to{' '}
                    {(pane === 'summary' ? result.summaryLimit : result.effectLimit).toPrecision(3)}
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
                    if (current) populationSliceActions.navigate(workspaceId, world, true);
                  }}
                  renderSurface={(props) => (
                    <SliceViewerImageSurface
                      {...props}
                      image={result?.images[pane] ?? null}
                      emptyFallback={
                        <p className="absolute inset-0 grid place-items-center text-bf-sm text-muted-foreground">
                          {snapshot.pending ? 'Evaluating population…' : 'No population image'}
                        </p>
                      }
                    />
                  )}
                />
                {result && (
                  <div
                    className="pointer-events-none absolute inset-0 text-bf-sm text-white/80"
                    aria-hidden
                  >
                    <span className="absolute left-1 top-1/2">
                      {populationAxisLabel(result.data.plane.u_mm.map((v) => -v))}
                    </span>
                    <span className="absolute right-1 top-1/2">
                      {populationAxisLabel(result.data.plane.u_mm)}
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
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-bf-sm">
        <p role="status" className="text-muted-foreground">
          {result
            ? `${result.query.request.orientation} · (${formatWorldPoint(result.query.request.crosshairMm)}) mm · nearest voxel`
            : 'Choose an audited volume set.'}
          {result && !current && ' · previous query'}
          {snapshot.pending && ' · updating'}
        </p>
        <label>
          Value scale ±{' '}
          <NumberField
            aria-label="Population value scale limit"
            fieldClassName="w-20"
            min="0.000001"
            step="any"
            value={result?.effectLimit ?? 1}
            onChange={(event) => service.setEffectLimit(event.target.valueAsNumber)}
          />
        </label>
        {result && !populationSharesEffectScale(result.query.request) && (
          <label>
            Summary maximum{' '}
            <NumberField
              aria-label="Population summary scale maximum"
              fieldClassName="w-20"
              min="0.000001"
              step="any"
              value={result.summaryLimit}
              onChange={(event) => service.setSummaryLimit(event.target.valueAsNumber)}
            />
          </label>
        )}
        <Button variant="secondary" size="sm"
          disabled={!result?.data.contextRange}
          onClick={() => service.fitEffectScale()}
        >
          Fit scale to visible context
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-bf-sm">
        <Button variant="secondary" size="sm"
          hidden={montage}
          aria-expanded={showCutouts}
          disabled={!population.context.memberIds.length}
          onClick={() => {
            if (!showCutouts && !currentProbe) populationProbeActions.pin(0, false);
            setShowCutouts((value) => !value);
          }}
        >
          {showCutouts ? 'Hide individual cutouts' : 'Show individual cutouts'}
        </Button>
        {(showCutouts || montage) && (
          <>
            {montage && (
              <label>
                Preview support{' '}
                <Select className="w-auto max-w-full"
                  aria-label="Montage support"
                  value={currentProbe && presentation.montageScope !== 'plane' ? 'probe' : 'plane'}
                  onChange={(e) =>
                    studio.setPopulationPresentation({
                      ...presentation,
                      montageScope: e.target.value as 'plane' | 'probe',
                    })
                  }
                >
                  <option value="plane">Whole plane</option>
                  <option value="probe" disabled={!currentProbe}>
                    Pinned region
                  </option>
                </Select>
              </label>
            )}
            <label>
              Cutout width{' '}
              <Select className="w-auto max-w-full"
                disabled={montage && (!currentProbe || presentation.montageScope === 'plane')}
                value={cutoutWidth}
                onChange={(event) => setCutoutWidth(Number(event.target.value))}
              >
                {[16, 24, 32, 48, 64, 96].map((mm) => (
                  <option key={mm} value={mm}>
                    {mm} mm
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="secondary" size="sm" onClick={() => populationProbeActions.pin(0, false)}>
              Center cutouts on crosshair
            </Button>
            {probeController && !montage && (
              <>
                <Button variant="secondary" size="sm"
                  disabled={!canArrange}
                  onClick={() => {
                    fitOrder('all');
                    setCutoutPage(0);
                  }}
                >
                  Order by pinned response
                </Button>
                <Button variant="secondary" size="sm"
                  disabled={!canArrange || !hasFiniteResponse}
                  onClick={() => {
                    fitOrder('witnesses');
                    setCutoutPage(0);
                  }}
                >
                  Show 12 response witnesses
                </Button>
                {arrangement?.mode === 'witnesses' && (
                  <Button variant="secondary" size="sm"
                    onClick={() => {
                      probeController.expandWitnesses();
                      setCutoutPage(0);
                    }}
                  >
                    Show all observations
                  </Button>
                )}
                {arrangement && (
                  <Button variant="secondary" size="sm"
                    onClick={() => {
                      probeController.clearArrangement();
                      studio.setPopulationPresentation({ ...presentation, order: null });
                      setCutoutPage(0);
                    }}
                  >
                    Use source order
                  </Button>
                )}
              </>
            )}
            {pages > 1 && (
              <>
                <Button variant="secondary" size="sm"
                  disabled={page === 0}
                  onClick={() => setCutoutPage(Math.max(0, page - 1))}
                >
                  Previous observations
                </Button>
                <span>
                  {page + 1} / {pages}
                </span>
                <Button variant="secondary" size="sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setCutoutPage(page + 1)}
                >
                  Next observations
                </Button>
              </>
            )}
          </>
        )}
      </div>
      {(showCutouts || montage) && result?.data.cutouts && (
        <div className="min-w-0 border-t border-border pt-2">
          <p className="mb-1 text-bf-sm text-muted-foreground">
            {result.data.cutouts.members.length} of {population.context.memberIds.length}{' '}
            observations ·{' '}
            {arrangement?.mode === 'witnesses'
              ? 'actual maps sampled across finite response quantiles'
              : arrangement
                ? 'pinned-response order'
                : 'source order'}{' '}
            ·{' '}
            {result.query.request.cutouts?.wholePlane
              ? 'Whole-plane previews'
              : `${result.query.request.cutouts?.widthMm} mm cutouts`}{' '}
            at ({result.query.request.cutouts ? formatWorldPoint(result.query.request.cutouts.centerMm) : ''}
            ) mm
            {!current && ' · previous query'}
          </p>
          {arrangement && (
            <p className="mb-1 text-bf-sm text-muted-foreground">
              {populationArrangementLabel(arrangement)}.{' '}
              {arrangement.mode === 'witnesses' &&
                'Witnesses omit unavailable responses; expand to inspect every observation.'}
              {arrangement.query.key !== probeDefinition.query?.key &&
                ' Order remains fixed from its earlier probe.'}
              {orderSourceStatus === 'changed' &&
                ' Images have newer source revisions; recompute the response order.'}
              {orderSourceStatus === 'unknown' &&
                ' Source revision agreement for this order is unverified.'}
            </p>
          )}
          <PopulationCutoutGrid
            display={result}
            width={width}
            focusedId={studio.selection.activeMemberId}
            selectedIds={selectedIds}
            onFocus={populationProbeActions.focus}
            onToggle={populationProbeActions.toggle}
            onHover={(world) =>
              populationSliceActions.hover(workspaceId, world, result.query.request.orientation)
            }
          />
        </div>
      )}
      {result && (
        <details className="text-bf-sm text-muted-foreground">
          <summary className="cursor-pointer">Coverage and source revisions</summary>
          <p className="my-1">
            {result.query.request.members.length} eligible observations; {result.data.eligibleCount}{' '}
            selected rows; {result.data.unitCount}{' '}
            {result.query.request.aggregation ? 'participant' : 'observation'} units. Missing
            samples are transparent; measured zero remains valid. The analysis unit is explicit in
            the summary label.
          </p>
          <div className="max-h-32 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Decoded source SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {result.data.sources.map((source) => (
                  <tr key={source.memberId}>
                    <td>{source.memberId}</td>
                    <td className="break-all font-mono">{source.revision.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-bf-sm text-muted-foreground">
        Click either image to pin a location. Mean and individual share the blue–white–red effect
        scale; magnitude, spread, cancellation and coverage use a separate gold scale. Scales stay
        fixed while browsing.
      </p>
    </section>
  );
}
