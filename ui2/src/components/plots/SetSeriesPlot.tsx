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
import { resolveSeriesRegion } from '@/services/series/seriesRegion';
import { useClusterStore } from '@/stores/clusterStore';
import {
  SERIES_OBSERVATION,
  SERIES_X,
  type SetSeriesBinding,
} from '@/services/series/seriesBinding';
import { seriesRecipe } from '@/services/series/seriesRecipe';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { seriesRadiusMm, useSeriesStore } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { formatWorldMm } from '@/utils/valueFormat';
import {
  clusterLocusText,
  locusVoxels,
  seriesCaption,
  seriesCsv,
  seriesPlotParams,
  seriesSpec,
} from '@/services/series/seriesPresentation';
import { getEventBus } from '@/events/EventBus';
import { populationPlotPng, savePopulationPlot } from '@/services/studio/PopulationPlotExportService';
import {
  Button,
  Notice,
  SegmentedControl,
  Select,
  Toolbar,
  ToolbarField,
} from '@/components/ui/bf';
import { PlotEncoder } from './encoder/PlotEncoder';
import { populationCategoryColor } from './encoder/cartesianMarks';
import { bandLegendText } from './encoder/markLabels';
import { FRAME_LEGEND_INSET, PlotFrameLegend } from './PlotFrameLegend';
import { SeriesIssue } from './SeriesIssue';
import { seriesIssueAction, type SeriesIssueAction } from './seriesIssue.helpers';
import { PopulationTransformControls } from './PopulationTransformControls';
import { SeriesLocusControls } from './SeriesLocusControls';
import { numericRange, transformSummary } from './populationTransform.helpers';
import type { PlotModeContext } from './plotHost.types';

