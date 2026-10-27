import { Button, Notice, NumberField, Select, SELECTED_EDGE_COLOR } from '@/components/ui/bf';
import { PopulationExplanation } from './PopulationExplanation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  populationRelationshipService,
  relationshipFittedIds,
  relationshipSource,
  relationshipUnassigned,
  relationshipUnassignedSummary,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import { PopulationBrush } from './PopulationBrush';
export function PopulationRelationshipPanel() {
  const state = useSetStudioStore();
  useViewStateStore((s) => s.activeWorkspaceKey);
  const service = populationRelationshipService;
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  const { scope, source, issue } = relationshipSource();
  const [distance, setDistance] = useState<RelationshipRequest['distance']>('effect');
  const [count, setCount] = useState(2);
  useEffect(() => {
    service.resetScope(scope);
    return () => service.cancel();
  }, [service, scope]);
  const fit = snapshot.scope === scope ? snapshot.fit : null;
  const current = !!fit && !snapshot.stale && !snapshot.pending;
  const selected = new Set(resolvePopulation(state).workingMemberIds);
  const coordinates = fit?.geometry.coordinates ?? [];
  // Geometry is indexed by fitted members; unassigned members have no position.
  const fitted = fit ? relationshipFittedIds(fit) : [];
  const unassignedCount = fit ? relationshipUnassigned(fit).length : 0;
  const limit = Math.max(0, ...coordinates.flat().map(Math.abs)) || 1;
  return (
    <details
      className="rounded-sm border border-border p-3 text-bf-sm"
      aria-label="Spatial relationships"
    >
      <summary className="cursor-pointer font-medium">
        Spatial relationships{' '}
        {fit
          ? `· ${fitted.length} observations${unassignedCount ? ` · ${unassignedCount} unassigned` : ''}`
          : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          Fit the context on common finite voxels. Selection and crosshair movement keep the
          geometry fixed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Distance{' '}
            <Select className="w-auto max-w-full"
              aria-label="Spatial distance"
              value={distance}
              onChange={(e) => setDistance(e.target.value as typeof distance)}
            >
              <option value="effect">Effect · RMS difference</option>
              <option value="pattern-shape">Pattern shape · centered, unit norm</option>
            </Select>
          </label>
          <Button variant="secondary" size="sm"
            disabled={!source || snapshot.pending}
            onClick={() => void service.fit(distance)}
          >
            Fit on current support
          </Button>
          <Button variant="secondary" size="sm"
            disabled={
              !source ||
              snapshot.pending ||
              !state.population.pinnedProbe ||
              state.population.pinnedProbe.radiusMm <= 0
            }
            onClick={() => void service.fit(distance, true)}
          >
            Compare maps in pinned region
          </Button>
          {snapshot.pending && (
            <Button variant="secondary" size="sm" onClick={service.cancel}>
              Cancel fit
            </Button>
          )}
        </div>
        {snapshot.pending && (
          <p role="status">Computing spatial relationships… Previous fit retained.</p>
        )}
        {(issue || snapshot.error) && (
          <Notice role="alert" severity="danger">
            {issue || snapshot.error}
            {fit && snapshot.error && ' Previous fit retained below.'}
          </Notice>
        )}
        {fit && (
          <>
            <p>
              {fit.request.distance === 'effect'
                ? 'Effect distance: root mean squared difference in original map units.'
                : 'Pattern-shape distance: each map spatially centered and normalized to unit Euclidean norm; magnitude removed.'}{' '}
              {fit.request.region
                ? `Sphere: ${fit.request.region.radiusMm} mm at (${fit.request.region.worldMm.join(', ')}).`
                : 'Whole current support.'}{' '}
              {fit.request.mask
                ? 'Common mask applied.'
                : 'No mask: finite background values are included.'}
            </p>
            <p className="text-muted-foreground">
              Fit {fit.fitId.slice(0, 8)} · {fit.commonVoxels.toLocaleString()} /{' '}
              {fit.candidateVoxels.toLocaleString()} common finite voxels ·{' '}
              {(100 * (1 - fit.commonVoxels / fit.candidateVoxels)).toFixed(1)}% coverage loss · 2D
              retained variation {(100 * fit.geometry.explainedFraction).toFixed(1)}% · normalized
              stress {fit.geometry.stress.toFixed(3)}
            </p>
            {unassignedCount > 0 && (
              <p className="text-muted-foreground" aria-label="Unassigned observations">
                {relationshipUnassignedSummary(fit)}
              </p>
            )}
            <PopulationExplanation key={fit.fitId} fit={fit} current={current} />
            {snapshot.stale && (
              <Notice role="alert" severity="danger">
                Inputs changed since this fit. Refit to order or group current observations.
              </Notice>
            )}
            {!fit.geometry.orderable && (
              <p className="text-muted-foreground">
                No distinct first axis: leading axes are tied or there is no variation. Axis-1
                ordering is unavailable.
              </p>
            )}
            <p className="text-muted-foreground">
              Focus: {state.selection.activeMemberId ?? 'none'} · coincident points overlap; use the
              movie or observation list to inspect each original.
            </p>
            <PopulationBrush
              scope={fit.fitId}
              lasso
              origin="map-derived"
              selectionLabel={`Spatial relationship lasso · ${fit.fitId}`}
            >
              <svg
                viewBox="0 0 560 300"
                className="block w-full max-h-[360px]"
                role="group"
                aria-label="Spatial MDS observations"
              >
                <line x1="280" x2="280" y1="20" y2="270" stroke="currentColor" opacity="0.15" />
                <line x1="25" x2="535" y1="145" y2="145" stroke="currentColor" opacity="0.15" />
                <text
                  x="12"
                  y="145"
                  transform="rotate(-90 12 145)"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="11"
                >
                  MDS axis 2
                </text>
                <text x="280" y="294" textAnchor="middle" fill="currentColor" fontSize="11">
                  MDS axis 1
                </text>
                {fitted.map((memberId, i) => (
                  <circle
                    key={memberId}
                    data-datum-id={memberId}
                    data-fit-x={coordinates[i][0]}
                    data-fit-y={coordinates[i][1]}
                    cx={280 + (coordinates[i][0] / limit) * 115}
                    cy={145 - (coordinates[i][1] / limit) * 115}
                    r={memberId === state.selection.activeMemberId ? 7 : 4}
                    fill={
                      selected.has(memberId)
                        ? 'var(--bf-text-primary)'
                        : 'var(--bf-text-muted)'
                    }
                    // Selected marks are light neutral (chrome is achromatic;
                    // amber is never a data colour). The active member gets
                    // the accent as a thin state edge, not a fill.
                    stroke={memberId === state.selection.activeMemberId ? SELECTED_EDGE_COLOR : 'none'}
                    strokeWidth="2"
                    role="button"
                    tabIndex={0}
                    aria-label={`Focus relationship ${memberId}`}
                    aria-pressed={selected.has(memberId)}
                    onClick={(e) =>
                      e.shiftKey
                        ? service.toggle(memberId)
                        : populationProbeActions.focus(memberId)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (e.shiftKey) service.toggle(memberId);
                        else populationProbeActions.focus(memberId);
                      }
                    }}
                  >
                    <title>{memberId} · original observation · Shift-click to select</title>
                  </circle>
                ))}
              </svg>
            </PopulationBrush>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm"
                disabled={!current || !fit.geometry.orderable}
                onClick={() => service.order()}
              >
                Order movie by MDS axis 1
              </Button>
              <label>
                Groups{' '}
                <NumberField
                  fieldClassName="w-16"
                  aria-label="Similarity group count"
                  min={2}
                  max={fitted.length}
                  value={Number.isFinite(count) ? count : ''}
                  onChange={(e) => setCount(e.target.valueAsNumber)}
                />
              </label>
              <Button variant="secondary" size="sm"
                disabled={
                  !current ||
                  !Number.isInteger(count) ||
                  count < 2 ||
                  count > fitted.length
                }
                onClick={() => service.group(count)}
              >
                Create similarity groups
              </Button>
            </div>
            <p className="text-muted-foreground">
              Average linkage uses the original distances, not the 2D picture. Groups and selections
              are exploratory. Exact fit: up to 128 observations within a bounded spatial support.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
