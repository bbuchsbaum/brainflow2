/**
 * Declared collapse transforms (phase 4 E4) for a population recipe:
 * baseline subtraction, a paired condition difference and a window mean,
 * applied in this order. Shared by the pinned population plot and the
 * Series mode. Each control states what it computes; nothing is applied
 * until it is switched on.
 */
import { useMemo } from 'react';
import type { SampleFrame } from '@/plotting';
import type { PopulationPlotRecipe, PopulationTransform } from '@/services/studio/populationPlot';
import { Checkbox, Select, Toolbar, ToolbarField } from '@/components/ui/bf';
import { ValidatedNumberField } from './ValidatedNumberField';

type Kind = PopulationTransform['kind'];
const ORDER: Kind[] = ['baseline', 'conditionDifference', 'windowMean'];

export interface PopulationTransformControlsProps {
  frame: SampleFrame;
  recipe: PopulationPlotRecipe;
  onChange: (transforms: PopulationTransform[]) => void;
  /** Lag/time axis numeric range, for default windows. */
  axisRange?: [number, number] | null;
}

export function PopulationTransformControls({
  frame,
  recipe,
  onChange,
  axisRange,
}: PopulationTransformControlsProps) {
  const transforms = recipe.transforms ?? [];
  const get = <K extends Kind>(kind: K) =>
    transforms.find((t): t is Extract<PopulationTransform, { kind: K }> => t.kind === kind);
  const set = (kind: Kind, next: PopulationTransform | null) => {
    const others = transforms.filter((t) => t.kind !== kind);
    const all = next ? [...others, next] : others;
    onChange(all.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
  };
  const measured = recipe.axis !== 'category';
  const [lo, hi] = axisRange ?? [0, 0];
  const conditionColumn =
    recipe.color ?? frame.columns.find((c) => c.name === 'condition')?.name ?? null;
  const levels = useMemo(
    () =>
      conditionColumn
        ? [
            ...new Set(
              frame.rows
                .map((r) => r[conditionColumn])
                .filter((v): v is string => typeof v === 'string'),
            ),
          ]
        : [],
    [frame, conditionColumn],
  );
  const baseline = get('baseline');
  const difference = get('conditionDifference');
  const window = get('windowMean');
  const unit = recipe.axisUnit ? ` ${recipe.axisUnit}` : '';
  const range = (
    t: { from: number; to: number },
    kind: 'baseline' | 'windowMean',
    label: string,
  ) => {
    // Field-level checks (v1 function 7): from ≤ to, and the window must
    // overlap the axis (its range is stated).
    const order = t.from > t.to ? `${label}: from must be ≤ to` : null;
    const outside =
      axisRange && (t.to < axisRange[0] || t.from > axisRange[1])
        ? `${label} ${t.from}–${t.to}${unit} is outside the axis (${axisRange[0]}–${axisRange[1]}${unit})`
        : null;
    const finite = (v: number | null) => (v === null ? 'Enter a number' : null);
    return (
      <>
        <ToolbarField label="From">
          <ValidatedNumberField
            aria-label={`${label} from`}
            fieldClassName="w-[8ch]"
            value={t.from}
            unit={unit.trim() || undefined}
            validate={finite}
            onCommit={(v) => set(kind, { kind, from: v, to: t.to })}
          />
        </ToolbarField>
        <ToolbarField label="To">
          <ValidatedNumberField
            aria-label={`${label} to`}
            fieldClassName="w-[8ch]"
            value={t.to}
            unit={unit.trim() || undefined}
            validate={finite}
            externalMessage={order ?? outside}
            onCommit={(v) => set(kind, { kind, from: t.from, to: v })}
          />
        </ToolbarField>
      </>
    );
  };
  // A window mean starts around the population's peak (± 1 step), never the
  // whole axis (v1 user 3).
  const peakWindow = (): [number, number] => {
    if (!axisRange) return [lo, hi];
    const sums = new Map<number, { s: number; n: number }>();
    for (const row of frame.rows) {
      const x = Number(row[recipe.x]);
      const v = Number(row.value);
      if (!Number.isFinite(x) || !Number.isFinite(v)) continue;
      const cell = sums.get(x) ?? { s: 0, n: 0 };
      cell.s += v;
      cell.n += 1;
      sums.set(x, cell);
    }
    let peak = axisRange[0];
    let best = -Infinity;
    for (const [x, { s, n }] of sums) if (Math.abs(s / n) > best) [best, peak] = [Math.abs(s / n), x];
    return [Math.max(axisRange[0], peak - 1), Math.min(axisRange[1], peak + 1)];
  };
  return (
    <Toolbar
      aria-label="Collapse transforms"
      className="flex-wrap px-0"
      data-testid="population-transforms"
    >
      <Checkbox
        checked={!!baseline}
        disabled={!measured || !recipe.detail}
        title="Subtract each participant line's mean over a pre-onset window"
        onCheckedChange={(on) =>
          set('baseline', on ? { kind: 'baseline', from: lo, to: lo } : null)
        }
      >
        Baseline
      </Checkbox>
      {baseline ? range(baseline, 'baseline', 'Baseline') : null}
      <Checkbox
        checked={!!difference}
        disabled={!conditionColumn || levels.length < 2 || !recipe.detail}
        title="Paired difference A − B per participant at each position"
        onCheckedChange={(on) =>
          set(
            'conditionDifference',
            on && conditionColumn
              ? { kind: 'conditionDifference', column: conditionColumn, a: levels[0], b: levels[1] }
              : null,
          )
        }
      >
        Difference
      </Checkbox>
      {difference ? (
        <>
          <ToolbarField label="A">
            <Select
              aria-label="Difference A"
              className="w-auto max-w-[140px]"
              value={difference.a}
              onValueChange={(v) => set('conditionDifference', { ...difference, a: v })}
              options={levels.map((l) => ({ value: l, label: l }))}
            />
          </ToolbarField>
          <ToolbarField label="− B">
            <Select
              aria-label="Difference B"
              className="w-auto max-w-[140px]"
              value={difference.b}
              onValueChange={(v) => set('conditionDifference', { ...difference, b: v })}
              options={levels.map((l) => ({ value: l, label: l }))}
            />
          </ToolbarField>
        </>
      ) : null}
      <Checkbox
        checked={!!window}
        disabled={!measured || !recipe.detail}
        title="Each participant line's mean over a window: one value per line"
        onCheckedChange={(on) => {
          const [from, to] = peakWindow();
          set('windowMean', on ? { kind: 'windowMean', from, to } : null);
        }}
      >
        Mean over window
      </Checkbox>
      {window ? range(window, 'windowMean', 'Window') : null}
    </Toolbar>
  );
}
