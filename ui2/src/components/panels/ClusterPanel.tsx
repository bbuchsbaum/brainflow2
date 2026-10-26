/**
 * Clusters (UI redesign phase 3, item 5): a bottom-dock tab beside Plot.
 *
 * - Toolbar: one row that reads as a sentence: layer · |z| > [3.1] · sign ·
 *   connectivity · min voxels · Compute. The threshold follows the layer's
 *   display threshold until the user edits it.
 * - Table: one row per cluster (rank by |peak|), mono right-aligned numbers,
 *   U+2212 minus. Click / Enter / arrow keys move the crosshair to the peak.
 * - Footer: the methods sentence, Copy CSV, Go to max / min.
 *
 * The target layer is the active layer (the same rule as the viewport header,
 * colorbar and status bar), when it is a scalar volume.
 */
import React, { useCallback, useMemo, useState } from 'react';
import type { ClusterSign, ClusterSummary } from '@brainflow/api';
import {
  Button,
  Notice,
  NumberField,
  SegmentedControl,
  useRovingFocus,
  SELECTED,
  HOVER_FILL,
  FOCUS_RING_INSET,
} from '@/components/ui/bf';
import { StatSymbol } from '@/components/ui/StatSymbol';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useClusterStore, type ClusterConnectivity } from '@/stores/clusterStore';
import { useActiveLayer } from '@/utils/activeLayer';
import { statisticUnits } from '@/utils/statistic';
import { formatLayerValue, formatWorldMm } from '@/utils/valueFormat';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';
import {
  clusterMethodsSentence,
  clusterTableCsv,
  colormapEnds,
  displayThresholdMagnitude,
  getClusterService,
} from '@/services/ClusterService';
import { getEventBus } from '@/events/EventBus';
import { cn } from '@/utils/cn';
import { formatVoxelIndex } from '@/utils/voxelSnap';

const SIGN_OPTIONS = [
  { value: 'both', label: 'Both', title: 'Both signs (|value| > threshold)' },
  { value: 'positive', label: '+', title: 'Positive only', 'aria-label': 'Positive' },
  { value: 'negative', label: '−', title: 'Negative only', 'aria-label': 'Negative' },
] as const;

const CONNECTIVITY_OPTIONS = [
  { value: '6', label: '6', title: '6-connected: faces' },
  { value: '18', label: '18', title: '18-connected: faces and edges (SPM default)' },
  { value: '26', label: '26', title: '26-connected: faces, edges and corners (FSL default)' },
] as const;

type SortKey = 'rank' | 'voxels' | 'peak';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

/** Default directions: rank ascending (largest |peak| first), sizes and peaks descending. */
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { rank: 'asc', voxels: 'desc', peak: 'desc' };

function sortClusters(clusters: readonly ClusterSummary[], sort: SortState): ClusterSummary[] {
  const value = (c: ClusterSummary) =>
    sort.key === 'rank' ? c.id : sort.key === 'voxels' ? c.voxelCount : Math.abs(c.peakValue);
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...clusters].sort((a, b) => sign * (value(a) - value(b)) || a.id - b.id);
}

/**
 * A sortable column header: a button (keyboard-operable) inside the <th>,
 * with aria-sort on the header cell. Activating the sorted column flips it.
 */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
  title,
}: {
  label: React.ReactNode;
  sortKey: SortKey;
  sort: SortState;
  onSort: (next: SortState) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={cn('px-1 text-right font-normal', className)}>
      <button
        type="button"
        title={title}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-sm px-1 hover:text-foreground',
          active && 'text-foreground',
          FOCUS_RING_INSET,
        )}
        onClick={() =>
          onSort(
            active
              ? { key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
              : { key: sortKey, dir: FIRST_DIR[sortKey] },
          )
        }
      >
        {label}
        <span aria-hidden className={active ? '' : 'invisible'}>
          {sort.dir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  );
}

const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

const MM = 'inline-block w-[6.5ch] text-right';

function MmTriple({ value }: { value: readonly number[] }) {
  return (
    <span className="whitespace-nowrap">
      {value.map((v, i) => (
        <span key={i} className={MM}>
          {formatWorldMm(v)}
        </span>
      ))}
    </span>
  );
}

