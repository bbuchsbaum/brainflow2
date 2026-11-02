/**
 * What an exclusion writes, built once: the dialog previews these rows and
 * sends these rows. The escaping mirrors `escape_cell` in
 * core/api_bridge/src/bids_index/exclusions.rs.
 */
import type { BidsBrowserIndex, BidsExclusion, BidsExclusionContext } from '@brainflow/api';
import {
  CENSOR_LINES_MM,
  DEFAULT_CENSOR_FRACTION,
  GHOST_CEILING,
  TSNR_ROBUST_SDS,
  TSNR_RULE,
  entityRunIds,
  subjectLabel,
  type BidsCensorCriterion,
  type BidsCensorLine,
  type BidsModel,
  type BidsRunFacts,
} from './bidsModel';

export const EXCLUSIONS_TSV = 'derivatives/brainflow/exclusions.tsv';
export const EXCLUSIONS_DESCRIPTION = 'derivatives/brainflow/dataset_description.json';
export const EXCLUSION_COLUMNS = [
  'entity',
  'reason',
  'criterion',
  'value',
  'author',
  'date',
  'source',
  'threshold',
  'definition',
  'triggered_by',
] as const;

export type BidsExclusionScope = 'run' | 'session' | 'participant';

export interface BidsExclusionCriterion {
  id: string;
  /** How the choice reads in the dialog. */
  label: string;
  reason: string;
  /** The `criterion` column. */
  criterion: string;
  value: string;
  source: string;
  /** The threshold the criterion used, as written in the `threshold` column. */
  threshold: string;
  /** The FD definition behind `value`, when it is FD. */
  definition: string;
  /** This run is over the criterion. */
  triggered: boolean;
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

function censorCriterion(
  facts: BidsRunFacts,
  lineMm: BidsCensorLine,
  maxFraction: number,
): BidsExclusionCriterion | null {
  const fd = facts.run.fd;
  if (!fd || fd.n_frames === 0) return null;
  const fraction = (lineMm === 0.2 ? fd.over_0_2 : fd.over_0_5) / fd.n_frames;
  const triggered = fraction > maxFraction;
  return {
    id: `censor:${lineMm}`,
    label: `${percent(fraction)} of frames over ${lineMm} mm (limit ${percent(maxFraction)})`,
    reason: `${percent(fraction)} of frames over ${lineMm} mm, above the ${percent(maxFraction)} limit`,
    criterion: `fd_frames_over_${lineMm}>${maxFraction}`,
    value: fraction.toFixed(2),
    source: fd.source,
    threshold: String(maxFraction),
    definition: fd.definition,
    triggered,
  };
}

/** The criteria a run can be excluded under, the one to prefill first. */
export function exclusionCriteria(
  facts: BidsRunFacts,
  model: BidsModel,
  censor: BidsCensorCriterion | null,
): BidsExclusionCriterion[] {
  const list: BidsExclusionCriterion[] = [];
  const threshold = model.fdThreshold;
  if (facts.meanFd !== null) {
    const mean = facts.meanFd.toFixed(2);
    const over = facts.meanFd > threshold;
    list.push({
      id: 'fd',
      label: `Mean FD ${mean} mm (threshold ${threshold} mm)`,
      reason: `Mean FD ${mean} mm, ${over ? 'over' : 'under'} the ${threshold} mm threshold`,
      criterion: `fd_mean>${threshold}`,
      value: mean,
      source: facts.run.fd?.source ?? facts.run.iqms?.source ?? '',
      threshold: String(threshold),
      definition: facts.run.fd?.definition ?? 'Power',
      triggered: over,
    });
  }
  const lines = censor
    ? [censor.lineMm, ...CENSOR_LINES_MM.filter((line) => line !== censor.lineMm)]
    : CENSOR_LINES_MM;
  for (const line of lines) {
    const fraction = censor?.lineMm === line ? censor.maxFraction : DEFAULT_CENSOR_FRACTION;
    const item = censorCriterion(facts, line, fraction);
    if (item) list.push(item);
  }
  if (facts.tsnr !== null && facts.tsnrOutlier) {
    const value = String(Math.round(facts.tsnr));
    const cut = Math.round(facts.tsnrOutlier.cut);
    list.push({
      id: 'tsnr',
      label: `tSNR ${value} (series cut ${cut})`,
      reason: `tSNR ${value}, below ${TSNR_RULE}: ${cut}`,
      criterion: `tsnr<series_median-${TSNR_ROBUST_SDS}rsd`,
      value,
      source: facts.run.iqms?.source ?? '',
      threshold: String(cut),
      definition: TSNR_RULE,
      triggered: true,
    });
  }
  if (facts.ghost !== null && facts.ghost > GHOST_CEILING) {
    const value = facts.ghost.toFixed(2);
    list.push({
      id: 'ghost',
      label: `Ghost ratio ${value} (ceiling ${GHOST_CEILING})`,
      reason: `Ghost ratio ${value}, over ${GHOST_CEILING}`,
      criterion: `gsr_y>${GHOST_CEILING}`,
      value,
      source: facts.run.iqms?.source ?? '',
      threshold: String(GHOST_CEILING),
      definition: '',
      triggered: true,
    });
  }
  for (const finding of model.index?.findings ?? []) {
    if (!finding.run_ids.includes(facts.run.id) || finding.severity === 'info') continue;
    list.push({
      id: `finding:${finding.id}`,
      label: finding.title,
      reason: finding.title,
      criterion: finding.code,
      value: '',
      source: finding.tag,
      threshold: '',
      definition: '',
      triggered: true,
    });
  }
  list.push({
    id: 'manual',
    label: 'Other, by hand',
    reason: '',
    criterion: 'manual',
    value: '',
    source: '',
    threshold: '',
    definition: '',
    triggered: false,
  });
  // `sort` keeps the order within each side.
  return list.sort((a, b) => Number(b.triggered) - Number(a.triggered));
}

const subjectEntity = (facts: BidsRunFacts) => subjectLabel(facts.run.subject);

export function exclusionEntity(facts: BidsRunFacts, scope: BidsExclusionScope): string {
  if (scope === 'run') return facts.run.id;
  const subject = subjectEntity(facts);
  if (scope === 'participant' || !facts.run.session) return subject;
  const session = facts.run.session.replace(/^ses-/, '');
  return `${subject}_ses-${session}`;
}

export interface BidsExclusionScopeOption {
  scope: BidsExclusionScope;
  label: string;
  entity: string;
  runs: number;
}

/** This run, the session's runs and the participant, with the run counts each covers. */
export function exclusionScopes(facts: BidsRunFacts, model: BidsModel): BidsExclusionScopeOption[] {
  const subject = subjectEntity(facts);
  const session = facts.run.session;
  const options: BidsExclusionScopeOption[] = [
    { scope: 'run', label: 'This run', entity: facts.run.id, runs: 1 },
  ];
  if (session) {
    const entity = exclusionEntity(facts, 'session');
    const runs = entityRunIds(model, entity).length;
    options.push({
      scope: 'session',
      label: `All ${runs} ${runs === 1 ? 'run' : 'runs'} in ses-${session.replace(/^ses-/, '')}`,
      entity,
      runs,
    });
  }
  const runs = entityRunIds(model, subject).length;
  const sessions = model.runs.reduce(
    (seen, item) => (item.run.subject === facts.run.subject ? seen.add(item.run.session) : seen),
    new Set<string | null>(),
  ).size;
  options.push({
    scope: 'participant',
    label:
      sessions > 1
        ? `${subject}, ${sessions === 2 ? 'both' : `all ${sessions}`} sessions`
        : `${subject}, all ${runs} ${runs === 1 ? 'run' : 'runs'}`,
    entity: subject,
    runs,
  });
  return options;
}

export interface BidsExclusionDraft {
  facts: BidsRunFacts;
  scope: BidsExclusionScope;
  reason: string;
  criterion: BidsExclusionCriterion;
  author: string;
  date: string;
}

export function buildExclusionRow(draft: BidsExclusionDraft): BidsExclusion {
  return {
    entity: exclusionEntity(draft.facts, draft.scope),
    scope: draft.scope,
    reason: draft.reason.trim(),
    criterion: draft.criterion.criterion,
    value: draft.criterion.value,
    author: draft.author.trim(),
    date: draft.date,
    source: draft.criterion.source,
    threshold: draft.criterion.threshold,
    definition: draft.criterion.definition,
    // A wider scope quotes one run's value: say which.
    triggered_by: draft.scope === 'run' || !draft.criterion.value ? '' : draft.facts.run.id,
  };
}

const tsvCell = (text: string) =>
  text === ''
    ? 'n/a'
    : text
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');

/** The exact line `write_bids_exclusions` appends for `row`. */
export const exclusionTsvLine = (row: BidsExclusion): string =>
  EXCLUSION_COLUMNS.map((column) => tsvCell(row[column])).join('\t');

export const exclusionTsvHeader = EXCLUSION_COLUMNS.join('\t');

/** What a write needs that no row says. */
export function exclusionContext(model: BidsModel): BidsExclusionContext {
  return { source_version: model.index?.dataset_version ?? null };
}

/** The first write creates the derivative's description; a later one leaves it alone. */
export function isFirstExclusionWrite(
  index: BidsBrowserIndex,
  exclusions: readonly BidsExclusion[],
  writtenThisSession: boolean,
): boolean {
  return (
    !writtenThisSession &&
    exclusions.length === 0 &&
    !index.exclusions_described
  );
}

/** Today by the author's calendar: a UTC date reads as tomorrow in the evening. */
export function localDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Mirrors `description_json`: DOI when the raw dataset has one, else its relative URI. */
export function exclusionDescriptionPreview(
  index: BidsBrowserIndex,
  context: BidsExclusionContext,
  appVersion: string | null,
): string {
  const source: Record<string, string> = index.doi
    ? { DOI: index.doi.startsWith('doi:') ? index.doi : `doi:${index.doi}` }
    : { URL: '../..' };
  if (context.source_version) source.Version = context.source_version;
  const generatedBy = { Name: 'Brainflow', ...(appVersion ? { Version: appVersion } : {}) };
  // The file is pretty-printed; the preview keeps to the dialog's height.
  return [
    `{ "Name": "Brainflow exclusions", "BIDSVersion": "1.9.0", "DatasetType": "derivative",`,
    `  "GeneratedBy": [${JSON.stringify(generatedBy)}],`,
    `  "SourceDatasets": [${JSON.stringify(source)}] }`,
  ].join('\n');
}

const AUTHOR_KEY = 'brainflow.bids.author';

export function rememberedAuthor(fallback: string): string {
  try {
    return globalThis.localStorage?.getItem(AUTHOR_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function rememberAuthor(author: string): void {
  try {
    globalThis.localStorage?.setItem(AUTHOR_KEY, author);
  } catch {
    // Storage unavailable: the field keeps its default next time.
  }
}
