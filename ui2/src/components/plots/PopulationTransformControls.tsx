/**
 * Declared collapse transforms (phase 4 E4) for a population recipe:
 * baseline subtraction, a paired condition difference and a window mean,
 * applied in this order. Shared by the pinned population plot and the
 * Series mode. Each control states what it computes; nothing is applied
 * until it is switched on.
 *
 * Paired inputs (from/to, A/B) are validated as a pair (round 2 A3): both
 * fields are marked, one message is shared by both, and nothing reaches the
 * recipe until the pair is valid, so the last valid plot stays. A window
 * mean has no default window (round 2 S1): it waits for one, typed or taken
 * on request from the condition-averaged peak (and then labelled as such).
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { SampleFrame } from '@/plotting';
import {
  conditionAveragedPeakWindow,
  type PopulationPlotRecipe,
  type PopulationTransform,
} from '@/services/studio/populationPlot';
import { Button, Checkbox, NumberField, Select, Toolbar, ToolbarField } from '@/components/ui/bf';

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
  // Lags are whole numbers: a fractional window bound is refused (round 3 C9).
  const integerAxis = useMemo(() => {
    const xs = frame.rows.map((r) => r[recipe.x]).filter((v): v is number => typeof v === 'number');
    return xs.length > 0 && xs.every(Number.isInteger);
  }, [frame, recipe.x]);
  const lo = axisRange?.[0] ?? 0;
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
  // "Mean over window" switched on but no window yet: nothing is applied.
  const [windowPending, setWindowPending] = useState(false);
  const unit = recipe.axisUnit;
  // On the reduced, transformed curve (participants weigh equally, REVIEW m12).
  const peak = () => conditionAveragedPeakWindow(frame, { ...recipe, color: conditionColumn });
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
      {baseline ? (
        <WindowFields
          label="Baseline"
          unit={unit}
          axisRange={axisRange ?? null}
          integerAxis={integerAxis}
          value={baseline}
          onCommit={(from, to) => set('baseline', { kind: 'baseline', from, to })}
        />
      ) : null}
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
        <DifferenceFields
          levels={levels}
          value={difference}
          onCommit={(a, b) => set('conditionDifference', { ...difference, a, b })}
        />
      ) : null}
      <Checkbox
        checked={!!window || windowPending}
        disabled={!measured || !recipe.detail}
        title="Each participant line's mean over a window you set: one value per line"
        onCheckedChange={(on) => {
          setWindowPending(on);
          if (!on) set('windowMean', null);
        }}
      >
        Mean over window
      </Checkbox>
      {window || windowPending ? (
        <WindowFields
          label="Window"
          unit={unit}
          axisRange={axisRange ?? null}
          integerAxis={integerAxis}
          value={window ?? null}
          onCommit={(from, to) => set('windowMean', { kind: 'windowMean', from, to })}
          extra={
            <>
              {window?.source === 'condition-averaged-peak' ? (
                <span className="text-bf-2xs text-bf-text-muted" data-testid="window-source">
                  From the condition-averaged peak (data-driven)
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={!peak()}
                title="Peak of the mean over conditions (equal weight per condition), ± one step. The window then depends on these data; the caption says so."
                onClick={() => {
                  const w = peak();
                  if (w)
                    set('windowMean', {
                      kind: 'windowMean',
                      from: w[0],
                      to: w[1],
                      source: 'condition-averaged-peak',
                    });
                }}
              >
                Use condition-averaged peak ± 1
              </Button>
            </>
          }
        />
      ) : null}
    </Toolbar>
  );
}

const parse = (text: string): number | null => {
  if (text.trim() === '') return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
};

/**
 * From / To of a baseline or window, checked as a pair: an empty pair is a
 * hint ("Set a window"), a bad number, from > to or a window off the axis is
 * one message on both fields. Only a valid pair is committed.
 */
