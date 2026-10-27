/**
 * Series of a Set Studio dataset (phase 4 E5): one line per condition along
 * the dataset's lag / time axis, a population band, at the crosshair locus
 * (a point or a sphere). The sampler reduces space; composePopulationPlot
 * reduces within participant, applies the declared transforms and the
 * population stage. "Participants" shows each participant's line; clicking
 * one focuses its observation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SampleFrame } from '@/plotting';
import { composePopulationPlot } from '@/services/studio/populationPlot';
import { sampleSetSeries } from '@/services/series/sampleSetSeries';
import { regionAtCrosshair, selectedClusterRegion } from '@/services/series/seriesRegion';
import { useClusterStore } from '@/stores/clusterStore';
import {
  SERIES_OBSERVATION,
  SERIES_X,
  type SetSeriesBinding,
} from '@/services/series/seriesBinding';
import { bandDescription, seriesAxisTitle, seriesRecipe } from '@/services/series/seriesRecipe';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { seriesRadiusMm, useSeriesStore, type SeriesLocusKind } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { formatWorldMm } from '@/utils/valueFormat';
import {
  Notice,
  NumberField,
  SegmentedControl,
  Select,
  Toolbar,
  ToolbarField,
} from '@/components/ui/bf';
import { PlotEncoder } from './encoder/PlotEncoder';
import { populationCategoryColor } from './encoder/cartesianMarks';
import { PopulationTransformControls } from './PopulationTransformControls';
import { numericRange, transformSummary } from './populationTransform.helpers';
import type { PlotModeContext } from './plotHost.types';

/** Wait this long after the last crosshair move before sampling (ms). */
const SAMPLE_DEBOUNCE_MS = 120;

const LOCUS_OPTIONS = [
  { value: 'point', label: 'Voxel', title: 'The voxel nearest the crosshair' },
  { value: 'sphere', label: 'Sphere', title: 'A sphere around the crosshair, voxels averaged' },
  { value: 'region', label: 'Region', title: 'The atlas / label region at the crosshair, voxels averaged' },
  { value: 'cluster', label: 'Cluster', title: 'The cluster row selected in the Clusters tab, voxels averaged' },
] as const;

const DISPLAY_OPTIONS = [
  {
    value: 'summary',
    label: 'Population',
    title: 'Centre and band across participants, per condition',
  },
  {
    value: 'participants',
    label: 'Participants',
    title: "Each participant's line; click to focus it",
  },
] as const;

