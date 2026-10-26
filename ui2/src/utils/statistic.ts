/**
 * Display helpers for a volume's statistic (NIfTI intent; UI redesign phase
 * 3, item 3). The backend decodes the header into `StatisticInfo` with a
 * ready-made `label` ("z", "t(24)", "F(2,30)"); nothing here is guessed from
 * file names.
 */
import type { StatisticInfo } from '@brainflow/api';

/** Kinds whose values carry a statistic unit worth printing next to numbers. */
function hasValueUnit(statistic: StatisticInfo): boolean {
  return statistic.kind !== 'none' && statistic.kind !== 'label' && statistic.kind !== 'data';
}

type ValueRange = { min: number; max: number } | null | undefined;

/**
 * True when the header's sign convention is being assumed: a log-p intent
 * (nifti1.h: log(p) <= 0) whose finite values are all >= 0, which many
 * pipelines use for −log(p). The backend supplies the label to show then
 * (`positiveDataLabel`).
 */
export function statisticSignAssumed(
  statistic: StatisticInfo | null | undefined,
  dataRange?: ValueRange,
): boolean {
  return (
    !!statistic?.positiveDataLabel &&
    !!dataRange &&
    Number.isFinite(dataRange.min) &&
    dataRange.min >= 0
  );
}

/**
 * Value units for a layer: the statistic label ("z", "t(24)") for statistic
 * maps; null for plain images, label volumes, other data intents and layers
 * without metadata. Pass the layer's data range so non-negative log-p maps
 * read "−log10(p)" (see `statisticSignAssumed`).
 */
export function statisticUnits(
  statistic: StatisticInfo | null | undefined,
  dataRange?: ValueRange,
): string | null {
  if (!statistic || !hasValueUnit(statistic)) return null;
  // A t guessed from the name whose values lie in [0, 1] is a p-like map.
  if (
    isInferredStatistic(statistic) &&
    statistic.kind === 't' &&
    dataRange &&
    dataRange.min >= 0 &&
    dataRange.max <= 1
  ) {
    return null;
  }
  const label = (
    statisticSignAssumed(statistic, dataRange) ? statistic.positiveDataLabel! : statistic.label
  ).trim();
  if (label.length === 0) return null;
  // A statistic guessed from the file name is marked wherever it is shown:
  // "z*" (long name "z score, inferred from file name").
  return isInferredStatistic(statistic) ? `${label}${INFERRED_MARK}` : label;
}

/** A formatted value with its statistic symbol first: "t(24) 3.42"; the bare value otherwise. */
export function formatStatisticValue(
  formattedValue: string,
  statistic: StatisticInfo | null | undefined,
  dataRange?: ValueRange,
): string {
  const units = statisticUnits(statistic, dataRange);
  return units ? `${units} ${formattedValue}` : formattedValue;
}

/**
 * Short description for the Inspector: the label plus where it came from,
 * e.g. "t(24) · t-stat", "z · intent 5", "t(24) · SPM description";
 * "(sign assumed)" is appended when a log-p label is flipped.
 */
export function describeStatistic(statistic: StatisticInfo, dataRange?: ValueRange): string {
  const head = statisticUnits(statistic, dataRange) ?? (statistic.label.trim() || statistic.kind);
  const source = statistic.fromDescription
    ? 'SPM description'
    : statistic.intentName.trim() || `intent ${statistic.intentCode}`;
  const assumed = statisticSignAssumed(statistic, dataRange) ? ' (sign assumed)' : '';
  return `${head} · ${source}${assumed}`;
}

