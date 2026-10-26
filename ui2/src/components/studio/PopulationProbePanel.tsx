import { Button, Notice, NumberField } from '@/components/ui/bf';
import { PopulationPivot } from './PopulationPivot';
import { populationPlotService } from '@/services/studio/PopulationPlotService';
import { PopulationBrush } from './PopulationBrush';
import {
  resolvePopulationParticipants,
  participantProbeFrame,
} from '@/services/studio/populationParticipants';
import {
  orderPopulationFrame,
  populationArrangementLabel,
  populationOrderSourceStatus,
} from '@/services/studio/populationWitnesses';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import {
  buildPopulationProbeQuery,
  PopulationProbeController,
  describePopulationProbe,
} from '@/services/studio/PopulationProbeController';
import type { PopulationProbe } from '@/types/population';
import type { ResolvedPlotSpec } from '@/plotting';
import { formatWorldPoint } from '@/utils/valueFormat';

const pointSpec: ResolvedPlotSpec = {
  mark: 'point',
  encoding: { x: 'member', y: 'value' },
  transforms: [],
  params: {},
};
const coordinates = (probe: PopulationProbe) =>
  formatWorldPoint(probe.worldMm);

export function PopulationProbePanel({
  controller: suppliedController,
}: { controller?: PopulationProbeController } = {}) {
  const studio = useSetStudioStore();
  const workspaceId = useViewStateStore((state) => state.activeWorkspaceKey);
  const [controller] = useState(() => suppliedController ?? new PopulationProbeController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [pinError, setPinError] = useState<string | null>(null);
  const [previewHover, setPreviewHover] = useState(false);
  const [radius, setRadius] = useState(0);
  const [nearZeroLimit, setNearZeroLimit] = useState(0);
  useEffect(() => {
    setNearZeroLimit((previous) => (previous === 0 ? previous : 0));
  }, [studio.population.sessionRevision, studio.selection.activeFeatureId]);
  const [expanded, setExpanded] = useState(true);
  const [width, setWidth] = useState(640);
  const plotRef = useRef<HTMLDivElement>(null);
  const population = useMemo(() => resolvePopulation(studio), [studio]);
  const definition = useMemo(
    () => buildPopulationProbeQuery(studio, workspaceId),
    [studio, workspaceId],
  );
  const selected = useMemo(
    () => new Set(population.workingMemberIds),
    [population.workingMemberIds],
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    controller.request(definition.query);
  }, [controller, definition.query]);
  useEffect(() => {
    const next = population.probe?.radiusMm;
    if (next !== undefined) setRadius((previous) => (previous === next ? previous : next));
  }, [population.probe?.radiusMm]);
  useEffect(() => {
    if (!plotRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(plotRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!previewHover) return;
    return populationProbeActions.followHover(radius, workspaceId);
  }, [previewHover, radius, workspaceId]);

  const updateRadius = (next: number) => {
    if (!Number.isFinite(next) || next < 0) return;
    setRadius(next);
    populationProbeActions.setRadius(next);
  };
  const result = snapshot.displayed;
  const participants = useMemo(
    () => resolvePopulationParticipants(studio, population.workingMemberIds),
    [studio, population.workingMemberIds],
  );
  const participantMode =
    !!studio.population.participants && studio.population.participants.reduction !== 'observations';
  const analysis = useMemo(() => {
    if (!result || (participantMode && participants.issue))
      return { frame: undefined, issue: null };
    try {
      return {
        frame: participants.aggregation
          ? participantProbeFrame(result.frame, participants.aggregation)
          : result.frame,
        issue: null,
      };
    } catch (error) {
      // An earlier query may remain visible while the current context is sampled.
      // Its rows must never be silently reused as a complete new participant set.
      return { frame: undefined, issue: error instanceof Error ? error.message : String(error) };
    }
  }, [result, participantMode, participants]);
  const analysisFrame = analysis.frame;
  const analysisSelected = useMemo(
    () =>
      participantMode ? new Set(participants.groups.map((group) => group.participantId)) : selected,
    [participantMode, participants.groups, selected],
  );
  const unit = participantMode ? 'participants' : 'observations';
  const plotFrame = useMemo(() => {
    if (!result) return null;
    const frame = orderPopulationFrame(result.frame, snapshot.arrangement);
    return participants.identity
      ? {
          ...frame,
          columns: [
            ...frame.columns.filter((column) => column.name !== 'participant'),
            { name: 'participant', role: 'nominal' as const },
          ],
          rows: frame.rows.map((row) => ({
            ...row,
            participant: participants.identity!.get(String(row.member)) ?? null,
          })),
          meta: { ...frame.meta, participantDefinition: studio.population.participants },
        }
      : frame;
  }, [result, snapshot.arrangement, participants.identity, studio.population.participants]);
  const orderSourceStatus =
    snapshot.arrangement && result
      ? populationOrderSourceStatus(
          snapshot.arrangement,
          (result.frame.meta?.sources ?? []).map((source) => ({
            memberId: source.memberId,
            sha256: source.sourceRevision?.sha256 ?? null,
            maskSha256: source.maskRevision?.sha256,
          })),
        )
      : 'unknown';
  const current = result?.query.key === definition.query?.key;
  const distribution = useMemo(
    () => describePopulationProbe(analysisFrame, analysisSelected, nearZeroLimit),
    [analysisFrame, analysisSelected, nearZeroLimit],
  );
  const { mean, count, unavailable } = distribution;
  const share = (n: number) => (count ? `${((100 * n) / count).toFixed(1)}%` : 'unavailable');
  const issue = definition.issue ?? participants.issue ?? analysis.issue ?? snapshot.error;

  return (
    <section
      aria-label="Population values"
      className="shrink-0 rounded-sm border border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-bf-md font-medium">
          Population values{' '}
          <span className="ml-2 text-bf-sm text-muted-foreground">
            {selected.size} selected / {population.context.memberIds.length} observations
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result && (
            <Button variant="secondary" size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Hide values' : 'Show values'}
            </Button>
          )}
          <label className="flex items-center gap-1 text-bf-sm">
            <input
              type="checkbox"
              checked={previewHover}
              onChange={(event) => setPreviewHover(event.target.checked)}
            />{' '}
            Preview hover
          </label>
          <label className="flex items-center gap-1 text-bf-sm">
            Radius{' '}
            <NumberField
              aria-label="Probe radius in millimetres"
              min={0}
              step={1}
              value={radius}
              onChange={(event) => updateRadius(event.target.valueAsNumber)}
              fieldClassName="w-20"
              unit="mm"
            />
          </label>
          <Button variant="secondary" size="sm"
            onClick={() => populationProbeActions.pin(radius, previewHover)}
            disabled={!studio.selection.activeSetId}
          >
            {previewHover && studio.population.hoverProbe ? 'Pin preview' : 'Pin crosshair'}
          </Button>
          {studio.population.pinnedProbe && (
            <Button variant="secondary" size="sm" onClick={populationProbeActions.unpin}>
              Unpin
            </Button>
          )}
          <Button variant="secondary" size="sm"
            onClick={() => controller.request(definition.query, true)}
            disabled={!definition.query || snapshot.pending}
          >
            Refresh
          </Button>
        </div>
      </div>
      {issue && (
        <Notice role="alert" severity="danger" className="mt-2">
          {issue}
        </Notice>
      )}
      <div className="mt-1 text-bf-sm text-muted-foreground" role="status">
        {result ? (
          <>
            Showing ({coordinates(result.query.probe)}) mm ·{' '}
            {result.query.probe.radiusMm ? `${result.query.probe.radiusMm} mm sphere` : 'point'} ·{' '}
            {studio.population.pinnedProbe ? 'pinned' : 'preview'}
            {!current && ' · previous query'}
            {snapshot.pending && ' · updating'}
          </>
        ) : snapshot.pending ? (
          'Sampling observations…'
        ) : (
          'Pin a brain location to inspect every observation.'
        )}
      </div>
      {snapshot.arrangement && (
        <p className="mt-1 text-bf-sm text-muted-foreground">
          {populationArrangementLabel(snapshot.arrangement)} · plot shows every observation
          {snapshot.arrangement.query.key !== result?.query.key &&
            ' · order fitted at an earlier probe'}
          {orderSourceStatus === 'changed' && ' · source revisions changed; order remains fixed'}
          {orderSourceStatus === 'unknown' && ' · order source revisions unverified'}
        </p>
      )}
      {pinError && (
        <Notice role="alert" severity="danger">
          {pinError}
        </Notice>
      )}
      <div ref={plotRef} className="min-w-0">
        {result && plotFrame && (
          <Button variant="secondary" size="sm"
            disabled={snapshot.pending || result.query.key !== snapshot.requested?.key}
            onClick={() => {
              try {
                populationPlotService.pin(result, plotFrame);
                setPinError(null);
              } catch (error) {
                setPinError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            Compose in Plot
          </Button>
        )}
        {result && plotFrame && expanded && (
          <PopulationBrush horizontal scope={definition.query?.key ?? 'no-probe'}>
            <PlotEncoder
              frame={plotFrame}
              spec={pointSpec}
              width={width}
              height={160}
              context={{
                datumLink: {
                  idColumn: 'member',
                  focusedId: studio.selection.activeMemberId,
                  selectedIds: selected,
                  onFocus: populationProbeActions.focus,
                  onToggleSelection: populationProbeActions.toggle,
                },
              }}
            />
          </PopulationBrush>
        )}
      </div>
      {result && studio.population.partition?.factorColumns && (
        <PopulationPivot
          key={JSON.stringify(studio.population.partition)}
          partition={studio.population.partition}
          frame={result.frame}
          current={result.query.key === definition.query?.key}
        />
      )}
      {result && expanded && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-bf-sm">
            <p>
              Selected mean: {mean === null ? 'unavailable' : mean.toPrecision(4)} · {count} finite{' '}
              {unit}
              {unavailable > 0 && ` · ${unavailable} unavailable ${unit}`}
            </p>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={populationProbeActions.selectAll}>
                All
              </Button>
              <Button variant="secondary" size="sm" onClick={populationProbeActions.selectNone}>
                None
              </Button>
              <Button variant="secondary" size="sm"
                onClick={populationProbeActions.selectFocused}
                disabled={
                  !population.context.memberIds.includes(studio.selection.activeMemberId ?? '')
                }
              >
                Focused only
              </Button>
              <Button variant="secondary" size="sm"
                onClick={populationProbeActions.undoSelection}
                disabled={!studio.population.selectionPast.length}
              >
                Undo selection
              </Button>
            </div>
          </div>
          <div
            className="mt-2 rounded-sm border border-border px-2 py-1 text-bf-sm"
            aria-label="Observed response distribution"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Observed sign share · {unit} in working selection</span>
              <label>
                Near zero ±{' '}
                <NumberField
                  aria-label="Near-zero response limit"
                  fieldClassName="w-20"
                  min={0}
                  step="any"
                  value={nearZeroLimit}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    if (Number.isFinite(next) && next >= 0)
                      setNearZeroLimit((previous) => (previous === next ? previous : next));
                  }}
                />{' '}
                value units
              </label>
            </div>
            <p className="mt-1" data-testid="population-sign-counts">
              Negative {distribution.negative} ({share(distribution.negative)}) · Near zero{' '}
              {distribution.nearZero} ({share(distribution.nearZero)}) · Positive{' '}
              {distribution.positive} ({share(distribution.positive)})
            </p>
            {count > 0 && (
              <div aria-hidden className="mt-1 flex h-2 overflow-hidden rounded-sm">
                <span
                  className="bg-blue-500"
                  style={{ width: `${(100 * distribution.negative) / count}%` }}
                />
                <span
                  className="bg-gray-500"
                  style={{ width: `${(100 * distribution.nearZero) / count}%` }}
                />
                <span
                  className="bg-red-500"
                  style={{ width: `${(100 * distribution.positive) / count}%` }}
                />
              </div>
            )}
            <p className="mt-1 text-muted-foreground">
              {count} finite / {analysisSelected.size} selected {unit} ·{' '}
              {distribution.selectedMissing} unavailable. Near-zero endpoints are included.
            </p>
            <p className="mt-1">
              Mean absolute response:{' '}
              {distribution.meanAbsolute === null
                ? 'unavailable'
                : distribution.meanAbsolute.toPrecision(4)}{' '}
              · Cancellation across responses:{' '}
              {distribution.cancellation === null
                ? 'unavailable'
                : distribution.cancellation.toPrecision(4)}
            </p>
            {participantMode && (
              <p className="mt-1 text-muted-foreground">
                Summaries use equal participant weights after{' '}
                {studio.population.participants?.reduction === 'mean'
                  ? 'averaging selected observation responses within each person'
                  : 'requiring one selected observation per person'}
                . Plot points and cutouts remain original observations.
              </p>
            )}
            {result.query.probe.radiusMm > 0 && (
              <p className="mt-1 text-muted-foreground">
                Each response is the {result.query.probe.reduce} within this sphere. These summaries
                combine observation responses; population images summarize each voxel separately.
              </p>
            )}
          </div>
          <p className="mt-1 text-bf-sm text-muted-foreground">
            Click a point to focus its image. Shift-click to change selection. Selection changes
            reuse these sampled values.
          </p>
          <details className="mt-1 text-bf-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Observation values and source status
            </summary>
            <div className="mt-1 max-h-40 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Observation</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frame.rows.map((row) => {
                    const id = String(row.member);
                    const source = result.frame.meta?.sources?.find(
                      (source) => source.memberId === id,
                    );
                    return (
                      <tr key={id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${id}`}
                            checked={selected.has(id)}
                            onChange={() => populationProbeActions.toggle(id)}
                          />
                        </td>
                        <td>
                          <Button
                            variant="link"
                            size="sm"
                            className="min-h-6 font-mono"
                            onClick={() => populationProbeActions.focus(id)}
                          >
                            {id}
                          </Button>
                        </td>
                        <td>{typeof row.value === 'number' ? row.value.toPrecision(4) : '—'}</td>
                        <td title={source?.sourceRevision?.sha256}>
                          {source?.error ??
                            (source?.sourceRevision
                              ? 'Snapshot recorded'
                              : 'Source identity unavailable')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
