import { PopulationTimeCourseControls } from './PopulationTimeCourseControls';
import { PopulationTransformControls } from './PopulationTransformControls';
import { numericRange, transformSentence } from './populationTransform.helpers';
import {
  populationPlotPng,
  savePopulationPlot,
} from '@/services/studio/PopulationPlotExportService';
import { resolvePopulation } from '@/services/studio/populationContext';
import { populationCategoryColor } from './encoder/cartesianMarks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { populationPlotService } from '@/services/studio/PopulationPlotService';
import { composePopulationPlot, type PopulationPlotRecipe } from '@/services/studio/populationPlot';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { PlotEncoder } from './encoder/PlotEncoder';
import type { PlotModeContext } from './plotHost.types';
import { Button, Checkbox, Notice, Select, TextField, Toolbar, ToolbarField } from '@/components/ui/bf';

/** "Open plot": a file input dressed as a secondary bf Button (a label, so the picker opens). */
const FILE_BUTTON =
  'inline-flex h-6 cursor-pointer items-center rounded-sm border border-border bg-bf-bg-panel-raised px-2 text-bf-xs font-medium text-foreground transition-colors hover:bg-accent focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--bf-border-focus)]';
export function PopulationPlot({ ctx }: { ctx: PlotModeContext }) {
  const plots = useSyncExternalStore(
    populationPlotService.subscribe,
    populationPlotService.getSnapshot,
  );
  const graphic = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedFile, setSavedFile] = useState<string | null>(null);
  const [combineIds, setCombineIds] = useState<string[]>([]);
  const [verifying, setVerifying] = useState(false);
  const verification = useRef<AbortController | null>(null);
  useEffect(() => () => verification.current?.abort(), []);
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
  const download = async (format: 'json' | 'png' = 'json') => {
    if (!p || saving) return;
    setSaving(true);
    setSavedFile(null);
    try {
      const bytes =
        format === 'json'
          ? new TextEncoder().encode(populationPlotService.serialize(p.id))
          : await populationPlotPng(
              graphic.current!,
              `${p.label} · ${visibleFrame?.rows.length ?? 0}/${p.frame.rows.length} sample rows · ${p.selectionBinding === 'working' ? 'working selection' : 'pinned snapshot'}\nX: ${p.frame.columns.find((c) => c.name === p.recipe.x)?.label ?? p.recipe.x}${p.recipe.axisUnit ? ` (${p.recipe.axisUnit})` : ''} · Values: ${p.frame.columns.find((c) => c.name === 'value')?.unit ?? 'units unspecified'} · ${p.recipe.summary} · band: ${p.recipe.band}`,
              p.recipe.color
                ? [
                    ...new Set(
                      (composed?.frame.rows ?? []).map((r) =>
                        String(r[p.recipe.color!] ?? '(missing)'),
                      ),
                    ),
                  ].map((label) => ({ label, color: populationCategoryColor(label) }))
                : [],
            );
      const result = await savePopulationPlot(bytes, format);
      setSavedFile(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const visibleFrame = p ? populationPlotService.frameForView(p) : null;
  const composed = p && visibleFrame ? composePopulationPlot(visibleFrame, p.recipe) : null;
  const select = (label: string, key: 'x' | 'color' | 'facet' | 'detail', optional = false) =>
    p && (
      <ToolbarField label={label}>
        <Select
          aria-label={`Plot ${label}`}
          className="w-auto max-w-[160px]"
          value={p.recipe[key] ?? ''}
          onValueChange={(v) => apply({ [key]: v || null })}
        >
          {optional && <option value="">None</option>}
          {p.frame.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.label ?? c.name}
            </option>
          ))}
        </Select>
      </ToolbarField>
    );
  return (
    <div
      className="h-full overflow-auto p-2 text-xs space-y-2"
      aria-label="Population plot authoring"
    >
      {p && <PopulationTimeCourseControls key={p.id} plot={p} onCreated={setActive} />}
      <div className="flex flex-wrap gap-2 items-center">
        <Select
          className="w-auto max-w-full"
          aria-label="Pinned plot"
          value={p?.id ?? ''}
          onValueChange={(v) => setActive(v)}
          options={plots.map((plot) => ({ value: plot.id, label: plot.label }))}
        />
        {p && (
          <>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => void download()}>
              Save plot + samples
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={saving || !composed}
              onClick={() => void download('png')}
            >
              Export PNG
            </Button>
            <Button variant="secondary" size="sm" onClick={() => populationPlotService.close(p.id)}>
              Close plot
            </Button>
          </>
        )}
        <label className={FILE_BUTTON}>
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
      {plots.filter((plot) => !plot.origins).length >= 2 && (
        <details>
          <summary className="cursor-pointer">Combine pinned plots</summary>
          <div className="flex flex-wrap gap-2 mt-2">
            {plots
              .filter((plot) => !plot.origins)
              .map((plot) => (
                <Checkbox
                  key={plot.id}
                  className="max-w-full"
                  checked={combineIds.includes(plot.id)}
                  onCheckedChange={(checked) =>
                    setCombineIds((ids) =>
                      checked ? [...ids, plot.id] : ids.filter((id) => id !== plot.id),
                    )
                  }
                >
                  <span className="block truncate">{plot.label}</span>
                </Checkbox>
              ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={combineIds.length < 2}
              onClick={() => {
                try {
                  setActive(populationPlotService.combine(combineIds));
                  setError(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Combine samples
            </Button>
            <p className="w-full text-muted-foreground">
              Matching units are required. Identical observation/source/frame/probe samples appear
              once; set memberships are retained. Participant identity across sets must be declared
              using the line control.
            </p>
          </div>
        </details>
      )}
      {p && !p.origins && !populationPlotService.canLink(p) && (
        <Button
          variant="secondary"
          size="sm"
          disabled={verifying}
          onClick={async () => {
            const controller = new AbortController();
            verification.current?.abort();
            verification.current = controller;
            setVerifying(true);
            try {
              await populationPlotService.verifyAndLink(p.id, controller.signal);
              if (!controller.signal.aborted) setError(null);
            } catch (e) {
              if (!controller.signal.aborted) setError((e as Error).message);
            } finally {
              if (verification.current === controller) {
                verification.current = null;
                setVerifying(false);
              }
            }
          }}
        >
          {verifying
            ? 'Checking source hashes and sampled values…'
            : 'Verify and link to current population'}
        </Button>
      )}
      {!p && (
        <p>
          Pin sampled population values with “Compose in Plot” to compare groups and trajectories.
        </p>
      )}
      {p && (
        <ToolbarField label="Membership">
          <Select
            className="w-auto"
            aria-label="Plot membership binding"
            value={p.selectionBinding ?? 'snapshot'}
            onValueChange={(v) => {
              try {
                populationPlotService.bindSelection(p.id, v as 'snapshot' | 'working');
                setError(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <option value="snapshot">Pinned snapshot</option>
            <option value="working" disabled={!populationPlotService.canLink(p)}>
              Follow working selection
            </option>
          </Select>
        </ToolbarField>
      )}
      {p && !visibleFrame && (
        <p role="status">
          Verify this plot's live links to resume following the working selection, or choose its
          pinned snapshot.
        </p>
      )}
      {p && composed && (
        <>
          <Toolbar aria-label="Population plot encoding" className="px-0">
            {select('X', 'x')}
            {select('Color', 'color', true)}
            {select('Facet', 'facet', true)}
            {select('Participant / line', 'detail', true)}
            <ToolbarField label="Axis">
              <Select
                className="w-auto max-w-[200px]"
                aria-label="Plot axis"
                value={p.recipe.axis}
                onValueChange={(v) => apply({ axis: v as PopulationPlotRecipe['axis'] })}
              >
                <option value="category">Categories</option>
                <option value="number">Measured number</option>
                <option value="time">Measured time</option>
              </Select>
            </ToolbarField>
            <ToolbarField label="Axis units">
              <TextField
                className="w-20"
                aria-label="Plot axis units"
                value={p.recipe.axisUnit}
                onChange={(e) => apply({ axisUnit: e.target.value })}
              />
            </ToolbarField>
            <ToolbarField label="Mark">
              <Select
                className="w-auto max-w-[200px]"
                aria-label="Plot mark"
                value={p.recipe.mark}
                onValueChange={(v) => apply({ mark: v as PopulationPlotRecipe['mark'] })}
              >
                <option value="point">Points</option>
                <option value="box">Distribution</option>
                <option value="line">Trajectories</option>
              </Select>
            </ToolbarField>
            <ToolbarField label="Summary">
              <Select
                className="w-auto max-w-[200px]"
                aria-label="Plot summary"
                value={p.recipe.summary}
                onValueChange={(v) => {
                  const summary = v as PopulationPlotRecipe['summary'];
                  // Keep the band valid for the centre (IQR with a median).
                  const band =
                    summary === 'median'
                      ? p.recipe.band === 'none' ? 'none' : 'iqr'
                      : p.recipe.band === 'iqr' ? 'ci95' : p.recipe.band;
                  apply({ summary, band });
                }}
              >
                <option value="none">Individuals</option>
                <option value="mean">Participant mean</option>
                <option value="median">Participant median</option>
              </Select>
            </ToolbarField>
            <ToolbarField label="Within participant">
              <Select
                className="w-auto max-w-[200px]"
                aria-label="Plot within participant"
                value={p.recipe.within}
                onValueChange={(v) =>
                  apply({ within: v as PopulationPlotRecipe['within'] })
                }
              >
                <option value="single">One row per position</option>
                <option value="mean">Mean of repeated rows</option>
              </Select>
            </ToolbarField>
            <ToolbarField label="Band">
              <Select
                className="w-auto max-w-[200px]"
                aria-label="Plot band"
                value={p.recipe.band}
                onValueChange={(v) => apply({ band: v as PopulationPlotRecipe['band'] })}
              >
                <option value="none">None</option>
                <option value="sd" disabled={p.recipe.summary === 'median'}>Participant SD</option>
                <option value="sem95" disabled={p.recipe.summary === 'median'}>
                  Mean ± 1.96 SE (normal approximation)
                </option>
                <option value="ci95" disabled={p.recipe.summary === 'median'}>
                  95% CI of the mean (t, n − 1 df)
                </option>
                <option value="iqr" disabled={p.recipe.summary !== 'median'}>
                  Interquartile range
                </option>
              </Select>
            </ToolbarField>
          </Toolbar>
          <PopulationTransformControls
            frame={p.frame}
            recipe={p.recipe}
            axisRange={numericRange(composed.frame, p.recipe.x)}
            onChange={(transforms) => apply({ transforms })}
          />
          <p className="text-muted-foreground">
            Pinned samples · {visibleFrame?.rows.length} / {p.frame.rows.length} sample rows{' '}
            {p.frame.columns.find((c) => c.name === 'value')?.unit &&
              `· ${p.frame.columns.find((c) => c.name === 'value')!.unit}`}{' '}
            ·{' '}
            {populationPlotService.canLink(p)
              ? 'Click to focus; Shift-click to select.'
              : 'Detached sample receipt; no live image links.'}{' '}
            {p.recipe.summary !== 'none'
              ? 'Equal weight per locally valid participant; count varies by position.'
              : 'Observed samples.'}{' '}
            {transformSentence(composed.frame)}
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
          <div ref={graphic}>
            <PlotEncoder
              frame={composed.frame}
              spec={composed.spec}
              width={Math.max(200, ctx.width - 16)}
              height={Math.max(220, ctx.height - 180)}
              context={
                !composed.summary &&
                p.recipe.within === 'single' &&
                populationPlotService.canLink(p)
                  ? {
                      datumLink: {
                        idColumn: 'member',
                        focusedId:
                          (p.frame.rows.find(
                            (r) =>
                              populationPlotService.linkedMember(p, String(r.member)) ===
                                studio.selection.activeMemberId &&
                              (populationPlotService.linkedFrame(p, String(r.member)) === null ||
                                populationPlotService.linkedFrame(p, String(r.member)) ===
                                  studio.population.focusedFrame?.frame),
                          )?.member as string) ?? null,
                        selectedIds: new Set(
                          p.frame.rows
                            .filter((r) => {
                              const id = populationPlotService.linkedMember(p, String(r.member));
                              return id !== null && population.workingMemberIds.includes(id);
                            })
                            .map((r) => String(r.member)),
                        ),
                        onFocus: (id) => populationPlotService.focus(p, id),
                        onToggleSelection: (id) => populationPlotService.select(p, id),
                      },
                    }
                  : undefined
              }
            />
          </div>
        </>
      )}
      {savedFile && (
        <p role="status" className="break-all">
          Saved {savedFile}
        </p>
      )}
      {error && (
        <Notice severity="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