export function SetSeriesPlot({ ctx }: { ctx: PlotModeContext }) {
  const workspaceKey = useViewStateStore((s) => s.activeWorkspaceKey);
  // Re-sample when the dataset, its population or its selection changes.
  const sets = useSetStudioStore((s) => s.sets);
  const selection = useSetStudioStore((s) => s.selection);
  const population = useSetStudioStore((s) => s.population);
  const settings = useSeriesStore();
  const [result, setResult] = useState<{
    frame: SampleFrame;
    binding: SetSeriesBinding;
    regionLabel: string | null;
  } | null>(null);
  // A cluster locus follows the Clusters tab's selected row and table.
  const clusterSelection = useClusterStore((s) => (settings.locus === 'cluster' ? s.selectedId : null));
  const clusterTable = useClusterStore((s) => (settings.locus === 'cluster' ? s.result : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const crosshair = ctx.crosshairMm;
  const radiusMm = seriesRadiusMm(settings);
  const crosshairKey = crosshair ? crosshair.map((v) => v.toFixed(2)).join(',') : '';

  useEffect(() => {
    if (!crosshair) return;
    const worldMm = [crosshair[0], crosshair[1], crosshair[2]] as const;
    const timer = setTimeout(() => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      const locusKind = useSeriesStore.getState().locus;
      (async () => {
        const region =
          locusKind === 'region'
            ? await regionAtCrosshair(worldMm)
            : locusKind === 'cluster'
              ? selectedClusterRegion()
              : null;
        if (region && !region.region) throw new Error(region.issue);
        const regionLabel = region && region.region ? region.label : null;
        const next = await sampleSetSeries(
          useSetStudioStore.getState(),
          workspaceKey,
          { worldMm, radiusMm, reduce: 'mean', region: region?.region ?? null, regionLabel },
          abort.signal,
        );
        return { ...next, regionLabel };
      })()
        .then((next) => {
          if (abort.signal.aborted) return;
          setResult(next);
          setError(null);
        })
        .catch((e) => {
          if (abort.signal.aborted) return;
          setError((e as Error).message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, SAMPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // crosshairKey stands for the crosshair (a new tuple each move).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    crosshairKey,
    radiusMm,
    settings.locus,
    clusterSelection,
    clusterTable,
    workspaceKey,
    sets,
    selection,
    population.sessionRevision,
    population.participants,
  ]);
  useEffect(() => () => controller.current?.abort(), []);

  const recipe = result ? seriesRecipe(result.binding, settings) : null;
  const composed = useMemo(() => {
    if (!result || !recipe) return null;
    try {
      return { ok: composePopulationPlot(result.frame, recipe), error: null };
    } catch (e) {
      return { ok: null, error: (e as Error).message };
    }
    // recipe is derived from settings + binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, settings]);

  const binding = result?.binding ?? null;
  const conditions =
    composed?.ok && recipe?.color
      ? [...new Set(composed.ok.frame.rows.map((r) => String(r[recipe.color!] ?? '(missing)')))]
      : [];
  const participants =
    result && binding?.subjectColumn
      ? new Set(result.frame.rows.map((r) => r[binding.subjectColumn!])).size
      : 0;
  const locus =
    result?.regionLabel && (settings.locus === 'region' || settings.locus === 'cluster')
      ? `${settings.locus === 'region' ? 'region ' : ''}${result.regionLabel}`
      : crosshair
        ? `${radiusMm > 0 ? `${radiusMm} mm sphere` : 'voxel'} at ${crosshair.map((v) => formatWorldMm(v)).join(', ')} mm`
        : 'no crosshair';

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1 overflow-auto p-2 text-bf-xs"
      data-testid="set-series-plot"
    >
      <Toolbar aria-label="Series" className="flex-wrap px-0">
        <SegmentedControl
          aria-label="Series display"
          options={DISPLAY_OPTIONS}
          value={settings.display}
          onValueChange={(v) => settings.update({ display: v as 'summary' | 'participants' })}
        />
        <ToolbarField label="Centre">
          <Select
            aria-label="Series centre"
            className="w-auto"
            value={settings.summary}
            disabled={settings.display !== 'summary'}
            onValueChange={(v) => {
              const summary = v as 'mean' | 'median';
              settings.update({
                summary,
                band:
                  summary === 'median'
                    ? settings.band === 'none'
                      ? 'none'
                      : 'iqr'
                    : settings.band === 'iqr'
                      ? 'ci95'
                      : settings.band,
              });
            }}
            options={[
              { value: 'mean', label: 'Mean' },
              { value: 'median', label: 'Median' },
            ]}
          />
        </ToolbarField>
        <ToolbarField label="Band">
          <Select
            aria-label="Series band"
            className="w-auto"
            value={settings.band}
            disabled={settings.display !== 'summary'}
            onValueChange={(v) => settings.update({ band: v as typeof settings.band })}
            options={
              settings.summary === 'median'
                ? [
                    { value: 'iqr', label: 'Interquartile range' },
                    { value: 'none', label: 'None' },
                  ]
                : [
                    { value: 'ci95', label: '95% CI (t, n − 1 df)' },
                    { value: 'sem95', label: '± 1.96 SE' },
                    { value: 'sd', label: '± SD' },
                    { value: 'none', label: 'None' },
                  ]
            }
          />
        </ToolbarField>
        <SegmentedControl
          aria-label="Series locus"
          options={LOCUS_OPTIONS}
          value={settings.locus}
          onValueChange={(v) => settings.update({ locus: v as SeriesLocusKind })}
        />
        {settings.locus === 'sphere' ? (
          <ToolbarField label="Radius">
            <NumberField
              aria-label="Series sphere radius"
              fieldClassName="w-[9ch]"
              min={0.5}
              step={1}
              unit="mm"
              value={settings.radiusMm}
              onValueChange={(v) => v !== null && v > 0 && settings.update({ radiusMm: v })}
            />
          </ToolbarField>
        ) : null}
      </Toolbar>
      {result ? (
        <PopulationTransformControls
          frame={result.frame}
          recipe={recipe!}
          axisRange={numericRange(result.frame, SERIES_X)}
          onChange={(transforms) => settings.update({ transforms })}
        />
      ) : null}
      {error ? (
        <Notice severity="danger" role="alert">
          {error}
        </Notice>
      ) : null}
      {composed?.error ? (
        <Notice severity="warning" role="status">
          {composed.error}
        </Notice>
      ) : null}
      {binding && !binding.subjectColumn ? (
        <Notice severity="warning" role="status">
          Declare which column identifies participants (Population ▸ Participants) to reduce across
          them.
        </Notice>
      ) : null}
      {conditions.length > 0 ? (
        <div
          className="flex flex-wrap gap-3"
          aria-label="Series legend"
          data-testid="series-legend"
        >
          {conditions.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 text-bf-text-secondary">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3"
                // Data colour: the condition's line.
                style={{ background: populationCategoryColor(label) }}
              />
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {composed?.ok && recipe ? (
        <div className="min-h-0 flex-1" data-testid="series-plot">
          <PlotEncoder
            frame={composed.ok.frame}
            spec={composed.ok.spec}
            width={Math.max(200, ctx.width - 16)}
            height={Math.max(160, ctx.height - 120)}
            context={
              settings.display === 'participants'
                ? {
                    datumLink: {
                      idColumn: 'member',
                      focusedId: null,
                      selectedIds: new Set(composed.ok.frame.rows.map((r) => String(r.member))),
                      onFocus: (id) => {
                        const row = composed.ok!.frame.rows.find((r) => String(r.member) === id);
                        const observation = row?.[SERIES_OBSERVATION];
                        if (typeof observation === 'string')
                          populationProbeActions.focus(observation);
                      },
                      onToggleSelection: () => undefined,
                    },
                  }
                : undefined
            }
          />
        </div>
      ) : null}
      <p className="text-bf-2xs text-bf-text-muted" data-testid="series-caption">
        {binding
          ? `${seriesAxisTitle(binding)} · ${bandDescription(recipe!)} · ${participants} participant${participants === 1 ? '' : 's'} · ${locus}${loading ? ' · sampling…' : ''}`
          : loading
            ? 'Sampling…'
            : `Locus: ${locus}`}{' '}
        {composed?.ok ? transformSummary(composed.ok.frame) : ''}
      </p>
    </div>
  );
}