function WindowFields({
  label,
  unit,
  axisRange,
  integerAxis = false,
  value,
  onCommit,
  extra,
}: {
  label: 'Baseline' | 'Window';
  unit: string;
  axisRange: [number, number] | null;
  integerAxis?: boolean;
  /** The committed window; null while none is set. */
  value: { from: number; to: number } | null;
  onCommit: (from: number, to: number) => void;
  extra?: ReactNode;
}) {
  const messageId = useId();
  const committed = value ? `${value.from}|${value.to}` : '';
  const [draft, setDraft] = useState(() => ({
    from: value ? String(value.from) : '',
    to: value ? String(value.to) : '',
  }));
  const problem = pairProblem(draft, label, unit, axisRange, integerAxis);
  // Follow outside changes (the peak button, a reset) unless mid-edit on an invalid pair.
  useEffect(() => {
    if (!value) return;
    setDraft((d) =>
      pairProblem(d, label, unit, axisRange, integerAxis) && `${parse(d.from)}|${parse(d.to)}` !== committed
        ? d
        : { from: String(value.from), to: String(value.to) },
    );
    // committed stands for value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);
  const edit = (side: 'from' | 'to', text: string) => {
    const next = { ...draft, [side]: text };
    setDraft(next);
    const from = parse(next.from);
    const to = parse(next.to);
    if (!pairProblem(next, label, unit, axisRange, integerAxis) && from !== null && to !== null)
      if (`${from}|${to}` !== committed) onCommit(from, to);
  };
  const incomplete = !problem && (parse(draft.from) === null || parse(draft.to) === null);
  const hint = incomplete ? (label === 'Window' ? 'Set a window' : 'Set both bounds') : null;
  const field = (side: 'from' | 'to') => (
    <ToolbarField label={side === 'from' ? 'From' : 'To'}>
      <NumberField
        aria-label={`${label} ${side}`}
        aria-describedby={problem || hint ? messageId : undefined}
        fieldClassName="w-[8ch]"
        unit={unit || undefined}
        value={draft[side]}
        invalid={!!problem}
        onValueChange={(_, event) => edit(side, event.target.value)}
      />
    </ToolbarField>
  );
  return (
    <>
      {/* The window's fields wrap to their own row: name it (v4 function). */}
      {label === 'Window' ? (
        <span className="text-bf-text-secondary" data-testid="window-row-label">
          Window
        </span>
      ) : null}
      {field('from')}
      {field('to')}
      {problem ? (
        <span id={messageId} role="status" className="text-bf-2xs text-bf-danger">
          {problem}
        </span>
      ) : hint ? (
        <span id={messageId} className="text-bf-2xs text-bf-text-muted">
          {hint}
        </span>
      ) : null}
      {extra}
    </>
  );
}

function pairProblem(
  draft: { from: string; to: string },
  label: string,
  unit: string,
  axisRange: [number, number] | null,
  integerAxis = false,
): string | null {
  const from = parse(draft.from);
  const to = parse(draft.to);
  if ((draft.from.trim() && from === null) || (draft.to.trim() && to === null))
    return `${label}: enter a number`;
  if (from === null || to === null) return null;
  if (integerAxis && !(Number.isInteger(from) && Number.isInteger(to)))
    return `${label}: lags are whole numbers`;
  if (from > to) return `${label}: from must be ≤ to`;
  const u = unit ? ` ${unit}` : '';
  // Unicode minus, "−3 to 4" (round 3 C9).
  const n = (v: number) => (v < 0 ? `\u2212${-v}` : String(v));
  // Partly outside counts too (round 3 T5): {−3, 4} on a 0–7 axis is not a 0–4 window.
  if (axisRange && (from < axisRange[0] || to > axisRange[1]))
    return `${label} ${n(from)} to ${n(to)}${u} must lie within the axis (${n(axisRange[0])} to ${n(axisRange[1])}${u})`;
  return null;
}

/** A − B: two different levels, checked as a pair (both marked when equal). */
function DifferenceFields({
  levels,
  value,
  onCommit,
}: {
  levels: string[];
  value: { a: string; b: string };
  onCommit: (a: string, b: string) => void;
}) {
  const messageId = useId();
  const [draft, setDraft] = useState({ a: value.a, b: value.b });
  useEffect(() => {
    setDraft({ a: value.a, b: value.b });
  }, [value.a, value.b]);
  const same = draft.a === draft.b;
  const choose = (side: 'a' | 'b', level: string) => {
    const next = { ...draft, [side]: level };
    setDraft(next);
    if (next.a !== next.b) onCommit(next.a, next.b);
  };
  const options = levels.map((l) => ({ value: l, label: l }));
  return (
    <>
      <ToolbarField label="A">
        <Select
          aria-label="Difference A"
          aria-describedby={same ? messageId : undefined}
          className="w-auto max-w-[140px]"
          value={draft.a}
          invalid={same}
          onValueChange={(v) => choose('a', v)}
          options={options}
        />
      </ToolbarField>
      <ToolbarField label="− B">
        <Select
          aria-label="Difference B"
          aria-describedby={same ? messageId : undefined}
          className="w-auto max-w-[140px]"
          value={draft.b}
          invalid={same}
          onValueChange={(v) => choose('b', v)}
          options={options}
        />
      </ToolbarField>
      {same ? (
        <span id={messageId} role="status" className="text-bf-2xs text-bf-danger">
          Difference: choose two different conditions
        </span>
      ) : null}
    </>
  );
}
