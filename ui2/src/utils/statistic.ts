/**
 * Display helpers for a volume's statistic (NIfTI intent; UI redesign phase
 * 3, item 3). The backend decodes the header into `StatisticInfo` with a
 * ready-made `label` ("z", "t(24)", "F(2,30)"); nothing here is guessed from
 * file names.
 */
import type { StatisticInfo } from '@brainflow/api';
import { formatFixed } from './valueFormat';

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
  const label = (
    statisticSignAssumed(statistic, dataRange) ? statistic.positiveDataLabel! : statistic.label
  ).trim();
  return label.length > 0 ? label : null;
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
    {
      label: 'Intent params',
      value: statistic.intentParams.map((p) => formatFixed(p, 2)).join(', '),
    },
    statistic.dof.length > 0
      ? {
          label: 'Degrees of freedom',
          value: statistic.dof.map((d) => (Number.isInteger(d) ? String(d) : formatFixed(d, 2))).join(', '),
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
  const variable = /^([ztFrpχ])(²?)(\(.*\))?$/.exec(label);
  if (variable) {
    const parts: SymbolPart[] = [{ text: variable[1], italic: true }];
    const rest = `${variable[2]}${variable[3] ?? ''}`;
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
