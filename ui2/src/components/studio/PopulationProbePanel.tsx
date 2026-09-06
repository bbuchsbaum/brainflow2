import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import {
  buildPopulationProbeQuery,
  PopulationProbeController,
  summarizePopulationProbe,
} from '@/services/studio/PopulationProbeController';
import type { PopulationProbe } from '@/types/population';
import type { ResolvedPlotSpec } from '@/plotting';

const pointSpec: ResolvedPlotSpec = {
  mark: 'point',
  encoding: { x: 'member', y: 'value' },
  transforms: [],
  params: {},
};
const control =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-40';
const coordinates = (probe: PopulationProbe) =>
  probe.worldMm.map((value) => value.toFixed(1)).join(', ');

export function PopulationProbePanel({
  controller: suppliedController,
}: { controller?: PopulationProbeController } = {}) {
  const studio = useSetStudioStore();
  const workspaceId = useViewStateStore((state) => state.activeWorkspaceKey);
  const [controller] = useState(() => suppliedController ?? new PopulationProbeController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [previewHover, setPreviewHover] = useState(false);
  const [radius, setRadius] = useState(0);
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
  const current = result?.query.key === definition.query?.key;
  const { mean, count, unavailable } = summarizePopulationProbe(result?.frame, selected);
  const issue = definition.issue ?? snapshot.error;

  return (
    <section
      aria-label="Population values"
      className="shrink-0 rounded-lg border border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          Population values{' '}
          <span className="ml-2 text-xs text-muted-foreground">
            {selected.size} selected / {population.context.memberIds.length} observations
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result && (
            <button
              className={control}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Hide values' : 'Show values'}
            </button>
          )}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={previewHover}
              onChange={(event) => setPreviewHover(event.target.checked)}
            />{' '}
            Preview hover
          </label>
          <label className="flex items-center gap-1 text-xs">
            Radius{' '}
            <input
              aria-label="Probe radius in millimetres"
              type="number"
              min={0}
              step={1}
              value={radius}
              onChange={(event) => updateRadius(event.target.valueAsNumber)}
              className="w-14 rounded border border-border bg-background px-1 py-0.5"
            />{' '}
            mm
          </label>
          <button
            className={control}
            onClick={() => populationProbeActions.pin(radius, previewHover)}
            disabled={!studio.selection.activeSetId}
          >
            {previewHover && studio.population.hoverProbe ? 'Pin preview' : 'Pin crosshair'}
          </button>
          {studio.population.pinnedProbe && (
            <button className={control} onClick={populationProbeActions.unpin}>
              Unpin
            </button>
          )}
          <button
            className={control}
            onClick={() => controller.request(definition.query, true)}
            disabled={!definition.query || snapshot.pending}
          >
            Refresh
          </button>
        </div>
      </div>
      {issue && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {issue}
        </p>
      )}
      <div className="mt-1 text-xs text-muted-foreground" role="status">
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
      <div ref={plotRef} className="min-w-0">
        {result && expanded && (
          <PlotEncoder
            frame={result.frame}
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
        )}
      </div>
      {result && expanded && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p>
              Selected mean: {mean === null ? 'unavailable' : mean.toPrecision(4)} · {count} finite
              values{unavailable > 0 && ` · ${unavailable} unavailable observations`}
            </p>
            <div className="flex gap-1">
              <button className={control} onClick={populationProbeActions.selectAll}>
                All
              </button>
              <button className={control} onClick={populationProbeActions.selectNone}>
                None
              </button>
              <button
                className={control}
                onClick={populationProbeActions.selectFocused}
                disabled={
                  !population.context.memberIds.includes(studio.selection.activeMemberId ?? '')
                }
              >
                Focused only
              </button>
              <button
                className={control}
                onClick={populationProbeActions.undoSelection}
                disabled={!studio.population.selectionPast.length}
              >
                Undo selection
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Click a point to focus its image. Shift-click to change selection. Selection changes
            reuse these sampled values.
          </p>
          <details className="mt-1 text-xs">
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
                          <button
                            className="underline"
                            onClick={() => populationProbeActions.focus(id)}
                          >
                            {id}
                          </button>
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