/** Wait this long after the last crosshair move before sampling (ms). */
const SAMPLE_DEBOUNCE_MS = 120;


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
  // The result carries the locus that PRODUCED it (v1 user 1): the caption
  // never describes settings that were not sampled.
  const [result, setResult] = useState<{
    frame: SampleFrame;
    binding: SetSeriesBinding;
    regionLabel: string | null;
    locusText: string;
    locusKind: string;
  } | null>(null);
  // A cluster locus follows the Clusters tab's selected row and table.
  const clusterSelection = useClusterStore((s) => (settings.locus === 'cluster' ? s.selectedId : null));
  const clusterTable = useClusterStore((s) => (settings.locus === 'cluster' ? s.result : null));
  const [error, setError] = useState<{ message: string; action: SeriesIssueAction } | null>(null);
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
        const region = await resolveSeriesRegion(useSeriesStore.getState(), worldMm);
        if (region && !region.region) throw Object.assign(new Error(region.issue), { locusKind });
        const regionLabel = region && region.region ? region.label : null;
        const next = await sampleSetSeries(
          useSetStudioStore.getState(),
          workspaceKey,
          { worldMm, radiusMm, reduce: 'mean', region: region?.region ?? null, regionLabel },
          abort.signal,
        );
        const locusText =
          regionLabel && locusKind === 'region'
            ? `region ${regionLabel}`
            : regionLabel && locusKind === 'cluster'
              ? (clusterLocusText(useClusterStore.getState().result, useClusterStore.getState().selectedId) ?? regionLabel)
              : `${radiusMm > 0 ? `${radiusMm} mm sphere` : 'voxel'} at ${worldMm.map((v) => formatWorldMm(v)).join(', ')} mm`;
        return { ...next, regionLabel, locusText, locusKind };
      })()
        .then((next) => {
          if (abort.signal.aborted) return;
          setResult(next);
          setError(null);
        })
        .catch((e) => {
          if (abort.signal.aborted) return;
          // No stale curves under a new caption: clear the plot (v1 user 1).
          setResult(null);
          const kind = (e as { locusKind?: string }).locusKind;
          setError({ message: (e as Error).message, action: seriesIssueAction(kind) });
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
    settings.regionPick,
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
  const locus = result?.locusText ?? 'no data';
  const featureLabel = useSetStudioStore((s) => (s.selection.activeFeatureId ? s.features[s.selection.activeFeatureId]?.label : null));
  const valueUnit = result?.frame.columns.find((c) => c.name === 'value')?.unit;
  const difference = (recipe?.transforms ?? []).find((t) => t.kind === 'conditionDifference');
  // "faces − houses (FIR beta, a.u.)" for a difference, else "FIR beta (a.u.)" (round 3 C9).
  const measure = `${featureLabel ?? 'Value'}, ${valueUnit ?? 'a.u.'}`;
  const yTitle =
    difference && difference.kind === 'conditionDifference'
      ? `${difference.a} − ${difference.b} (${measure})`
      : `${featureLabel ?? 'Value'} (${valueUnit ?? 'a.u.'})`;
  const transformCount = settings.transforms.length;
  const [transformsOpen, setTransformsOpen] = useState(false);
  // The plot is sized by its container (v0 visual 1: a fixed reserve overflowed at 1280).
  const plotBox = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = plotBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const next = { width: Math.floor(r.width), height: Math.floor(r.height) };
      setPlotSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const plotWidth = plotSize.width > 0 ? plotSize.width : Math.max(200, ctx.width - 16);
  const plotHeight = plotSize.height > 0 ? plotSize.height : Math.max(120, ctx.height - 96);

  const captionText =
    binding && recipe
      ? seriesCaption({
          binding,
          recipe,
          participants,
          locus,
          // A cluster locus states its voxels in its definition.
          voxels: result && result.locusKind !== 'cluster' ? locusVoxels(result.frame) : null,
          transforms: composed?.ok ? transformSummary(composed.ok.frame) : '',
          bandN: composed?.ok
            ? Math.max(0, ...composed.ok.frame.rows.map((r) => (typeof r.count === 'number' ? r.count : 0)))
            : undefined,
        })
      : '';
  const copySeriesCsv = async () => {
    if (!composed?.ok || !recipe || !binding) return;
    const csv = seriesCsv(composed.ok.frame, recipe, binding, {
      kind: result!.locusKind === 'point' ? 'voxel' : result!.locusKind,
      label: locus,
      voxels: locusVoxels(result!.frame),
    });
    try {
      await navigator.clipboard.writeText(csv);
      getEventBus().emit('ui.notification', { type: 'info', message: 'Series copied as CSV' });
    } catch {
      getEventBus().emit('ui.notification', { type: 'warning', message: 'Could not copy to the clipboard' });
    }
  };
  const exportSeriesImage = async () => {
    if (!plotBox.current) return;
    try {
      const png = await populationPlotPng(
        plotBox.current,
        captionText,
        conditions.map((label) => ({ label, color: populationCategoryColor(label) })),
      );
      const saved = await savePopulationPlot(png, 'png');
      if (saved) getEventBus().emit('ui.notification', { type: 'info', message: `Saved ${saved}` });
    } catch (e) {
      getEventBus().emit('ui.notification', { type: 'error', message: `Export failed: ${(e as Error).message}` });
    }
  };

  const bandText = recipe && settings.display === 'summary' ? bandLegendText(recipe) : null;
  const legend = conditions.map((label) => ({ label, color: populationCategoryColor(label) }));

  return (
    // The whole panel scrolls when the dock is short (round 3 C6): the plot
    // keeps its minimum height and axis, and the caption follows it, so no
    // data or axis is ever under the footer.
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2 text-bf-xs" data-testid="set-series-plot">
      {/* Row 1 (fixed slots, round 2 R4): mode, display, centre, band, locus and its parameter. */}
      <Toolbar aria-label="Series" className="shrink-0 flex-wrap px-0">
        {ctx.chrome}
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
                    // Short labels keep row 1 one row with a Region slot (round 3 C4); the caption gives the df.
                    { value: 'ci95', label: '95% CI (t)' },
                    { value: 'sem95', label: '± 1.96 SE' },
                    { value: 'sd', label: '± SD' },
                    { value: 'none', label: 'None' },
                  ]
            }
          />
        </ToolbarField>
        <SeriesLocusControls
          resolvedRegion={settings.locus === 'region' && !settings.regionPick ? (result?.regionLabel ?? null) : null}
        />
        {binding?.segmentColumn ? (
          <ToolbarField label="Runs">
            <Select
              aria-label="Series runs"
              className="w-auto"
              value={settings.datasetRunsFaceted ? 'faceted' : 'pooled'}
              onValueChange={(v) => settings.update({ datasetRunsFaceted: v === 'faceted' })}
              options={[
                { value: 'pooled', label: 'Pooled within participant' },
                { value: 'faceted', label: `Faceted by ${binding.segmentColumn}` },
              ]}
            />
          </ToolbarField>
        ) : null}
      </Toolbar>
      {/* Row 2: the transforms disclosure, always at the left. */}
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={transformsOpen}
          aria-controls="series-transforms"
          disabled={!result}
          onClick={() => setTransformsOpen((open) => !open)}
          title="Baseline, condition difference, window mean"
        >
          {transformsOpen ? '▾' : '▸'} Transforms{transformCount ? ` (${transformCount})` : ''}
        </Button>
      </div>
      {/* The body scrolls; the caption and export row below never do (v1 function 4). */}
      <div className="flex flex-[1_0_auto] flex-col gap-1">
        {result && transformsOpen ? (
          <div id="series-transforms" className="shrink-0">
            <PopulationTransformControls
              frame={result.frame}
              recipe={recipe!}
              axisRange={numericRange(result.frame, SERIES_X)}
              onChange={(transforms) => settings.update({ transforms })}
            />
          </div>
        ) : null}
        {error ? <SeriesIssue message={error.message} action={error.action} /> : null}
        {composed?.error ? (
          <Notice severity="warning" role="status" className="shrink-0">
            {composed.error}
          </Notice>
        ) : null}
        {binding && !binding.subjectColumn ? (
          <Notice severity="warning" role="status" className="shrink-0">
            Declare which column identifies participants (Population ▸ Participants) to reduce across
            them.
          </Notice>
        ) : null}
        {/* Never squeezed below a usable height (v1 function 5): the body scrolls instead. */}
        <div className="relative min-h-[160px] flex-1">
          <div ref={plotBox} className="absolute inset-0" data-testid="series-plot">
            {composed?.ok && recipe && binding ? (
              <PlotEncoder
                frame={composed.ok.frame}
                spec={seriesSpec(composed.ok.spec, recipe, {
                  ...seriesPlotParams(binding, composed.ok.frame, recipe, yTitle),
                  ...(legend.length ? { topInset: FRAME_LEGEND_INSET } : {}),
                  // Faceted by run: one row up to four panels, shared y (round 3 T3).
                  ...(recipe.facet
                    ? { facetColumns: Math.min(4, new Set(composed.ok.frame.rows.map((r) => r[recipe.facet!])).size) }
                    : {}),
                })}
                width={plotWidth}
                height={plotHeight}
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
                            if (typeof observation === 'string') populationProbeActions.focus(observation);
                          },
                          onToggleSelection: () => undefined,
                          selectable: false,
                          action: 'Click to make this the active member',
                          label: (i) => {
                            const row = composed.ok!.frame.rows[i];
                            const v = Number(row?.value);
                            return [
                              binding.subjectColumn ? row?.[binding.subjectColumn] : null,
                              binding.conditionColumn ? row?.[binding.conditionColumn] : null,
                              `${binding.kind} ${row?.[SERIES_X]}${binding.unit ? ` ${binding.unit}` : ''}: ${Number.isFinite(v) ? v.toPrecision(3) : 'no value'}`,
                            ]
                              .filter(Boolean)
                              .join(' · ');
                          },
                        },
                      }
                    : undefined
                }
              />
            ) : null}
          </div>
          {composed?.ok ? <PlotFrameLegend entries={legend} band={bandText} /> : null}
        </div>
      </div>
      {/* The caption has its own row below the plot (never over marks). */}
      <div className="flex shrink-0 items-start gap-2">
        <p className="min-w-0 flex-1 text-bf-2xs text-bf-text-muted" data-testid="series-caption">
          {binding && recipe ? captionText + (loading ? ' · sampling…' : '') : loading ? 'Sampling…' : `Locus: ${locus}`}
        </p>
        {composed?.ok && recipe && binding ? (
          <span className="inline-flex shrink-0 gap-1">
            <Button variant="secondary" size="sm" onClick={() => void copySeriesCsv()}>
              Copy CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportSeriesImage()}>
              Export image
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
