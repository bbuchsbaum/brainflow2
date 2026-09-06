import { resolvePopulation } from '@/services/studio/populationContext';
import { populationCategoryColor } from './encoder/cartesianMarks';
import { useState, useSyncExternalStore } from 'react';
import { populationPlotService } from '@/services/studio/PopulationPlotService';
import { composePopulationPlot, type PopulationPlotRecipe } from '@/services/studio/populationPlot';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { PlotEncoder } from './encoder/PlotEncoder';
import type { PlotModeContext } from './plotHost.types';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs max-w-full';
export function PopulationPlot({ ctx }: { ctx: PlotModeContext }) {
  const plots = useSyncExternalStore(
    populationPlotService.subscribe,
    populationPlotService.getSnapshot,
  );
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studio = useSetStudioStore();
  const population = resolvePopulation(studio);
  const p = plots.find((p) => p.id === active) ?? plots[plots.length - 1];
  const apply = (patch: Partial<PopulationPlotRecipe>) => {
    if (!p) return;
    try {
      populationPlotService.configure(p.id, { ...p.recipe, ...patch });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const download = () => {
    if (!p) return;
    const url = URL.createObjectURL(
      new Blob([populationPlotService.serialize(p.id)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'population-plot.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const composed = p ? composePopulationPlot(p.frame, p.recipe) : null;
  const select = (label: string, key: 'x' | 'color' | 'facet' | 'detail', optional = false) =>
    p && (
      <label>
        {label}{' '}
        <select
          aria-label={`Plot ${label}`}
          className={control}
          value={p.recipe[key] ?? ''}
          onChange={(e) => apply({ [key]: e.target.value || null })}
        >
          {optional && <option value="">None</option>}
          {p.frame.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div
      className="h-full overflow-auto p-2 text-xs space-y-2"
      aria-label="Population plot authoring"
    >
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className={control}
          aria-label="Pinned plot"
          value={p?.id ?? ''}
          onChange={(e) => setActive(e.target.value)}
        >
          {plots.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {p && (
          <>
            <button className={control} onClick={download}>
              Save plot + samples
            </button>
            <button className={control} onClick={() => populationPlotService.close(p.id)}>
              Close plot
            </button>
          </>
        )}
        <label className={`${control} cursor-pointer`}>
          Open plot
          <input
            className="sr-only"
            type="file"
            accept=".json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 16 * 1024 * 1024) throw new Error('Plot file exceeds 16 MiB.');
                populationPlotService.reopen(await file.text());
                setError(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </label>
      </div>
      {!p && (
        <p>
          Pin sampled population values with “Compose in Plot” to compare groups and trajectories.
        </p>
      )}
      {p && composed && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            {select('X', 'x')}
            {select('Color', 'color', true)}
            {select('Facet', 'facet', true)}
            {select('Participant / line', 'detail', true)}
            <label>
              Axis{' '}
              <select
                className={control}
                aria-label="Plot axis"
                value={p.recipe.axis}
                onChange={(e) => apply({ axis: e.target.value as PopulationPlotRecipe['axis'] })}
              >
                <option value="category">Categories</option>
                <option value="number">Measured number</option>
                <option value="time">Measured time</option>
              </select>
            </label>
            <label>
              Axis units{' '}
              <input
                className={`${control} w-20`}
                aria-label="Plot axis units"
                value={p.recipe.axisUnit}
                onChange={(e) => apply({ axisUnit: e.target.value })}
              />
            </label>
            <label>
              Mark{' '}
              <select
                className={control}
                aria-label="Plot mark"
                value={p.recipe.mark}
                onChange={(e) => apply({ mark: e.target.value as PopulationPlotRecipe['mark'] })}
              >
                <option value="point">Points</option>
                <option value="box">Distribution</option>
                <option value="line">Trajectories</option>
              </select>
            </label>
            <label>
              Summary{' '}
              <select
                className={control}
                aria-label="Plot summary"
                value={p.recipe.summary}
                onChange={(e) =>
                  apply({ summary: e.target.value as PopulationPlotRecipe['summary'] })
                }
              >
                <option value="none">Individuals</option>
                <option value="mean">Participant mean</option>
              </select>
            </label>
            <label>
              Within participant{' '}
              <select
                className={control}
                aria-label="Plot within participant"
                value={p.recipe.within}
                onChange={(e) =>
                  apply({ within: e.target.value as PopulationPlotRecipe['within'] })
                }
              >
                <option value="single">One row per position</option>
                <option value="mean">Mean of repeated rows</option>
              </select>
            </label>
            <label>
              Band{' '}
              <select
                className={control}
                aria-label="Plot band"
                value={p.recipe.band}
                onChange={(e) => apply({ band: e.target.value as PopulationPlotRecipe['band'] })}
              >
                <option value="none">None</option>
                <option value="sd">Participant SD</option>
                <option value="sem95">Mean ± 1.96 SE (normal approximation)</option>
              </select>
            </label>
          </div>
          <p className="text-muted-foreground">
            Pinned samples · {p.frame.rows.length} observations{' '}
            {p.frame.columns.find((c) => c.name === 'value')?.unit &&
              `· ${p.frame.columns.find((c) => c.name === 'value')!.unit}`}{' '}
            ·{' '}
            {populationPlotService.canLink(p)
              ? 'Click to focus; Shift-click to select.'
              : 'Detached sample receipt; no live image links.'}{' '}
            {p.recipe.summary === 'mean'
              ? 'Equal weight per locally valid participant; count varies by position.'
              : 'Observed samples.'}{' '}
            Navigation leaves this probe fixed.{' '}
            {composed.spec.params.jitter === true &&
              'Horizontal jitter separates overlapping observations; values are unchanged.'}
          </p>
          {p.recipe.color && (
            <div className="flex flex-wrap gap-3" aria-label="Plot color legend">
              {[
                ...new Set(
                  composed.frame.rows.map((row) => String(row[p.recipe.color!] ?? '(missing)')),
                ),
              ].map((label) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <span
                    style={{
                      background: populationCategoryColor(label),
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
          )}
          <PlotEncoder
            frame={composed.frame}
            spec={composed.spec}
            width={Math.max(200, ctx.width - 16)}
            height={Math.max(220, ctx.height - 180)}
            context={
              !composed.summary && p.recipe.within === 'single' && populationPlotService.canLink(p)
                ? {
                    datumLink: {
                      idColumn: 'member',
                      focusedId: studio.selection.activeMemberId,
                      selectedIds: new Set(population.workingMemberIds),
                      onFocus: (id) => populationPlotService.focus(p, id),
                      onToggleSelection: (id) => populationPlotService.select(p, id),
                    },
                  }
                : undefined
            }
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
