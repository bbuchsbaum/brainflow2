/**
 * Pure comparisons for the run Inspector: effective metadata against the
 * series' modal values, and the numbers quoted under the FD trace.
 */
import type { BidsMetaValue, BidsRunRecord, BidsSeriesModal } from '@brainflow/api';

const NUMERIC_TOLERANCE = 1e-4;
/** As `check_tr` in the scan: a finding and this row must agree. */
const TR_TOLERANCE = 1e-3;
const PER_RUN_KEYS = new Set(['B0FieldIdentifier', 'B0FieldSource', 'IntendedFor']);
/** Shown even when equal to the modal value: they matter to the reader. */
const ALWAYS_SHOWN = new Set(['PhaseEncodingDirection', 'TotalReadoutTime']);
const LABELS: Record<string, string> = {
  NumberOfVolumes: 'dim[4] volumes',
  SliceTiming: 'SliceTiming, unique times',
};

export interface BidsMetaRow {
  key: string;
  label: string;
  value: string;
  /** Faint: the modal value, `=` when equal, or the outcome of a check. */
  modal: string;
  changed: boolean;
  /** `run`, `dataset` or `NIfTI`. */
  sourceLabel: string;
  /** The file that supplied the value. */
  sourceFile: string;
}

export interface BidsMetaComparison {
  rows: BidsMetaRow[];
  identicalHidden: number;
  /** The dataset-level sidecars that supplied a value. */
  inherited: string[];
  hasModal: boolean;
}

function parse(entry: BidsMetaValue | undefined): unknown {
  if (!entry) return undefined;
  try {
    return JSON.parse(entry.value) as unknown;
  } catch {
    return entry.value;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < NUMERIC_TOLERANCE;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'absent';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatValue).join(' × ');
  return JSON.stringify(value);
}

const uniqueTimes = (value: unknown) =>
  Array.isArray(value)
    ? new Set(value.map((item) => (typeof item === 'number' ? item.toFixed(4) : String(item)))).size
    : null;

const sourceLabel = (entry: BidsMetaValue | undefined) => {
  if (!entry) return '';
  if (entry.source_kind === 'nifti') return 'NIfTI';
  return entry.source_kind;
};

export function compareRunMetadata(
  run: BidsRunRecord,
  modal: BidsSeriesModal | undefined,
): BidsMetaComparison {
  const own = new Map(run.sidecar.map((entry) => [entry.key, entry]));
  const reference = new Map((modal?.values ?? []).map((entry) => [entry.key, entry]));
  const keys = [...new Set([...own.keys(), ...reference.keys()])].filter(
    (key) => !PER_RUN_KEYS.has(key) && key !== 'pixdim[4]',
  );
  const changed: BidsMetaRow[] = [];
  const same: BidsMetaRow[] = [];
  let identicalHidden = 0;
  for (const key of keys) {
    const entry = own.get(key);
    const value = parse(entry);
    const expected = parse(reference.get(key));
    const differs = modal ? !sameValue(value, expected) : false;
    const vector = key === 'SliceTiming';
    const row: BidsMetaRow = {
      key,
      label: LABELS[key] ?? key,
      value: vector ? String(uniqueTimes(value) ?? formatValue(value)) : formatValue(value),
      modal: !modal
        ? ''
        : !differs
          ? '='
          : vector
            ? String(uniqueTimes(expected) ?? formatValue(expected))
            : formatValue(expected),
      changed: differs,
      sourceLabel: sourceLabel(entry),
      sourceFile: entry?.source ?? '',
    };
    if (differs) changed.push(row);
    else if (ALWAYS_SHOWN.has(key)) same.push(row);
    else identicalHidden += 1;
  }
  const rows = [...changed, ...same];

  const pixdim = parse(own.get('pixdim[4]'));
  const tr = parse(own.get('RepetitionTime')) ?? run.header?.tr_seconds ?? undefined;
  if (typeof pixdim === 'number') {
    const entry = own.get('pixdim[4]');
    const comparable = typeof tr === 'number';
    const agrees = comparable && Math.abs(pixdim - tr) <= TR_TOLERANCE;
    rows.push({
      key: 'pixdim[4]',
      label: 'pixdim[4] vs TR',
      value: String(pixdim),
      modal: comparable ? (agrees ? 'match' : `TR ${tr}`) : 'no TR',
      changed: comparable && !agrees,
      sourceLabel: 'NIfTI',
      sourceFile: entry?.source ?? '',
    });
  }

  const inherited = [
    ...new Set(
      [...own.values()]
        .filter((entry) => entry.source_kind === 'dataset')
        .map((entry) => entry.source),
    ),
  ];
  return { rows, identicalHidden, inherited, hasModal: Boolean(modal) };
}

export interface BidsTraceStats {
  /** Frames with a value. */
  frames: number;
  mean: number | null;
  over: number;
  max: number;
}

/** The numbers under the trace, from the trace that is drawn. */
export function fdTraceStats(trace: ReadonlyArray<number | null>, lineMm: number): BidsTraceStats {
  let frames = 0;
  let sum = 0;
  let over = 0;
  let max = 0;
  for (const value of trace) {
    if (value === null) continue;
    frames += 1;
    sum += value;
    if (value > lineMm) over += 1;
    if (value > max) max = value;
  }
  return { frames, mean: frames ? sum / frames : null, over, max };
}

/** Stem minus the extension, kept readable for captions. */
export const sourceFileName = (path: string) => path.split('/').pop() ?? path;
