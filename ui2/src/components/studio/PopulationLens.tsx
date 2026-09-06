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

const control =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-40';
const names: Record<PopulationSummary, string> = {
  mean: 'Mean',
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
  const [previewTarget, setPreviewTarget] = useState<'observation' | 'participant' | null>(null);
  const [showCutouts, setShowCutouts] = useState(false);
  const [cutoutWidth, setCutoutWidth] = useState(32);
  const [cutoutPage, setCutoutPage] = useState(0);
  useEffect(() => {
    const restored = studio.population.restoredView;
    setOrientation(restored?.orientation ?? 'axial');
    setSummary(restored?.summary ?? 'mean');
    setZoom(restored?.zoom ?? 1);
    setWithoutFocused(false);
    setShowCutouts(false);
    setCutoutPage(0);
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
  const selectedIds = useMemo(
    () => new Set(population.workingMemberIds),
    [population.workingMemberIds],
  );
  const galleryIds = arrangement
    ? arrangement.mode === 'witnesses'
      ? arrangement.witnessIds
      : arrangement.orderedIds
    : population.context.memberIds;
  const pages = Math.max(1, Math.ceil(galleryIds.length / 80));
  const page = Math.min(cutoutPage, pages - 1);
  const pinned = studio.population.pinnedProbe;
  const currentProbe =
    pinned?.supportKey === populationSupportKey(studio, workspaceId) ? pinned : null;
  const cutouts = useMemo(
    () =>
      showCutouts && currentProbe
        ? {
            centerMm: [...currentProbe.worldMm] as [number, number, number],
            widthMm: cutoutWidth,
            dimPx: 40,
            memberIds: galleryIds.slice(page * 80, (page + 1) * 80),
          }
        : null,
    [showCutouts, currentProbe, cutoutWidth, galleryIds, page],
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
        withoutFocused,
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
      previewParticipant,
      cutouts,
    ],
  );

  useEffect(() => {
    service.start();
    return () => service.stop();
  }, [service]);
  useEffect(() => {
    service.request(definition.query);
  }, [service, definition.query]);
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
  return (
    <section
      aria-label="Population brain views"
      className="flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <details className="text-xs">
        <summary className="w-fit cursor-pointer rounded border border-border px-2 py-1 text-muted-foreground hover:bg-accent">
          Save calculation
        </summary>
        <div className="pt-2">
          <PopulationExportControls display={result} current={current && !snapshot.pending} />
        </div>
      </details>
      <p className="text-sm font-medium">
        Population ·{' '}
        {studio.features[studio.selection.activeFeatureId ?? '']?.label ?? 'Selected feature'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">
          Summary{' '}
          <select
            className={control}
            aria-label="Summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value as PopulationSummary)}
          >
            {Object.entries(names).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Plane{' '}
          <select
            className={control}
            aria-label="Plane"
            value={orientation}
            onChange={(event) => setOrientation(event.target.value as PopulationOrientation)}
          >
            <option value="axial">Axial</option>
            <option value="coronal">Coronal</option>
            <option value="sagittal">Sagittal</option>
          </select>
        </label>
        <label className="text-xs">
          Zoom{' '}
          <select
            className={control}
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
          </select>
        </label>
        <button
          className={control}
          disabled={!current}
          onClick={() => moveSlice(-1)}
          aria-label="Previous population slice"
        >
          −1 mm
        </button>
        <button
          className={control}
          disabled={!current}
          onClick={() => moveSlice(1)}
          aria-label="Next population slice"
        >
          +1 mm
        </button>
        <button
          className={control}
          disabled={!result}
          onClick={() =>
            result && populationSliceActions.navigate(workspaceId, result.data.centerWorld)
          }
        >
          Center brain
        </button>
        <button
          className={control}
          disabled={!definition.query || snapshot.pending}
          onClick={() => service.request(definition.query, true)}
        >
          Refresh images
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {participants.identity && (
          <label>
            Preview exclusion{' '}
            <select
              className={control}
              aria-label="Preview exclusion unit"
              value={previewParticipant ? 'participant' : 'observation'}
              onChange={(event) =>
                setPreviewTarget(event.target.value as 'observation' | 'participant')
              }
            >
              <option value="observation">Focused observation</option>
              <option value="participant">Focused participant</option>
            </select>
          </label>
        )}
        <button
          className={control}
          disabled={
            !studio.selection.activeMemberId ||
            (previewParticipant && !participants.identity?.has(studio.selection.activeMemberId))
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
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              setWithoutFocused(true);
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') setWithoutFocused(false);
          }}
        >
          Hold to preview without focused {previewParticipant ? 'participant' : 'observation'}
        </button>
        {withoutFocused && (
          <span role="status">
            Temporary preview without{' '}
            {previewParticipant
              ? `participant ${participants.identity?.get(studio.selection.activeMemberId ?? '')}`
              : `observation ${studio.selection.activeMemberId}`}
            ; selection retained.
          </span>
        )}
      </div>
      {issue && (
        <p role="alert" className="text-xs text-destructive">
          {issue}
        </p>
      )}
      <div ref={host} className="min-w-0">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))' }}
        >
          {(['summary', 'focused'] as const).map((pane) => (
            <div key={pane} className="min-w-0">
              <div className="mb-1 flex min-w-0 justify-between gap-2 text-xs">
                <span className="truncate">
                  {pane === 'summary'
                    ? `${names[result?.query.request.summary ?? summary]} · ${result?.data.unitCount ?? 0} ${result?.query.request.aggregation ? 'participants' : 'observations'}`
                    : `Actual observation · ${result?.query.request.focusMemberId ?? 'none'}`}
                </span>
                {result && (
                  <span className="shrink-0 tabular-nums">
                    {pane === 'summary' && result.query.request.summary !== 'mean' ? '0' : '−'}
                    {pane === 'summary' && result.query.request.summary !== 'mean'
                      ? ''
                      : result.effectLimit.toPrecision(3)}{' '}
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
                  width={paneWidth}
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
                        <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                          {snapshot.pending ? 'Evaluating population…' : 'No population image'}
                        </p>
                      }
                    />
                  )}
                />
                {result && (
                  <div
                    className="pointer-events-none absolute inset-0 text-xs text-white/80"
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p role="status" className="text-muted-foreground">
          {result
            ? `${result.query.request.orientation} · (${result.query.request.crosshairMm.map((v) => v.toFixed(1)).join(', ')}) mm · nearest voxel`
            : 'Choose an audited volume set.'}
          {result && !current && ' · previous query'}
          {snapshot.pending && ' · updating'}
        </p>
        <label>
          Value scale ±{' '}
          <input
            aria-label="Population value scale limit"
            className={`${control} w-20`}
            type="number"
            min="0.000001"
            step="any"
            value={result?.effectLimit ?? 1}
            onChange={(event) => service.setEffectLimit(event.target.valueAsNumber)}
          />
        </label>
        {result && result.query.request.summary !== 'mean' && (
          <label>
            Summary maximum{' '}
            <input
              aria-label="Population summary scale maximum"
              className={`${control} w-20`}
              type="number"
              min="0.000001"
              step="any"
              value={result.summaryLimit}
              onChange={(event) => service.setSummaryLimit(event.target.valueAsNumber)}
            />
          </label>
        )}
        <button
          className={control}
          disabled={!result?.data.contextRange}
          onClick={() => service.fitEffectScale()}
        >
          Fit scale to visible context
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          className={control}
          aria-expanded={showCutouts}
          disabled={!population.context.memberIds.length}
          onClick={() => {
            if (!showCutouts && !currentProbe) populationProbeActions.pin(0, false);
            setShowCutouts((value) => !value);
          }}
        >
          {showCutouts ? 'Hide individual cutouts' : 'Show individual cutouts'}
        </button>
        {showCutouts && (
          <>
            <label>
              Cutout width{' '}
              <select
                className={control}
                value={cutoutWidth}
                onChange={(event) => setCutoutWidth(Number(event.target.value))}
              >
                {[16, 24, 32, 48, 64, 96].map((mm) => (
                  <option key={mm} value={mm}>
                    {mm} mm
                  </option>
                ))}
              </select>
            </label>
            <button className={control} onClick={() => populationProbeActions.pin(0, false)}>
              Center cutouts on crosshair
            </button>
            {probeController && (
              <>
                <button
                  className={control}
                  disabled={!canArrange}
                  onClick={() => {
                    if (probeController.arrange('all')) setCutoutPage(0);
                  }}
                >
                  Order by pinned response
                </button>
                <button
                  className={control}
                  disabled={!canArrange || !hasFiniteResponse}
                  onClick={() => {
                    if (probeController.arrange('witnesses')) setCutoutPage(0);
                  }}
                >
                  Show 12 response witnesses
                </button>
                {arrangement?.mode === 'witnesses' && (
                  <button
                    className={control}
                    onClick={() => {
                      probeController.expandWitnesses();
                      setCutoutPage(0);
                    }}
                  >
                    Show all observations
                  </button>
                )}
                {arrangement && (
                  <button
                    className={control}
                    onClick={() => {
                      probeController.clearArrangement();
                      setCutoutPage(0);
                    }}
                  >
                    Use source order
                  </button>
                )}
              </>
            )}
            {pages > 1 && (
              <>
                <button
                  className={control}
                  disabled={page === 0}
                  onClick={() => setCutoutPage(Math.max(0, page - 1))}
                >
                  Previous observations
                </button>
                <span>
                  {page + 1} / {pages}
                </span>
                <button
                  className={control}
                  disabled={page + 1 >= pages}
                  onClick={() => setCutoutPage(page + 1)}
                >
                  Next observations
                </button>
              </>
            )}
          </>
        )}
      </div>
      {showCutouts && result?.data.cutouts && (
        <div className="min-w-0 border-t border-border pt-2">
          <p className="mb-1 text-xs text-muted-foreground">
            {result.data.cutouts.members.length} of {population.context.memberIds.length}{' '}
            observations ·{' '}
            {arrangement?.mode === 'witnesses'
              ? 'actual maps sampled across finite response quantiles'
              : arrangement
                ? 'pinned-response order'
                : 'source order'}{' '}
            · {result.query.request.cutouts?.widthMm} mm cutouts at (
            {result.query.request.cutouts?.centerMm.map((value) => value.toFixed(1)).join(', ')}) mm
            {!current && ' · previous query'}
          </p>
          {arrangement && (
            <p className="mb-1 text-xs text-muted-foreground">
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
        <details className="text-xs text-muted-foreground">
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
      <p className="text-xs text-muted-foreground">
        Click either image to pin a location. Mean and individual share the blue–white–red effect
        scale; magnitude, spread, cancellation and coverage use a separate gold scale. Scales stay
        fixed while browsing.
      </p>
    </section>
  );
}
