/**
 * Clusters (UI redesign phase 3, item 5): a bottom-dock tab beside Plot.
 *
 * - Toolbar: one row that reads as a sentence: layer · |z| > [3.1] · sign ·
 *   connectivity · min voxels · Compute. The threshold follows the layer's
 *   display threshold until the user edits it.
 * - Table: one row per cluster (rank by |peak|), mono right-aligned numbers,
 *   U+2212 minus. Click / Enter / arrow keys move the crosshair to the peak.
 * - Footer: the methods sentence, Copy CSV, Go to max / min.
 * - Phase 4 (C1/C2): each cluster's sub-peaks behind a disclosure (region
 *   per sub-peak too), and opt-in cluster-level p (RFT) from a user-supplied
 *   FWHM: p(FWE) / p(unc) columns, the assumption under the methods line.
 *
 * The target layer is the active layer (the same rule as the viewport header,
 * colorbar and status bar), when it is a scalar volume.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ClusterSign, ClusterSummary } from '@brainflow/api';
import {
  SELECTED_EDGE,
  SELECTED_FILL,
  Button,
  Checkbox,
  EmptyPane,
  TextField,
  focusFallback,
  Notice,
  NumberField,
  SegmentedControl,
  useRovingFocus,
  HOVER_FILL,
  FOCUS_RING_INSET,
} from '@/components/ui/bf';
import { FORCED_LEFT_EDGE } from '@/components/ui/bf/states';
import { StatSymbol } from '@/components/ui/StatSymbol';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useClusterStore, type ClusterConnectivity } from '@/stores/clusterStore';
import { useActiveLayer } from '@/utils/activeLayer';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { buildSceneStack } from '@/hooks/useSceneStack';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import { formatLayerValue, formatWorldMm } from '@/utils/valueFormat';
import { trueMinus } from '@/components/views/viewportFrame/frameFormat';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';
import {
  clusterMethodsSentence,
  clusterTableCsv,
  colormapEnds,
  displayThresholdMagnitude,
  formatClusterP,
  fwhmDescription,
  getClusterService,
  parseFwhm,
} from '@/services/ClusterService';
import { getEventBus } from '@/events/EventBus';
import { clusterSeriesUnavailable, openClusterSeries } from '@/services/series/openClusterSeries';
import { useSetStudioStore } from '@/stores/setStudioStore';
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
      {/* The sort arrow sits BEFORE the label, so the label's right edge
          lines up with the right-aligned numbers below it. */}
      <button
        type="button"
        title={title}
        className={cn(
          'inline-flex flex-row-reverse items-center gap-0.5 rounded-sm px-1 hover:text-foreground',
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

/** The table's FWHM (per axis) against the field's (one value or three). */
function sameFwhm(table: readonly number[], field: number | readonly number[] | null): boolean {
  if (field === null) return false;
  const axes = typeof field === 'number' ? [field, field, field] : field;
  return table.every((v, i) => sameValue(v, axes[i]));
}

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

/** The methods sentence with the statistic variable italic (|z| as in the toolbar). */
function MethodsSentence({ text, variable }: { text: string; variable: string }) {
  if (!variable || variable === 'value') return <>{text}</>;
  const i = text.search(new RegExp(`(?<![\\w])${variable}(?![\\w(])`));
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <i className="italic">{variable}</i>
      {text.slice(i + variable.length)}
    </>
  );
}

/** Make a layer the active one (the Scene selection), as a click on its row does. */
function selectStatLayer(layerId: string): void {
  const stack = buildSceneStack(useLayerStore.getState().layers, new Map(), null);
  const item = stack.volumes.find((v) => v.ref.type === 'volume' && v.ref.layerId === layerId);
  if (item) useInspectorSelectionStore.getState().setActive(item);
}

/** |z| / |t| threshold seeded for a map with no display threshold. */
const DEFAULT_STAT_THRESHOLD = 3.1;

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
  // A loaded statistical map to offer when the active layer is not one.
  const layerMetadata = useLayerStore((s) => s.layerMetadata);
  const allLayers = useLayerStore((s) => s.layers);
  const statLayer = useMemo(
    () =>
      symbol
        ? null
        : (allLayers.find(
            (l) => l.volumeId && statisticUnits(l.statistic, layerMetadata.get(l.id)?.dataRange),
          ) ?? null),
    [symbol, allLayers, layerMetadata],
  );
  const variable = symbol ? symbol.replace(/\(.*\)$/, '') : 'value';

  const params = useClusterStore((s) => s.params);
  const status = useClusterStore((s) => s.status);
  const result = useClusterStore((s) => s.result);
  const error = useClusterStore((s) => s.error);
  const selectedId = useClusterStore((s) => s.selectedId);
  const setParams = useClusterStore((s) => s.setParams);

  // f32 thresholds (3.0999999046) shown and used at display precision (3.1).
  const rawLayerThreshold = displayThresholdMagnitude(target?.threshold);
  const layerThreshold =
    rawLayerThreshold === null ? null : Number.parseFloat(rawLayerThreshold.toPrecision(6));
  const thresholdRef = useRef<HTMLInputElement>(null);
  // Linked to a layer without a display threshold: never 0 (it clusters the
  // whole brain into one; review R7). A z or t map seeds the conventional
  // |z| > 3.1 and says so; other statistics wait for a value.
  const seededDefault =
    params.linked && layerThreshold === null && symbol && /^[zt]/.test(symbol) ? DEFAULT_STAT_THRESHOLD : null;
  const threshold = params.linked ? (layerThreshold ?? seededDefault) : params.threshold;
  const thresholdInvalid = threshold === null || !Number.isFinite(threshold) || threshold < 0;
  const minInvalid =
    params.minVoxels === null || !Number.isInteger(params.minVoxels) || params.minVoxels < 1;
  const fwhm = params.extentP ? parseFwhm(params.fwhmText) : null;
  const fwhmInvalid = params.extentP && fwhm === null;
  const computing = status === 'computing';
  // Clusters need a statistical layer: a T1 at |value| > 0 is one 100k-voxel
  // "cluster" (v4 user critic). Disabled controls say why.
  const notStatReason = !active
    ? 'Select a layer to find clusters'
    : !target || !symbol
      ? 'Clusters need a statistical layer (a z, t or F map)'
      : null;
  const thresholdReason = notStatReason
    ? null
    : threshold === null
      ? 'Enter a threshold (the layer has no display threshold)'
      : fwhmInvalid
        ? 'Enter the FWHM in mm (one value, or three for i j k) for cluster p'
        : null;
  const canCompute = !notStatReason && !thresholdInvalid && !minInvalid && !fwhmInvalid && !computing;
  // Shown under the toolbar row when the EmptyPane does not already say it.
  const computeReason = notStatReason && target ? notStatReason : thresholdReason;
  const activeName = useLayerStore((s) => (active ? s.layers.find((l) => l.id === active.id)?.name : undefined));

  const compute = useCallback(() => {
    if (!target || threshold === null || params.minVoxels === null) return;
    if (params.extentP && fwhm === null) return;
    // A statistic known only from the file name is declared to the backend
    // (it reads the header); a z needs nothing more, a t its df (not known).
    const statistic = layer?.statistic;
    const declared =
      statistic && isInferredStatistic(statistic) && statistic.kind === 'z' ? ('z' as const) : null;
    void getClusterService().compute({
      layerId: target.id,
      threshold,
      sign: params.sign,
      connectivity: params.connectivity,
      minVoxels: params.minVoxels,
      extent: params.extentP && fwhm !== null ? { fwhmMm: fwhm, statistic: declared } : null,
    });
  }, [target, threshold, params.sign, params.connectivity, params.minVoxels, params.extentP, fwhm, layer?.statistic]);

  // The table's own statistic (its layer may no longer be the active one):
  // headers, the empty line and the methods sentence use it, never the
  // active layer's units (v4 function critic: a z table headed "Peak t").
  const resultSymbol = useLayerStore((s) =>
    result
      ? statisticUnits(
          s.layers.find((l) => l.id === result.layerId)?.statistic,
          s.layerMetadata.get(result.layerId)?.dataRange,
        )
      : null,
  );
  const resultVariable = resultSymbol ? resultSymbol.replace(/\(.*\)$/, '') : 'value';

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
      t.minVoxels !== params.minVoxels ||
      !!t.extentInference !== params.extentP ||
      (t.extentInference !== null && t.extentInference !== undefined && !sameFwhm(t.extentInference.fwhmMm, fwhm));
    return changed ? 'Parameters changed since this table.' : null;
  }, [result, target, threshold, params.sign, params.connectivity, params.minVoxels, params.extentP, fwhm]);

  // Sortable by rank (#, = |peak| descending, the backend order), voxels or
  // |peak|. Regions travel with their cluster (indexed by rank).
  const [sort, setSort] = useState<SortState>({ key: 'rank', dir: 'asc' });
  const regionById = useMemo(() => {
    const map = new Map<number, string | null>();
    result?.table.clusters.forEach((c, i) => map.set(c.id, result.regions[i] ?? null));
    return map;
  }, [result]);
  const clusters = useMemo(() => sortClusters(result?.table.clusters ?? [], sort), [result, sort]);
  const subRegionById = useMemo(() => {
    const map = new Map<number, ReadonlyArray<string | null>>();
    result?.table.clusters.forEach((c, i) => map.set(c.id, result.subPeakRegions?.[i] ?? []));
    return map;
  }, [result]);
  const hasExtentP = !!result?.table.extentInference;
  // Clusters whose sub-peaks are shown (reset with each new table).
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [expandedFor, setExpandedFor] = useState(result);
  if (expandedFor !== result) {
    setExpandedFor(result);
    setExpanded(new Set());
  }
  const toggle = useCallback((id: number, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // Treegrid rows (v1 function 2): clusters ("1") and, when open, their
  // sub-peaks ("1.2"). Arrow keys move focus only; Enter / Space selects (and
  // moves the crosshair), so walking the table never jumps the crosshair.
  const subPeakId = (clusterId: number, j: number) => `${clusterId}.${j + 2}`;
  const ids = useMemo(
    () =>
      clusters.flatMap((c) => [
        String(c.id),
        ...(expanded.has(c.id) ? (c.subPeaks ?? []).map((_, j) => subPeakId(c.id, j)) : []),
      ]),
    [clusters, expanded],
  );
  const select = useCallback((id: string) => {
    void getClusterService().selectCluster(Number(id));
  }, []);
  const roving = useRovingFocus({
    ids,
    activeId: selectedId === null ? null : String(selectedId),
    onExpand: (id) => {
      if (id.includes('.')) return;
      const c = clusters.find((x) => String(x.id) === id);
      if (!c || !(c.subPeaks ?? []).length) return;
      if (!expanded.has(c.id)) toggle(c.id, true);
      else roving.focus(subPeakId(c.id, 0));
    },
    onCollapse: (id) => {
      if (id.includes('.')) {
        roving.focus(id.split('.')[0]);
        return;
      }
      const c = clusters.find((x) => String(x.id) === id);
      if (c && expanded.has(c.id)) toggle(c.id, false);
    },
  });

  const [negColor, posColor] = colormapEnds(target?.colormap);
  // "Series for this cluster" (E3): reasons are re-read on each render (the
  // cluster store and the Studio / layer stores it reads change together).
  useSetStudioStore((st) => st.selection.activeSetId);
  const seriesReason = clusterSeriesUnavailable();

  const copyCsv = useCallback(async () => {
    if (!result) return;
    const csv = clusterTableCsv(result.table, result.regions, {
      layerName: result.layerName,
      symbol: statisticUnits(
        useLayerStore.getState().layers.find((l) => l.id === result.layerId)?.statistic,
        useLayerStore.getState().layerMetadata.get(result.layerId)?.dataRange,
      ),
    }, result.subPeakRegions);
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
          {target
            ? shortLayerLabel(layer?.name ?? target.name)
            : active
              ? shortLayerLabel(activeName ?? active.name)
              : 'No layer'}
        </span>
        <label
          className="inline-flex items-center whitespace-pre text-bf-text-secondary"
          htmlFor="cluster-threshold"
        >
          |{symbol ? <StatSymbol label={variable} /> : variable}|{' >'}
        </label>
        <NumberField
          ref={thresholdRef}
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
            onClick={() => {
              setParams({ linked: true, threshold: null });
              // The button goes away: focus returns to the threshold field.
              requestAnimationFrame(() => thresholdRef.current?.focus());
            }}
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
        {/* Opt-in cluster-level p: off by default, and only with a stated
            smoothness (never estimated from the map). */}
        <Checkbox
          checked={params.extentP}
          onCheckedChange={(checked) => setParams({ extentP: checked })}
          title="Cluster-extent p values by Gaussian random field theory, from the smoothness you state"
        >
          Cluster p (RFT)
        </Checkbox>
        {params.extentP ? (
          <>
            <label className="text-bf-text-secondary" htmlFor="cluster-fwhm">
              FWHM
            </label>
            <TextField
              id="cluster-fwhm"
              mono
              className="h-6 w-[11ch]"
              value={params.fwhmText}
              invalid={fwhmInvalid && params.fwhmText.trim() !== ''}
              placeholder="mm"
              aria-describedby="cluster-fwhm-hint"
              onChange={(e) => setParams({ fwhmText: e.target.value })}
            />
            <span id="cluster-fwhm-hint" className="text-bf-2xs text-bf-text-muted">
              mm, assumed stationary
            </span>
          </>
        ) : null}
        {/* Why Compute is off, as text (a disabled button's tooltip is out
            of reach without a mouse); the default threshold is said too. */}
        {computeReason || seededDefault !== null ? (
          <span
            id="cluster-reason"
            className="ml-auto text-bf-2xs text-bf-text-muted"
            data-testid="cluster-reason"
          >
            {computeReason ?? `Default threshold ${DEFAULT_STAT_THRESHOLD} (the layer has no display threshold)`}
          </span>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={compute}
          disabled={!canCompute}
          title={notStatReason ?? thresholdReason ?? undefined}
          aria-describedby={computeReason ? 'cluster-reason' : undefined}
          className={computeReason ? undefined : 'ml-auto'}
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
        ) : !target || !symbol ? (
          // P3.11: say what clusters need, and offer the loaded statistical
          // map when there is one.
          <EmptyPane
            title={
              statLayer
                ? 'Clusters need a statistical layer'
                : 'Load a statistical map to find clusters'
            }
            hint={
              statLayer
                ? `${shortLayerLabel(statLayer.name)} is loaded; select it to find its clusters.`
                : 'A z, t or F map (a NIfTI statistic, or a zstat/tstat file).'
            }
            primary={
              statLayer
                ? {
                    label: `Select ${shortLayerLabel(statLayer.name)}`,
                    onClick: () => {
                      selectStatLayer(statLayer.id);
                      // The message goes away: focus the threshold it seeds.
                      focusFallback(['#cluster-threshold']);
                    },
                  }
                : null
            }
          />
        ) : !result ? (
          <p className="p-3 text-bf-text-muted" data-testid="cluster-empty">
            Compute clusters for {shortLayerLabel(layer?.name ?? target.name)}.
          </p>
        ) : clusters.length === 0 ? (
          <p className="p-3 text-bf-text-muted" data-testid="cluster-none">
            No clusters above |{resultVariable}| &gt; {formatLayerValue(result.table.threshold)} with ≥{' '}
            {result.table.minVoxels} voxel{result.table.minVoxels === 1 ? '' : 's'}.
          </p>
        ) : (
          <table
            role="treegrid"
            aria-label="Clusters"
            className="w-full border-collapse font-mono tabular-nums"
          >
            <thead className="sticky top-0 bg-bf-bg-panel text-bf-text-muted">
              <tr className="h-6 text-left font-sans">
                <th scope="col" className="w-6 font-normal">
                  <span className="sr-only">Sub-peaks</span>
                </th>
                <SortHeader label="#" sortKey="rank" sort={sort} onSort={setSort} className="w-8" title="Rank by |peak| (backend order)" />
                <th scope="col" className="w-6 font-normal">
                  <span className="sr-only">Sign</span>
                </th>
                <SortHeader label="Voxels" sortKey="voxels" sort={sort} onSort={setSort} />
                <th scope="col" className="px-2 text-right font-normal">
                  mm³
                </th>
                {hasExtentP ? (
                  <>
                    <th
                      scope="col"
                      className="px-2 text-right font-normal"
                      title={`Cluster-level p, family-wise corrected${result?.table.extentInference?.tails === 2 ? ' over both tails (both signs)' : ' (one tail)'} (Gaussian random field theory; see the assumption below)`}
                    >
                      p(FWE)
                    </th>
                    <th
                      scope="col"
                      className="px-2 text-right font-normal"
                      title="Cluster-level p, uncorrected: P(a cluster this large or larger)"
                    >
                      p(unc)
                    </th>
                  </>
                ) : null}
                <SortHeader
                  label={<>Peak {resultSymbol ? <StatSymbol label={resultSymbol} /> : ''}</>}
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
                <th
                  scope="col"
                  className="px-2 text-right font-normal"
                  title="Unweighted centroid (mean voxel position); the CSV adds the |value|-weighted COG"
                >
                  Centroid x y z (mm)
                </th>
                <th scope="col" className="w-full px-2 text-left font-normal" title="Atlas / label region at the cluster's peak voxel">
                  Region at peak
                </th>
              </tr>
            </thead>
            <tbody onKeyDown={roving.onKeyDown}>
              {clusters.map((c: ClusterSummary) => {
                const selected = c.id === selectedId;
                const region = regionById.get(c.id) ?? null;
                const subPeaks = c.subPeaks ?? [];
                const open = expanded.has(c.id);
                return (
                  <React.Fragment key={c.id}>
                  <tr
                    {...roving.getItemProps(String(c.id))}
                    aria-selected={selected}
                    data-testid={`cluster-row-${c.id}`}
                    className={cn(
                      'h-6 cursor-pointer outline-none',
                      // The edge is drawn on the first cell: a box-shadow on a
                      // collapsed-border <tr> does not paint (v0 visual 4).
                      selected ? `${SELECTED_FILL} text-foreground` : `text-bf-text-secondary ${HOVER_FILL}`,
                      FOCUS_RING_INSET,
                    )}
                    aria-expanded={subPeaks.length > 0 ? open : undefined}
                    onClick={() => select(String(c.id))}
                    aria-level={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(String(c.id));
                      }
                    }}
                    title={`Cluster ${c.id}: go to peak`}
                  >
                    <td
                      className={cn(
                        'relative pl-1.5 text-center text-bf-text-muted',
                        selected && `${SELECTED_EDGE} ${FORCED_LEFT_EDGE}`,
                      )}
                      data-testid={selected ? 'cluster-selected-edge' : undefined}
                    >
                      {subPeaks.length > 0 ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`${open ? 'Hide' : 'Show'} ${subPeaks.length} sub-peak${subPeaks.length === 1 ? '' : 's'} of cluster ${c.id}`}
                          title={`${subPeaks.length} sub-peak${subPeaks.length === 1 ? '' : 's'}`}
                          className="rounded-sm px-0.5 hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(c.id, !open);
                          }}
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      ) : null}
                    </td>
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
                    {hasExtentP ? (
                      <>
                        <td className="whitespace-nowrap px-2 text-right" data-testid={`cluster-pfwe-${c.id}`}>
                          {formatClusterP(c.pFweExtent)}
                        </td>
                        <td className="whitespace-nowrap px-2 text-right text-bf-text-muted">
                          {formatClusterP(c.pUncorrectedExtent)}
                        </td>
                      </>
                    ) : null}
                    {/* Fixed 2 decimals so the column's decimal points align. */}
                    <td className="px-2 text-right">{trueMinus(c.peakValue.toFixed(2))}</td>
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
                  {open
                    ? subPeaks.map((p, j) => {
                        const subRegion = subRegionById.get(c.id)?.[j] ?? null;
                        return (
                          <tr
                            key={`${c.id}-${j}`}
                            {...roving.getItemProps(subPeakId(c.id, j))}
                            role="row"
                            aria-level={2}
                            aria-posinset={j + 1}
                            aria-setsize={subPeaks.length}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                void getClusterService().goToSubPeak(c.id, j);
                              }
                            }}
                            data-testid={`cluster-subpeak-${c.id}-${j + 2}`}
                            // Subordinate to their cluster: smaller, muted,
                            // the id indented under the parent's.
                            className={cn('h-5 cursor-pointer text-bf-2xs text-bf-text-muted outline-none', HOVER_FILL, FOCUS_RING_INSET)}
                            onClick={() => void getClusterService().goToSubPeak(c.id, j)}
                            title={`Cluster ${c.id}, peak ${j + 2}: go to it`}
                          >
                            <td />
                            <td className="whitespace-nowrap pl-4 pr-2 text-left" aria-label={`cluster ${c.id}, peak ${j + 2}`}>
                              <span aria-hidden>↳ </span>
                              {j + 2}
                            </td>
                            <td />
                            <td />
                            <td />
                            {hasExtentP ? (
                              <>
                                <td />
                                <td />
                              </>
                            ) : null}
                            <td className="px-2 text-right">{trueMinus(p.value.toFixed(2))}</td>
                            <td className="px-2 text-right">
                              <MmTriple value={p.mm} />
                            </td>
                            <td className="whitespace-nowrap px-2 text-right">{formatVoxelIndex(p.ijk)}</td>
                            <td />
                            <td className="max-w-[24ch] truncate px-2 font-sans" title={subRegion ?? 'No atlas region'}>
                              {subRegion ?? '—'}
                            </td>
                          </tr>
                        );
                      })
                    : null}
                  </React.Fragment>
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
          <span className="min-w-0 basis-full py-0.5" data-testid="cluster-methods">
            <MethodsSentence
              text={clusterMethodsSentence(result.table, resultSymbol)}
              variable={resultVariable}
            />
            {result.table.truncated ? ` (first ${result.table.clusters.length} shown)` : ''}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1">
          {notStatReason ? (
            <span id="cluster-footer-reason" className="sr-only">
              {notStatReason}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            // A stale or hidden table is not copied as if current.
            disabled={!result || clusters.length === 0 || !!stale || !!notStatReason}
            title={stale ? `${stale} Compute to copy.` : undefined}
            onClick={copyCsv}
          >
            Copy CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!!notStatReason}
            title={notStatReason ?? undefined}
            aria-describedby={notStatReason ? 'cluster-footer-reason' : undefined}
            onClick={() => void goTo('max')}
          >
            Go to max
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!!notStatReason}
            title={notStatReason ?? undefined}
            aria-describedby={notStatReason ? 'cluster-footer-reason' : undefined}
            onClick={() => void goTo('min')}
          >
            Go to min
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="cluster-series"
            disabled={!!seriesReason || !!stale}
            title={stale ? `${stale} Compute to use it.` : (seriesReason ?? `Series over cluster ${selectedId}`)}
            onClick={() => openClusterSeries()}
          >
            {selectedId !== null ? `Series for cluster ${selectedId}` : 'Series for cluster'}
          </Button>
        </span>
        {!stale && result?.table.extentInference ? (
          // Every p value rests on this: always visible with them.
          <span
            className="basis-full text-bf-2xs text-bf-text-muted"
            data-testid="cluster-assumption"
            title={`FWHM ${fwhmDescription(result.table.extentInference)}; ${result.table.extentInference.expectedClusters.toFixed(2)} clusters expected by chance`}
          >
            {result.table.extentInference.assumption}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default ClusterPanel;