/** One row of the image-header dialog's Statistic section. */
export interface StatisticFact {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Header-dialog rows for the decoded NIfTI intent (P3 item 3): the display
 * label, the raw intent code and name, the intent parameters and, when the
 * kind has them, the degrees of freedom.
 */
export function statisticFacts(
  statistic: StatisticInfo,
  dataRange?: { min: number; max: number } | null,
): Array<StatisticFact | null> {
  if (statistic.kind === 'none') {
    return [{ label: 'Statistic', value: 'None', mono: false }];
  }
  const shownAs = statisticUnits(statistic, dataRange);
  const intent = statistic.fromDescription
    ? 'unset (read from description)'
    : `${statistic.intentCode}${statistic.intentName ? ` (${statistic.intentName})` : ''}`;
  return [
    {
      label: 'Shown as',
      value:
        shownAs ??
        (statistic.kind === 'label'
          ? 'Label volume'
          : statistic.kind === 'data'
            ? 'Not a statistic'
            : statistic.label || statistic.kind),
      mono: false,
    },
    statisticSignAssumed(statistic, dataRange)
      ? {
          label: 'Sign convention',
          value: `Assumed: all values ≥ 0, read as ${statistic.positiveDataLabel} (header declares ${statistic.label})`,
          mono: false,
        }
      : null,
    { label: 'Intent code', value: intent, mono: !statistic.fromDescription },
    // All-zero parameters (z, most maps) say nothing: the row is omitted.
    statistic.intentParams.some((p) => p !== 0)
      ? {
          label: 'Intent params',
          value: statistic.intentParams.map((p) => formatParam(p).replace('-', '\u2212')).join(', '),
        }
      : null,
    statistic.dof.length > 0
      ? {
          label: 'Degrees of freedom',
          value: statistic.dof.map(formatParam).join(', '),
        }
      : null,
  ];
}

export interface SymbolPart {
  text: string;
  italic: boolean;
}

/**
 * Split a statistic label into italic (the variable) and upright parts
 * (df, function names): "t(24)" -> [t] (24); "−log10(p)" -> −log10( [p] );
 * "χ²(3)" -> [χ]²(3). Unknown labels come back as one upright part.
 */
export function splitStatisticSymbol(label: string): SymbolPart[] {
  const variable = /^([ztFrpχ])(²?)(\(.*\))?(\*)?$/.exec(label);
  if (variable) {
    const parts: SymbolPart[] = [{ text: variable[1], italic: true }];
    const rest = `${variable[2]}${variable[3] ?? ''}${variable[4] ?? ''}`;
    if (rest) parts.push({ text: rest, italic: false });
    return parts;
  }
  const logp = /^(−?(?:log10|ln)\()p(\))$/.exec(label);
  if (logp) {
    return [
      { text: logp[1], italic: false },
      { text: 'p', italic: true },
      { text: logp[2], italic: false },
    ];
  }
  return [{ text: label, italic: false }];
}

/** A degrees-of-freedom number: integers plain, else up to 2 decimals ("24", "23.5"). */
function formatParam(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

const DOF_KINDS = new Set(['t', 'f', 'chi2', 'correlation']);
const VARIABLE_WORD: Partial<Record<string, string>> = { z: 'score', p: 'value' };

/**
 * The Inspector Data card's statistic phrase (v1 visual critic): the
 * variable plus a word or its degrees of freedom: "z score", "t, df 24",
 * "F, df 2, 30", "p value". Returned split so the variable can be set in
 * italic. Log-p and named estimates fall back to their display label.
 */
export function statisticPhrase(
  statistic: StatisticInfo,
  dataRange?: ValueRange,
): { variable: string; rest: string } | null {
  const units = statisticUnits(statistic, dataRange);
  if (!units) return null;
  const variable = units.replace(/\(.*\)$/, '');
  // Paper notation: "t(24)", "F(2,30)" (StatSymbol italicises the variable).
  if (DOF_KINDS.has(statistic.kind)) return { variable: units, rest: '' };
  const word = VARIABLE_WORD[statistic.kind];
  return word && variable === statistic.label ? { variable, rest: ` ${word}` } : { variable: units, rest: '' };
}

/** Accessible long form of a statistic symbol: "t statistic, 24 degrees of freedom". */
export function statisticLongName(label: string): string {
  if (label.endsWith(INFERRED_MARK)) {
    return `${statisticLongName(label.slice(0, -INFERRED_MARK.length))}, inferred from file name`;
  }
  const m = /^([ztFrpχ])²?(?:\((.*)\))?$/.exec(label);
  if (!m) {
    const logp = /^(−?)(log10|ln)\(p\)$/.exec(label);
    if (logp) return `${logp[1] ? 'negative ' : ''}${logp[2] === 'ln' ? 'natural log' : 'log 10'} p value`;
    return label;
  }
  const names: Record<string, string> = {
    z: 'z score',
    t: 't statistic',
    F: 'F statistic',
    r: 'correlation r',
    p: 'p value',
    χ: 'chi-squared statistic',
  };
  const base = names[m[1]] ?? label;
  if (!m[2]) return base;
  const dof = m[2].split(',').map((d) => d.trim());
  return `${base}, ${dof.join(' and ')} degrees of freedom`;
}

/** The variable of a statistic label without its df ("t(24)" -> "t"); "value" for none. */
export function statisticVariable(units: string | null | undefined): string {
  return units ? units.replace(/\(.*\)$/, '') : 'value';
}

/** intent_name of a statistic guessed from the file name (no NIfTI intent). */
export const INFERRED_FROM_NAME = 'inferred from file name';

/** Suffix marking a statistic inferred from the file name ("z*"). */
export const INFERRED_MARK = '*';

/** True for a statistic guessed from the file name ("z (from name)"). */
export function isInferredStatistic(statistic: StatisticInfo | null | undefined): boolean {
  return statistic?.intentName === INFERRED_FROM_NAME;
}

/**
 * Name qualifiers that mean the map is not the statistic itself: FSL
 * randomise 1−p maps (`_tfce_corrp_tstat1`, `_vox_p_tstat1`), cluster index
 * and mask images (`cluster_mask_zstat1`), and the like.
 */
const NOT_THE_STATISTIC = new Set([
  'rendered',
  'p',
  'corrp',
  'tfce',
  'vox',
  'pval',
  'pvals',
  'cluster',
  'clusters',
  'mask',
  'index',
  'size',
  'clustere',
  'clusterm',
]);

const INTEGER_DTYPE = /^(u?int|uint|int)\d*$|^(u8|i8|u16|i16|u32|i32|u64|i64)$/i;

/**
 * A modest guess for FSL-style maps without an intent code: "zstat1" -> z,
 * "task_tstat2" -> t (no df). Only when the statistic token is the name's
 * LAST component and no other component qualifies it (p, corrp, tfce, vox,
 * cluster, mask, index …), and never for an integer-typed z (a cluster
 * index). Shown as "z (from name)"; the intent name records the guess. A t
 * guess whose data lie in [0, 1] is dropped once the range is known
 * (`statisticUnits`).
 */
export function inferStatisticFromName(fileName: string, dtype?: string | null): StatisticInfo | null {
  const base = fileName.toLowerCase().replace(/\.(nii\.gz|nii|gz|img|hdr|mgz)$/, '').replace(/\.nii$/, '');
  const tokens = base.split(/[_\-.\s]+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? '';
  const match = /^(z|t)stat\d*$/.exec(last);
  if (!match) return null;
  if (tokens.slice(0, -1).some((t) => NOT_THE_STATISTIC.has(t))) return null;
  const kind = match[1] as 'z' | 't';
  if (dtype && INTEGER_DTYPE.test(dtype.trim())) return null;
  return {
    kind,
    intentCode: 0,
    intentParams: [0, 0, 0],
    intentName: INFERRED_FROM_NAME,
    dof: [],
    label: kind,
    fromDescription: false,
    positiveDataLabel: null,
  };
}
