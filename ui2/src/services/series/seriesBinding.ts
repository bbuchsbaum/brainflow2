/**
 * Series bindings (phase 4 E5): how a Set Studio dataset becomes a series.
 *
 * A series is source × axis × factors × members × locus, reduced in two
 * stages (spatially by the sampler, then within participant and across the
 * population by composePopulationPlot). This module resolves the axis and the
 * factors from what the dataset declares and expands its members into
 * sampling requests; it performs no I/O.
 *
 * Axis, in order:
 * 1. a NeuroTabs `SeriesAxis` (docs/neurotabs-series-axes.md):
 *    - `observation_column`: each member is one position, the column's value;
 *    - `feature_axis`: each member carries the whole series (a 4D member),
 *      positions `start + i · step`, i < count, sampled frame by frame;
 * 2. else a numeric design column named `lag` (or `time`), e.g. from folder
 *    discovery of `lag-<n>` file entities (units cannot be inferred).
 * Participants: the population's declared participant column, else a
 * `subject` / `participant` column. Conditions: a `condition` column.
 */
import type { SeriesAxis } from '@brainflow/api';
import type { SpatialFieldSetSummary } from '@/types/studio';
import type { PopulationMemberSource, PopulationParticipantDefinition } from '@/types/population';
import type { SampleFrame } from '@/plotting';

export interface SetSeriesBinding {
  setId: string;
  kind: 'lag' | 'time';
  /** Axis unit ("TR", "s", "ms"), or null when not declared. */
  unit: string | null;
  /** Observation-column axis: the design column holding each member's position. */
  column: string | null;
  /** Feature-axis series (4D members): positions start + i · step. */
  frames: { start: number; step: number; count: number } | null;
  subjectColumn: string | null;
  conditionColumn: string | null;
  /** Where the axis came from, for the plot's provenance line. */
  origin: 'manifest' | 'design column';
}

/** The frame column holding each sampled row's axis position. */
export const SERIES_X = '__seriesX';
/** The frame column holding each sampled row's source observation (4D members expand). */
export const SERIES_OBSERVATION = '__seriesObservation';

const SUBJECT_COLUMNS = ['subject', 'participant', 'sub', 'subject_id', 'participant_id'];
const CONDITION_COLUMNS = ['condition', 'cond', 'trial_type'];

const findColumn = (columns: readonly string[], names: readonly string[]) =>
  names.map((n) => columns.find((c) => c.toLowerCase() === n)).find((c) => c !== undefined) ?? null;

const isNumeric = (value: string | undefined) =>
  value !== undefined && value.trim() !== '' && Number.isFinite(Number(value));

/**
 * The dataset's series binding, or null when it declares no usable axis.
 * `metadata` maps observation id -> design values (studioMetadata rows).
 */
export function resolveSetSeriesBinding(
  set: SpatialFieldSetSummary,
  metadata: {
    columns: readonly string[];
    rows: ReadonlyMap<string, Readonly<Record<string, string>>>;
  },
  participants: PopulationParticipantDefinition | null = null,
): SetSeriesBinding | null {
  const columns = metadata.columns;
  const subjectColumn =
    participants?.setId === set.id && participants.identity.kind === 'column'
      ? participants.identity.column
      : findColumn(columns, SUBJECT_COLUMNS);
  const conditionColumn = findColumn(columns, CONDITION_COLUMNS);
  const allNumeric = (column: string) =>
    metadata.rows.size > 0 && [...metadata.rows.values()].every((row) => isNumeric(row[column]));
  const declared: SeriesAxis | undefined = (set.seriesAxes ?? []).find(
    (a) => a.kind === 'lag' || a.kind === 'time',
  );
  if (declared) {
    const kind = declared.kind as 'lag' | 'time';
    if (declared.source.type === 'observation_column') {
      const column = declared.source.column;
      if (!columns.includes(column) || !allNumeric(column)) return null;
      return {
        setId: set.id,
        kind,
        unit: declared.unit,
        column,
        frames: null,
        subjectColumn,
        conditionColumn,
        origin: 'manifest',
      };
    }
    if (!declared.count || declared.count < 2) return null;
    return {
      setId: set.id,
      kind,
      unit: declared.unit,
      column: null,
      frames: { start: declared.start ?? 0, step: declared.step ?? 1, count: declared.count },
      subjectColumn,
      conditionColumn,
      origin: 'manifest',
    };
  }
  const column = findColumn(columns, ['lag', 'time']);
  if (!column || !allNumeric(column)) return null;
  return {
    setId: set.id,
    kind: column.toLowerCase() === 'time' ? 'time' : 'lag',
    unit: null,
    column,
    frames: null,
    subjectColumn,
    conditionColumn,
    origin: 'design column',
  };
}

/** At most this many member × frame samples per series request. */
export const MAX_SERIES_SAMPLES = 8192;

/**
 * Members to sample: as they are for an observation-column axis; one per
 * frame for a feature axis (memberId `[id, frame]`, `stackIndex` frame).
 */
export function expandSeriesMembers(
  binding: SetSeriesBinding,
  members: readonly (PopulationMemberSource & {
    designValues?: readonly { column: string; value: string }[];
  })[],
): {
  members: (PopulationMemberSource & {
    designValues?: readonly { column: string; value: string }[];
  })[];
  positions: Map<string, { observation: string; x: number }>;
} {
  const positions = new Map<string, { observation: string; x: number }>();
  if (!binding.frames) {
    for (const m of members) {
      const value = m.designValues?.find((d) => d.column === binding.column)?.value;
      positions.set(m.memberId, { observation: m.memberId, x: Number(value) });
    }
    return { members: [...members], positions };
  }
  const { start, step, count } = binding.frames;
  if (members.length * count > MAX_SERIES_SAMPLES)
    throw new Error(
      `Series are limited to ${MAX_SERIES_SAMPLES.toLocaleString('en-US')} member × frame samples. Narrow the set.`,
    );
  const expanded = members.flatMap((m) =>
    Array.from({ length: count }, (_, frame) => {
      const memberId = JSON.stringify([m.memberId, frame]);
      positions.set(memberId, { observation: m.memberId, x: start + frame * step });
      return { ...m, memberId, stackIndex: frame };
    }),
  );
  return { members: expanded, positions };
}

/** Adds the axis position and source observation to each sampled row. */
export function withSeriesPositions(
  frame: SampleFrame,
  positions: ReadonlyMap<string, { observation: string; x: number }>,
  binding: SetSeriesBinding,
): SampleFrame {
  return {
    ...frame,
    columns: [
      ...frame.columns.filter((c) => c.name !== SERIES_X && c.name !== SERIES_OBSERVATION),
      { name: SERIES_OBSERVATION, label: 'Observation', role: 'nominal' },
      {
        name: SERIES_X,
        label: binding.kind === 'lag' ? 'Lag' : 'Time',
        role: binding.kind === 'time' && binding.unit ? 'temporal' : 'quantitative',
        ...(binding.unit ? { unit: binding.unit } : {}),
      },
    ],
    rows: frame.rows.map((row) => {
      const position = positions.get(String(row.member));
      return {
        ...row,
        [SERIES_OBSERVATION]: position?.observation ?? null,
        [SERIES_X]: position?.x ?? null,
      };
    }),
    meta: { ...frame.meta, seriesAxis: binding },
  };
}