export function ClusterPanel() {
  const viewLayers = useViewStateStore((s) => s.viewState.layers);
  const active = useActiveLayer(viewLayers);
  const target = active && (active.layerMode ?? 'scalar') === 'scalar' ? active : null;
  const layer = useLayerStore((s) =>
    target ? s.layers.find((l) => l.id === target.id) : undefined,
  );
  const dataRange = useLayerStore((s) =>
    target ? s.layerMetadata.get(target.id)?.dataRange : undefined,
  );
  const symbol = statisticUnits(layer?.statistic, dataRange);
  const variable = symbol ? symbol.replace(/\(.*\)$/, '') : 'value';

  const params = useClusterStore((s) => s.params);
  const status = useClusterStore((s) => s.status);
  const result = useClusterStore((s) => s.result);
  const error = useClusterStore((s) => s.error);
  const selectedId = useClusterStore((s) => s.selectedId);
  const setParams = useClusterStore((s) => s.setParams);

  const layerThreshold = displayThresholdMagnitude(target?.threshold);
  const threshold = params.linked ? (layerThreshold ?? 0) : params.threshold;
  const thresholdInvalid = threshold === null || !Number.isFinite(threshold) || threshold < 0;
  const minInvalid =
    params.minVoxels === null || !Number.isInteger(params.minVoxels) || params.minVoxels < 1;
  const computing = status === 'computing';
  const canCompute = !!target && !thresholdInvalid && !minInvalid && !computing;

  const compute = useCallback(() => {
    if (!target || threshold === null || params.minVoxels === null) return;
    void getClusterService().compute({
      layerId: target.id,
      threshold,
      sign: params.sign,
      connectivity: params.connectivity,
      minVoxels: params.minVoxels,
    });
  }, [target, threshold, params.sign, params.connectivity, params.minVoxels]);

  // Stale: the table no longer describes the target layer or the parameters.
  const stale = useMemo(() => {
    if (!result || !target) return null;
    if (result.layerId !== target.id) return `Table is for ${shortLayerLabel(result.layerName)}.`;
    const t = result.table;
    const changed =
      threshold === null ||
      !sameValue(t.threshold, threshold) ||
      t.sign !== params.sign ||
      t.connectivity !== params.connectivity ||
      t.minVoxels !== params.minVoxels;
    return changed ? 'Parameters changed since this table.' : null;
  }, [result, target, threshold, params.sign, params.connectivity, params.minVoxels]);

  // Sortable by rank (#, = |peak| descending, the backend order), voxels or
  // |peak|. Regions travel with their cluster (indexed by rank).
  const [sort, setSort] = useState<SortState>({ key: 'rank', dir: 'asc' });
  const regionById = useMemo(() => {
    const map = new Map<number, string | null>();
    result?.table.clusters.forEach((c, i) => map.set(c.id, result.regions[i] ?? null));
    return map;
  }, [result]);
  const clusters = useMemo(() => sortClusters(result?.table.clusters ?? [], sort), [result, sort]);
  const ids = useMemo(() => clusters.map((c) => String(c.id)), [clusters]);
  const select = useCallback((id: string) => {
    void getClusterService().selectCluster(Number(id));
  }, []);
  const roving = useRovingFocus({
    ids,
    activeId: selectedId === null ? null : String(selectedId),
    selectOnMove: true,
    onSelect: select,
  });

  const [negColor, posColor] = colormapEnds(target?.colormap);

  const copyCsv = useCallback(async () => {
    if (!result) return;
    const csv = clusterTableCsv(result.table, result.regions, {
      layerName: result.layerName,
      symbol: statisticUnits(
        useLayerStore.getState().layers.find((l) => l.id === result.layerId)?.statistic,
        useLayerStore.getState().layerMetadata.get(result.layerId)?.dataRange,
      ),
    });
    try {
      await navigator.clipboard.writeText(csv);
      getEventBus().emit('ui.notification', {
        type: 'info',
        message: 'Cluster table copied as CSV',
      });
    } catch {
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: 'Could not copy to the clipboard',
      });
    }
  }, [result]);

  const goTo = useCallback(
    async (kind: 'max' | 'min') => {
      if (!target) return;
      try {
        await getClusterService().goToExtremum(target.id, kind);
      } catch (err) {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Could not find the ${kind}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [target],
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-bf-xs" data-testid="cluster-panel">
      {/* Toolbar: one row that reads as a sentence. */}
      <div
        role="group"
        aria-label="Cluster parameters"
        className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 border-b border-bf-border-subtle px-2 py-0.5"
      >
        <span
          className="max-w-[24ch] truncate font-medium text-foreground"
          title={layer?.name ?? undefined}
          data-testid="cluster-layer"
        >
          {target ? shortLayerLabel(layer?.name ?? target.name) : 'No layer'}
        </span>
        <label
          className="inline-flex items-center gap-1 text-bf-text-secondary"
          htmlFor="cluster-threshold"
        >
          |{symbol ? <StatSymbol label={variable} /> : variable}| &gt;
        </label>
        <NumberField
          id="cluster-threshold"
          fieldClassName="w-[9ch]"
          step={0.1}
          min={0}
          value={threshold ?? ''}
          invalid={thresholdInvalid}
          aria-label={`Cluster threshold, absolute ${variable}`}
          onValueChange={(v) => setParams({ threshold: v, linked: false })}
        />
        {!params.linked && layerThreshold !== null && (
          <Button
            variant="link"
            size="sm"
            onClick={() => setParams({ linked: true, threshold: null })}
            title="Follow the layer's display threshold again"
          >
            Use layer threshold
          </Button>
        )}
        <SegmentedControl
          aria-label="Sign"
          options={SIGN_OPTIONS}
          value={params.sign}
          onValueChange={(v) => setParams({ sign: v as ClusterSign })}
        />
        <span className="text-bf-text-muted" aria-hidden>
          ·
        </span>
        <span className="text-bf-text-secondary" id="cluster-connectivity-label">
          Connectivity
        </span>
        <SegmentedControl
          aria-labelledby="cluster-connectivity-label"
          options={CONNECTIVITY_OPTIONS}
          value={String(params.connectivity)}
          onValueChange={(v) => setParams({ connectivity: Number(v) as ClusterConnectivity })}
        />
        <label className="text-bf-text-secondary" htmlFor="cluster-min-voxels">
          Min
        </label>
        <NumberField
          id="cluster-min-voxels"
          fieldClassName="w-[10ch]"
          step={1}
          min={1}
          unit="vox"
          value={params.minVoxels ?? ''}
          invalid={minInvalid}
          onValueChange={(v) => setParams({ minVoxels: v })}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={compute}
          disabled={!canCompute}
          className="ml-auto"
        >
          {computing ? 'Computing…' : 'Compute'}
        </Button>
      </div>
      {computing && (
        <div
          role="progressbar"
          aria-label="Computing clusters"
          className="h-0.5 w-full animate-pulse bg-bf-text-muted"
        />
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && status === 'error' ? (
          <div className="p-2">
            <Notice severity="danger" role="alert">
              {error}
            </Notice>
          </div>
        ) : !target ? (
          <p className="p-3 text-bf-text-muted">Select a volume layer to compute clusters.</p>
        ) : !result ? (
          <p className="p-3 text-bf-text-muted" data-testid="cluster-empty">
            Compute clusters for {shortLayerLabel(layer?.name ?? target.name)}.
          </p>
        ) : clusters.length === 0 ? (
          <p className="p-3 text-bf-text-muted" data-testid="cluster-none">
            No clusters above |{variable}| &gt; {formatLayerValue(result.table.threshold)} with ≥{' '}
            {result.table.minVoxels} voxel{result.table.minVoxels === 1 ? '' : 's'}.
          </p>
        ) : (
          <table
            role="grid"
            aria-label="Clusters"
            className="w-auto border-collapse font-mono tabular-nums"
          >
            <thead className="sticky top-0 bg-bf-bg-panel text-bf-text-muted">
              <tr className="h-6 text-left font-sans">
                <SortHeader label="#" sortKey="rank" sort={sort} onSort={setSort} className="w-8" title="Rank by |peak| (backend order)" />
                <th scope="col" className="w-6 font-normal">
                  <span className="sr-only">Sign</span>
                </th>
                <SortHeader label="Voxels" sortKey="voxels" sort={sort} onSort={setSort} />
                <th scope="col" className="px-2 text-right font-normal">
                  mm³
                </th>
                <SortHeader
                  label={<>Peak {symbol ? <StatSymbol label={symbol} /> : ''}</>}
                  sortKey="peak"
                  sort={sort}
                  onSort={setSort}
                  title="Sort by |peak|"
                />
                <th scope="col" className="px-2 text-right font-normal">
                  Peak x y z (mm)
                </th>
                <th scope="col" className="px-2 text-right font-normal" title="Peak voxel index on the layer's grid">
                  Peak ijk
                </th>
                <th scope="col" className="px-2 text-right font-normal">
                  CoM x y z (mm)
                </th>
                <th scope="col" className="px-2 font-normal">
                  Region
                </th>
              </tr>
            </thead>
            <tbody onKeyDown={roving.onKeyDown}>
              {clusters.map((c: ClusterSummary) => {
                const selected = c.id === selectedId;
                const region = regionById.get(c.id) ?? null;
                return (
                  <tr
                    key={c.id}
                    {...roving.getItemProps(String(c.id))}
                    aria-selected={selected}
                    data-testid={`cluster-row-${c.id}`}
                    className={cn(
                      'h-6 cursor-pointer outline-none',
                      selected ? SELECTED : `text-bf-text-secondary ${HOVER_FILL}`,
                      FOCUS_RING_INSET,
                    )}
                    onClick={() => select(String(c.id))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(String(c.id));
                      }
                    }}
                    title={`Cluster ${c.id}: go to peak`}
                  >
                    <td className="px-2 text-right text-bf-text-muted">{c.id}</td>
                    <td>
                      <span
                        aria-label={c.sign === 'positive' ? 'positive' : 'negative'}
                        role="img"
                        className="inline-block h-1.5 w-1.5 rounded-bf-xs [forced-color-adjust:none]"
                        // Data colour: the colormap's end for this sign.
                        style={{ background: c.sign === 'positive' ? posColor : negColor }}
                      />
                    </td>
                    <td className="px-2 text-right">{c.voxelCount}</td>
                    <td className="px-2 text-right">{Math.round(c.volumeMm3)}</td>
                    <td className="px-2 text-right">{formatLayerValue(c.peakValue)}</td>
                    <td className="px-2 text-right">
                      <MmTriple value={c.peakMm} />
                    </td>
                    <td className="whitespace-nowrap px-2 text-right text-bf-text-muted">
                      {formatVoxelIndex(c.peakIjk)}
                    </td>
                    <td className="px-2 text-right">
                      <MmTriple value={c.centroidMm} />
                    </td>
                    <td
                      className="max-w-[24ch] truncate px-2 font-sans"
                      title={region ?? 'No atlas region'}
                    >
                      {region ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer: methods sentence and actions. */}
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 border-t border-bf-border-subtle px-2 py-0.5 text-bf-text-muted">
        {stale ? (
          <span className="text-bf-warning" data-testid="cluster-stale">
            {stale} Compute to update.
          </span>
        ) : result ? (
          <span
            className="min-w-0 truncate"
            data-testid="cluster-methods"
            title="Rows sorted by |peak|"
          >
            {clusterMethodsSentence(result.table, statisticUnits(layer?.statistic, dataRange))}
            {result.table.truncated ? ` (first ${result.table.clusters.length} shown)` : ''}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={!result || clusters.length === 0}
            onClick={copyCsv}
          >
            Copy CSV
          </Button>
          <Button variant="secondary" size="sm" disabled={!target} onClick={() => void goTo('max')}>
            Go to max
          </Button>
          <Button variant="secondary" size="sm" disabled={!target} onClick={() => void goTo('min')}>
            Go to min
          </Button>
        </span>
      </div>
    </div>
  );
}

export default ClusterPanel;
