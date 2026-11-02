/**
 * The one derived model of the BIDS browser (scientific rule 1): every count on
 * screen comes from `deriveBidsModel`. Views read it and never total anything.
 *
 * Rules mirrored here (docs/plans/bids-browser-design.md):
 *  1. One model, one count.
 *  2. QC is per run. Session values are summaries of runs and are named so.
 *  3. Default criterion: mean FD over 0.25 mm (Parkes et al. 2018, stringent).
 *     A censoring-fraction criterion is offered beside it. Excluded runs do NOT
 *     count toward session means (`EXCLUDED_MEAN_NOTE`).
 *  4. FD is not compared across TR or multiband groups: such sessions are
 *     flagged `hollow` unless the FD was filtered.
 *  5. Every quality item names its source and FD definition.
 *  6. Variants are differences in effective metadata, grouped, never errors.
 *  7. Validator and Brainflow findings keep separate tags.
 *
 * An excluded run leaves every count: column totals, session means, quality
 * items, variant counts and lens counts. A finding whose runs are all excluded
 * leaves its group; it is reached through Findings › Excluded.
 */
import type {
  BidsBrowserIndex,
  BidsDerivativeInfo,
  BidsExclusion,
  BidsFinding,
  BidsRunRecord,
  BidsScanProgress,
} from '@brainflow/api';

export const DEFAULT_FD_THRESHOLD_MM = 0.25;
/** The shared sparkline scale, stated in the Coverage header. */
export const FD_SPARK_MAX_MM = 1.4;
/**
 * A run is a tSNR outlier when it falls below its series median minus this
 * many robust SDs. tSNR depends on voxel size, TR and multiband, so no absolute
 * floor can mean anything across datasets: all 28 runs of ds001734 (TR 1 s) fail
 * a floor of 40.
 */
export const TSNR_ROBUST_SDS = 2.5;
/** MAD to SD under normality. */
export const MAD_TO_SD = 1.4826;
/** Fewer runs in a series than this give no median worth comparing with. */
export const TSNR_MIN_SERIES_RUNS = 8;
export const TSNR_RULE = `series median − ${TSNR_ROBUST_SDS} robust SD (MAD × ${MAD_TO_SD})`;
export const GHOST_CEILING = 0.15;
/** Parkes et al. 2018, stringent: over 20% of frames above 0.2 mm. */
export const DEFAULT_CENSOR_FRACTION = 0.2;
export const CENSOR_LINES_MM = [0.2, 0.5] as const;
export type BidsCensorLine = (typeof CENSOR_LINES_MM)[number];
export const SESSION_MEAN_NOTE = 'session mean of run FD, mm';
export const EXCLUDED_MEAN_NOTE = 'excluded runs not counted';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

// ---------------------------------------------------------------------------
// Lens: a serializable predicate over runs
// ---------------------------------------------------------------------------

export type BidsPredicate =
  | { op: 'all' }
  | { op: 'and' | 'or'; terms: BidsPredicate[] }
  | { op: 'not'; term: BidsPredicate }
  | { op: 'runs'; ids: string[] }
  | { op: 'subjects'; ids: string[] }
  | { op: 'session'; id: string | null }
  | { op: 'task'; id: string }
  | { op: 'variant'; key: string }
  | { op: 'severity'; severity: 'error' | 'content' }
  /** `mm: null` follows the current threshold. */
  | { op: 'fdOver'; mm: number | null }
  /** Saved lenses from before the relative rule. */
  | { op: 'tsnrBelow'; value: number }
  | { op: 'tsnrOutlier' }
  | { op: 'ghostOver'; value: number }
  | { op: 'censored'; lineMm: BidsCensorLine; fraction: number }
  | { op: 'excluded' }
  | { op: 'new' }
  | { op: 'noSession'; id: string }
  | { op: 'derivative'; name: string; statuses: string[] };

export interface BidsLens {
  id: string;
  label: string;
  predicate: BidsPredicate;
}

export type BidsLensMode = 'highlight' | 'only';

export interface BidsCensorCriterion {
  lineMm: BidsCensorLine;
  maxFraction: number;
}

// ---------------------------------------------------------------------------
// Model shape
// ---------------------------------------------------------------------------

export interface BidsRunFacts {
  run: BidsRunRecord;
  /** Fixed-order participant id, `sub-01`. */
  subjectLabel: string;
  /** Mean FD of the run, from confounds or else MRIQC. */
  meanFd: number | null;
  tsnr: number | null;
  /**
   * Below the cut of its acquisition group (`TSNR_RULE`); null when the group has
   * too few runs. `group` names it: series, protocol variant and echo.
   */
  tsnrOutlier: { median: number; cut: number; runs: number; group: string } | null;
  ghost: number | null;
  tr: number | null;
  multiband: number | null;
  volumes: number | null;
  overThreshold: boolean;
  excluded: boolean;
  variantKey: string | null;
  severity: 'error' | 'content' | null;
  /** In a group whose FD is not directly comparable with the modal group. */
  fdCaveat: boolean;
  /** Evaluated without regard to exclusion; see `inLens`. */
  matchesLens: boolean;
  /** Counted in the lens: matches it and is not excluded, unless the lens asks for excluded runs. */
  inLens: boolean;
}

/** `unknown`: a remote file not mirrored here, which may well exist. */
export type BidsCellMark = 'missing' | 'unknown' | 'unread' | 'error' | 'content' | 'spark' | 'hairline';

export interface BidsCell {
  mark: BidsCellMark;
  /** Run mean FD over threshold: strongest ink. */
  hot: boolean;
  variant: boolean;
  excluded: boolean;
  inLens: boolean;
  runId: string | null;
  trace: readonly number[] | null;
}

export interface BidsColumn {
  index: number;
  key: string;
  session: string | null;
  series: string;
  seriesLabel: string;
  /** Empty when the series has a single column in the session. */
  runLabel: string;
  isBold: boolean;
  /** Runs present and not excluded, among the rows on screen. */
  total: number;
}

export interface BidsSessionFd {
  session: string | null;
  mean: number | null;
  nRuns: number;
  over: boolean;
  hollow: boolean;
}

export interface BidsMatrixRow {
  index: number;
  subject: string;
  label: string;
  group: string | null;
  sex: string | null;
  age: string | null;
  isNew: boolean;
  unread: boolean;
  derivatives: Record<string, string>;
  sessionFd: BidsSessionFd[];
  inLens: boolean;
}

export interface BidsMatrixGroup {
  label: string;
  count: number;
  firstRow: number;
}

export interface BidsVariantSummary {
  key: string;
  id: string;
  name: string;
  diff: string;
  note: string;
  series: string[];
  runIds: string[];
  participants: number;
  sessionsLabel: string;
  subjectSessions: number;
  /** All of it bold, in one session of a known order: a change of protocol. */
  protocolWide: boolean;
}

export interface BidsFdGroup {
  key: string;
  tr: number | null;
  multiband: number | null;
  runs: number;
  modal: boolean;
}

export type BidsFindingGroupId =
  | 'saved'
  | 'errors'
  | 'content'
  | 'variants'
  | 'quality'
  | 'notes'
  | 'excluded';

export type BidsQualityKind = 'fd' | 'tsnr' | 'ghost' | 'censor';

export interface BidsFindingItem {
  id: string;
  group: BidsFindingGroupId;
  title: string;
  entity: string;
  detail: string;
  /** `validator`, `content`, `note` or `quality` (rule 7). */
  tag: string;
  lens: BidsLens | null;
  runIds: string[];
  /** Rule 5: where a number came from. */
  source: string | null;
  /** Dataset-relative file of a validator finding. */
  file?: string | null;
  subject?: string | null;
  n?: number;
  of?: number;
  kind?: BidsQualityKind;
  /** The number that sets this item apart from its rule's other items. */
  value?: string;
  exclusion?: BidsExclusion;
}

/**
 * Items saying one thing about different entities: one line, the rule, with a
 * count; the entities open under it, participant first.
 */
export interface BidsFindingRule {
  id: string;
  title: string;
  items: BidsFindingItem[];
  /** All the rule's runs at once. */
  lens: BidsLens | null;
  source: string | null;
}

export interface BidsFindingGroup {
  id: BidsFindingGroupId;
  label: string;
  items: BidsFindingItem[];
  /** `items` by rule; each item in exactly one. */
  rules: BidsFindingRule[];
}

export type BidsSummarySegment =
  | { kind: 'head'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'claim'; id: string; text: string; tone: 'neutral' | 'error' | 'warning'; lens: BidsLens }
  | { kind: 'threshold' };

export interface BidsCensorOffer {
  lineMm: BidsCensorLine;
  maxFraction: number;
  runsOver: number;
  ofRuns: number;
}

export interface BidsModel {
  /** The scan has not finished: every count reads "so far". */
  partial: boolean;
  streaming: boolean;
  datasetName: string;
  participants: {
    /** Participants read so far. */
    read: number;
    /** Participants expected: read plus those still unread. */
    expected: number;
    byGroup: Array<{ group: string; count: number }>;
    age: { min: number; max: number; median: number } | null;
    /** Listed in participants.tsv with no images here: not rows, not in any count. */
    noLocalData: number;
  };
  sessions: Array<string | null>;
  /** Session order is known, so "second session" means something. */
  sessionsOrdered: boolean;
  /** False on a remote mirror: an absent file may simply not be mirrored. */
  absenceKnown: boolean;
  columns: BidsColumn[];
  rows: BidsMatrixRow[];
  groups: BidsMatrixGroup[];
  /** `rows.length * columns.length` cells, row by row. */
  cells: BidsCell[];
  /** Rows not read yet whose ids are unknown: drawn empty, never estimated. */
  pendingRows: number;
  /** N of "runs present, of N". */
  columnTotalOf: number;
  derivativeColumns: BidsDerivativeInfo[];
  runs: BidsRunFacts[];
  runsById: Map<string, BidsRunFacts>;
  runPosition: Map<string, { row: number; col: number }>;
  variants: BidsVariantSummary[];
  fdGroups: BidsFdGroup[];
  /** What a hollow session dot means here, or null when there are none. */
  fdHollow: { modal: string; others: string[] } | null;
  /** Runs whose FD trace leaves the shared scale, and the largest value. */
  sparkClip: { runs: number; maxMm: number };
  findings: { groups: BidsFindingGroup[]; total: number };
  excluded: { rows: number; runs: number };
  lens: {
    lens: BidsLens | null;
    mode: BidsLensMode;
    runs: BidsRunFacts[];
    /** Runs that are not excluded: the denominator of "n of N runs". */
    ofRuns: number;
    /** BOLD runs in the lens, and of all not excluded, an echoed run once: what "run" means in counts. */
    bold: BidsRunFacts[];
    ofBold: number;
    participants: number;
    /** Lens runs per task, for the dock's facet. */
    tasks: Array<{ task: string; runs: number }>;
  };
  censorOffers: BidsCensorOffer[];
  summary: { segments: BidsSummarySegment[]; hasFd: boolean };
  status: {
    bidsVersion: string;
    datasetVersion: string | null;
    participants: number;
    findings: number;
    excludedRuns: number;
    errors: number;
    warnings: number;
    /** Rule 7: the validator's share of `errors` and `warnings`. */
    validatorErrors: number;
    validatorWarnings: number;
    filesRead: number;
    filesTotal: number;
    sizeBytes: number;
    soFar: boolean;
  };
  fdThreshold: number;
  index: BidsBrowserIndex | null;
}

export interface BidsModelOptions {
  fdThreshold?: number;
  exclusions?: readonly BidsExclusion[];
  lens?: BidsLens | null;
  lensMode?: BidsLensMode;
  groupBy?: string | null;
  savedLenses?: readonly BidsLens[];
  censor?: BidsCensorCriterion | null;
  progress?: BidsScanProgress | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const subjectLabel = (subject: string): string =>
  subject.startsWith('sub-') ? subject : `sub-${subject}`;
const sessionLabel = (session: string): string =>
  session.startsWith('ses-') ? session : `ses-${session}`;
const entityLabel = (subject: string | null, session: string | null): string =>
  subject === null
    ? 'dataset'
    : session === null
      ? subjectLabel(subject)
      : `${subjectLabel(subject)} ${sessionLabel(session)}`;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function metaNumber(run: BidsRunRecord, key: string): number | null {
  const entry = run.sidecar.find((item) => item.key === key);
  if (!entry) return null;
  try {
    const value: unknown = JSON.parse(entry.value);
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

export function seriesLabel(series: string): string {
  return series
    .replace(/^task-/, '')
    .replace(/_bold$/, '')
    .replace(/_dir-/, ' ')
    .replace(/_/g, ' ');
}

/** `sub-33 ses-02 nback run-1`: the one way a run is named on screen. */
export function runLabel(run: BidsRunRecord): string {
  const parts = [subjectLabel(run.subject)];
  if (run.session) parts.push(sessionLabel(run.session));
  parts.push(seriesLabel(run.series));
  if (run.run) parts.push(`run-${run.run}`);
  return parts.join(' ');
}

const DATATYPE_ORDER = ['anat', 'func', 'dwi', 'perf', 'fmap'];
const datatypeRank = (datatype: string) => {
  const rank = DATATYPE_ORDER.indexOf(datatype);
  return rank < 0 ? DATATYPE_ORDER.length : rank;
};

const columnKey = (run: BidsRunRecord) => `${run.session ?? ''}|${run.series}|${run.run ?? ''}`;

function exclusionMatcher(exclusions: readonly BidsExclusion[]) {
  const entities = new Set(exclusions.map((row) => row.entity));
  if (entities.size === 0) return () => false;
  return (runId: string): boolean => {
    if (entities.has(runId)) return true;
    const match = /^(sub-[^_]+)(?:_(ses-[^_]+))?/.exec(runId);
    if (!match) return false;
    return entities.has(match[1]) || (match[2] ? entities.has(`${match[1]}_${match[2]}`) : false);
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const findColumn = (columns: string[], name: string) =>
  columns.find((column) => column.toLowerCase() === name) ?? null;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/**
 * Which ordinal each session has earned, from 0, by rank among named sessions.
 * Dates speak only for the sessions they cover, and when there are dates an
 * undated session comes after them with no place of its own. Without dates,
 * numbers are a sequence only if nothing is skipped: of `2` and `5`, neither
 * is known to be the second session.
 */
function sessionOrdinals(named: readonly string[], dated: readonly string[]): Map<string, number> {
  if (dated.length > 0) {
    const covered = new Set(dated);
    return new Map(
      named.flatMap((session, rank) => (covered.has(session) ? [[session, rank] as const] : [])),
    );
  }
  const contiguous = named.every((session, rank) => /^\d+$/.test(session) && Number(session) === rank + 1);
  return contiguous ? new Map(named.map((session, rank) => [session, rank])) : new Map();
}

type SessionName = (session: string) => string;
const sessionNamer = (ordinals: ReadonlyMap<string, number>): SessionName => (session) => {
  const rank = ordinals.get(session);
  const ordinal = rank === undefined ? undefined : ORDINALS[rank];
  return ordinal ? `${ordinal} session` : sessionLabel(session);
};

/** One acquisition: echoes and parts of a run are not separate runs. */
export const acquisitionKey = (id: string) => id.replace(/_(?:echo|part)-[^_]+/g, '');
/** The echo and part of a run, as its file name gives them; empty for a single-echo run. */
const echoOf = (id: string) => (id.match(/_(?:echo|part)-[^_]+/g) ?? []).map((entity) => entity.slice(1)).join(' ');
const ruleTitle = (kind: BidsQualityKind, fdThreshold: number, censor: BidsCensorCriterion | null): string => {
  switch (kind) {
    case 'fd':
      return `Mean FD over ${fdThreshold} mm`;
    case 'tsnr':
      return 'tSNR outlier for its series';
    case 'ghost':
      return `Ghost ratio over ${GHOST_CEILING}`;
    case 'censor':
      return `Over ${Math.round((censor?.maxFraction ?? 0) * 100)}% of frames above ${censor?.lineMm} mm`;
  }
};

/** Counts out of a title; numbers that name something (`echo-2`, `sub-01`, `T1w`) stay. */
const withoutCounts = (title: string) => title.replace(/(?<![\w.-])\d+(\.\d+)?(?![\w-])/g, '#');
/** Each variant is its own protocol, however alike two titles read. */
const ownRule = (item: BidsFindingItem) =>
  item.group === 'saved' || item.group === 'excluded' || item.group === 'variants';

/** Quality items by kind; others by their title with its counts taken out. */
function findingRules(
  items: readonly BidsFindingItem[],
  fdThreshold: number,
  censor: BidsCensorCriterion | null,
): BidsFindingRule[] {
  const rules = new Map<string, BidsFindingRule>();
  for (const item of items) {
    const key = item.kind ?? (ownRule(item) ? item.id : withoutCounts(item.title));
    const rule = rules.get(key);
    if (rule) rule.items.push(item);
    else rules.set(key, { id: `rule:${key}`, title: item.kind ? ruleTitle(item.kind, fdThreshold, censor) : item.title, items: [item], lens: item.lens, source: item.source });
  }
  for (const rule of rules.values()) {
    if (rule.items.length < 2) continue;
    const terms = rule.items.flatMap((item) => (item.lens ? [item.lens.predicate] : []));
    rule.lens = terms.length ? lensOf(rule.id, rule.title, { op: 'or', terms }) : null;
    rule.source = new Set(rule.items.map((item) => item.source)).size === 1 ? rule.items[0].source : null;
  }
  return [...rules.values()];
}

/** A sparkline stops at the shared scale; the model says how often it did. */
function sparkClipOf(items: readonly BidsRunFacts[]): BidsModel['sparkClip'] {
  let runs = 0;
  let maxMm = 0;
  for (const item of oneEachAcquisition(items)) {
    const trace = item.run.fd?.trace;
    if (!trace?.length) continue;
    const peak = Math.max(...trace);
    if (peak > FD_SPARK_MAX_MM) runs += 1;
    if (peak > maxMm) maxMm = peak;
  }
  return { runs, maxMm: runs ? maxMm : 0 };
}

const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The low-tSNR cut of one series, or null without enough runs or any spread. */
export function tsnrCut(values: readonly number[]): { median: number; cut: number } | null {
  if (values.length < TSNR_MIN_SERIES_RUNS) return null;
  const median = medianOf(values);
  const robustSd = medianOf(values.map((value) => Math.abs(value - median))) * MAD_TO_SD;
  return robustSd > 0 ? { median, cut: median - TSNR_ROBUST_SDS * robustSd } : null;
}

/**
 * tSNR is only comparable within one protocol: TR, multiband and echo time set
 * its level. So a group is a series under one variant, TR and MB, per echo and
 * part; a change of protocol starts another group with its own minimum of runs.
 */
const tsnrGroupKey = (item: BidsRunFacts) =>
  [item.run.series, item.variantKey ?? '', fdGroupKey(item), echoOf(item.run.id)].join('|');

/**
 * Sets `tsnrOutlier` per acquisition group, over every bold run. Excluded runs
 * stay in the baseline: an exclusion must not turn other runs into outliers.
 */
function markTsnrOutliers(facts: readonly BidsRunFacts[], variants: readonly BidsVariantSummary[]): void {
  const groups = new Map<string, BidsRunFacts[]>();
  const protocols = new Map<string, Set<string>>();
  for (const item of facts) {
    if (item.run.suffix !== 'bold' || item.tsnr === null) continue;
    const key = tsnrGroupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
    const seen = protocols.get(item.run.series) ?? new Set<string>();
    protocols.set(item.run.series, seen.add(`${item.variantKey}|${fdGroupKey(item)}`));
  }
  const variantName = new Map(variants.map((variant) => [variant.key, variant.name]));
  for (const members of groups.values()) {
    const values = oneEachAcquisition(members).map((item) => item.tsnr as number);
    const rule = tsnrCut(values);
    if (!rule) continue;
    const [first] = members;
    const protocol =
      variantName.get(first.variantKey ?? '') ??
      ((protocols.get(first.run.series)?.size ?? 0) > 1 ? fdGroupName(fdGroupKey(first)) : '');
    const group = [seriesLabel(first.run.series), protocol, echoOf(first.run.id)].filter(Boolean).join(', ');
    for (const item of members) {
      if ((item.tsnr as number) < rule.cut) item.tsnrOutlier = { ...rule, runs: values.length, group };
    }
  }
}

function oneEachAcquisition(items: readonly BidsRunFacts[]): BidsRunFacts[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = acquisitionKey(item.run.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sidecars and `pixdim[4]` disagree in the noise: 0.72 and 0.72000002 are one TR. */
const roundTr = (tr: number) => Number(tr.toPrecision(4));
/** At least one decimal, and every digit kept: 2.0, 1.5, 0.72. */
export const formatTr = (tr: number): string =>
  Number(tr.toFixed(1)) === tr ? tr.toFixed(1) : String(tr);

const fdGroupKey = (item: Pick<BidsRunFacts, 'tr' | 'multiband'>) => `${item.tr}|${item.multiband}`;
function fdGroupName(key: string): string {
  const [tr, multiband] = key.split('|');
  if (tr === 'null') return 'TR not recorded';
  return `TR ${formatTr(Number(tr))} s / MB ${multiband}`;
}
/** Which acquisition groups a session's runs fall in: its FD mean's composition. */
const fdSignature = (items: readonly BidsRunFacts[]) =>
  [...new Set(items.map(fdGroupKey))].sort().join(',');
const fdSignatureName = (signature: string) =>
  signature.split(',').map(fdGroupName).join(' + ');

function formatScanDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function mergeVariants(
  index: BidsBrowserIndex,
  isExcluded: (id: string) => boolean,
  runSubjectSession: Map<string, string>,
  runSession: Map<string, string | null>,
  sessionsOrdered: boolean,
  sessionName: SessionName,
): { summaries: BidsVariantSummary[]; byRun: Map<string, string> } {
  // Upgrades spanning several tasks are one bridge group per task series.
  const merged = new Map<string, { group: BidsVariantSummary; ids: string[] }>();
  for (const group of index.variants) {
    const key = `${group.name}|${group.diff}`;
    const entry = merged.get(key) ?? {
      group: {
        key,
        id: group.id,
        name: group.name,
        diff: group.diff,
        note: group.note,
        series: [],
        runIds: [],
        participants: 0,
        subjectSessions: 0,
        sessionsLabel: '',
        protocolWide: false,
      },
      ids: [],
    };
    entry.group.series.push(group.series);
    entry.ids.push(...group.run_ids);
    merged.set(key, entry);
  }
  const byRun = new Map<string, string>();
  const summaries: BidsVariantSummary[] = [];
  for (const { group, ids } of merged.values()) {
    const live = ids.filter((id) => !isExcluded(id));
    for (const id of ids) byRun.set(id, group.key);
    if (live.length === 0) continue;
    const pairs = new Set(live.map((id) => runSubjectSession.get(id) ?? id));
    const people = new Set(live.map((id) => /^sub-[^_]+/.exec(id)?.[0] ?? id));
    const ownSessions = new Set(live.map((id) => runSession.get(id) ?? null));
    const only = ownSessions.size === 1 ? [...ownSessions][0] : undefined;
    summaries.push({
      ...group,
      runIds: live,
      participants: people.size,
      subjectSessions: pairs.size,
      sessionsLabel:
        only !== undefined && only !== null
          ? plural(pairs.size, sessionName(only), sessionPlural(sessionName(only)))
          : plural(pairs.size, 'session'),
      protocolWide:
        sessionsOrdered &&
        only !== undefined &&
        only !== null &&
        group.series.every((name) => name.endsWith('_bold')),
    });
  }
  summaries.sort((a, b) => b.runIds.length - a.runIds.length || naturalCompare(a.name, b.name));
  return { summaries, byRun };
}

/** `second sessions`, but `ses-pre sessions`: an id takes no plural of its own. */
const sessionPlural = (name: string) => (name.endsWith(' session') ? `${name}s` : `${name} sessions`);

interface LensContext {
  fdThreshold: number;
  newSubjects: Set<string>;
  subjectSessions: Map<string, Set<string | null>>;
  derivativeStatus: Map<string, Record<string, string>>;
}

function compilePredicate(
  predicate: BidsPredicate,
  context: LensContext,
): (facts: BidsRunFacts) => boolean {
  switch (predicate.op) {
    case 'all':
      return () => true;
    case 'and': {
      const terms = predicate.terms.map((term) => compilePredicate(term, context));
      return (facts) => terms.every((term) => term(facts));
    }
    case 'or': {
      const terms = predicate.terms.map((term) => compilePredicate(term, context));
      return (facts) => terms.some((term) => term(facts));
    }
    case 'not': {
      const term = compilePredicate(predicate.term, context);
      return (facts) => !term(facts);
    }
    case 'runs': {
      const ids = new Set(predicate.ids);
      return (facts) => ids.has(facts.run.id);
    }
    case 'subjects': {
      const ids = new Set(predicate.ids);
      return (facts) => ids.has(facts.run.subject);
    }
    case 'session':
      return (facts) => facts.run.session === predicate.id;
    case 'task':
      return (facts) => facts.run.task === predicate.id;
    case 'variant':
      return (facts) => facts.variantKey === predicate.key;
    case 'severity':
      return (facts) => facts.severity === predicate.severity;
    case 'fdOver': {
      const mm = predicate.mm ?? context.fdThreshold;
      return (facts) => facts.meanFd !== null && facts.meanFd > mm;
    }
    case 'tsnrBelow':
      return (facts) => facts.tsnr !== null && facts.tsnr < predicate.value;
    case 'tsnrOutlier':
      return (facts) => facts.tsnrOutlier !== null;
    case 'ghostOver':
      return (facts) => facts.ghost !== null && facts.ghost > predicate.value;
    case 'censored':
      return (facts) => censorFraction(facts.run, predicate.lineMm) > predicate.fraction;
    case 'excluded':
      return (facts) => facts.excluded;
    case 'new':
      return (facts) => context.newSubjects.has(facts.run.subject);
    case 'noSession':
      return (facts) => !context.subjectSessions.get(facts.run.subject)?.has(predicate.id);
    case 'derivative': {
      const statuses = new Set(predicate.statuses);
      return (facts) => {
        const status = context.derivativeStatus.get(facts.run.subject)?.[predicate.name];
        return status !== undefined && statuses.has(status);
      };
    }
  }
}

function usesExcluded(predicate: BidsPredicate): boolean {
  if (predicate.op === 'excluded') return true;
  if (predicate.op === 'and' || predicate.op === 'or') return predicate.terms.some(usesExcluded);
  return false;
}

function censorFraction(run: BidsRunRecord, lineMm: BidsCensorLine): number {
  if (!run.fd || run.fd.n_frames === 0) return 0;
  return (lineMm === 0.2 ? run.fd.over_0_2 : run.fd.over_0_5) / run.fd.n_frames;
}

const EMPTY_CELL: BidsCell = Object.freeze({
  mark: 'missing',
  hot: false,
  variant: false,
  excluded: false,
  inLens: false,
  runId: null,
  trace: null,
}) as BidsCell;
const UNREAD_CELL: BidsCell = Object.freeze({ ...EMPTY_CELL, mark: 'unread' }) as BidsCell;
const UNKNOWN_CELL: BidsCell = Object.freeze({ ...EMPTY_CELL, mark: 'unknown' }) as BidsCell;

/** A lens that names exactly these runs; the Findings list uses it. */
const lensOf = (id: string, label: string, predicate: BidsPredicate): BidsLens => ({
  id,
  label,
  predicate,
});

function emptyModel(fdThreshold: number, lensMode: BidsLensMode): BidsModel {
  return {
    partial: false,
    streaming: false,
    datasetName: '',
    participants: { read: 0, expected: 0, byGroup: [], age: null, noLocalData: 0 },
    sessions: [],
    sessionsOrdered: false,
    absenceKnown: true,
    columns: [],
    rows: [],
    groups: [],
    cells: [],
    pendingRows: 0,
    columnTotalOf: 0,
    derivativeColumns: [],
    runs: [],
    runsById: new Map(),
    runPosition: new Map(),
    variants: [],
    fdGroups: [],
    fdHollow: null,
    findings: { groups: [], total: 0 },
    sparkClip: { runs: 0, maxMm: 0 },
    excluded: { rows: 0, runs: 0 },
    lens: { lens: null, mode: lensMode, runs: [], ofRuns: 0, bold: [], ofBold: 0, participants: 0, tasks: [] },
    censorOffers: [],
    summary: { segments: [], hasFd: false },
    status: {
      bidsVersion: '',
      datasetVersion: null,
      participants: 0,
      findings: 0,
      excludedRuns: 0,
      errors: 0,
      warnings: 0,
      validatorErrors: 0,
      validatorWarnings: 0,
      filesRead: 0,
      filesTotal: 0,
      sizeBytes: 0,
      soFar: false,
    },
    fdThreshold,
    index: null,
  };
}

// ---------------------------------------------------------------------------
// deriveBidsModel
// ---------------------------------------------------------------------------

export function deriveBidsModel(
  index: BidsBrowserIndex | null,
  options: BidsModelOptions = {},
): BidsModel {
  const fdThreshold = options.fdThreshold ?? DEFAULT_FD_THRESHOLD_MM;
  const lensMode = options.lensMode ?? 'highlight';
  if (!index) return emptyModel(fdThreshold, lensMode);

  const exclusions = options.exclusions ?? index.exclusions;
  const lens = options.lens ?? null;
  const progress = options.progress ?? null;
  const isExcluded = exclusionMatcher(exclusions);

  // Sessions and subject membership.
  const runSubjectSession = new Map<string, string>();
  const runSession = new Map<string, string | null>();
  const subjectSessions = new Map<string, Set<string | null>>();
  const sessionSet = new Set<string | null>();
  for (const run of index.runs) {
    runSubjectSession.set(run.id, `${run.subject}|${run.session ?? ''}`);
    runSession.set(run.id, run.session);
    sessionSet.add(run.session);
    const own = subjectSessions.get(run.subject) ?? new Set();
    own.add(run.session);
    subjectSessions.set(run.subject, own);
  }
  const sessionRank = new Map(index.session_order.map((session, rank) => [session, rank]));
  const rankOf = (session: string | null) =>
    sessionRank.get(session ?? '') ?? Number.MAX_SAFE_INTEGER;
  const compareSessions = (a: string | null, b: string | null) =>
    rankOf(a) - rankOf(b) || naturalCompare(a ?? '', b ?? '');
  const sessions = [...sessionSet].sort(compareSessions);
  const named = sessions.filter((session): session is string => session !== null);
  // Numbered sessions run in order; `test` and `retest` need the dataset to say.
  const sessionsOrdered =
    index.session_order.length > 0 || (named.length > 0 && named.every((id) => /^\d+$/.test(id)));
  // A finished server walk makes a remote absence real. With a partial listing
  // an absence says nothing.
  const absenceKnown = !index.is_remote || index.listing_complete;
  const sessionName = sessionNamer(sessionOrdinals(named, index.session_order));

  // Findings by run.
  const severityByRun = new Map<string, 'error' | 'content'>();
  for (const finding of index.findings) {
    const severity =
      finding.severity === 'error'
        ? 'error'
        : finding.tag === 'content' && finding.severity === 'warning'
          ? 'content'
          : null;
    if (!severity) continue;
    for (const id of finding.run_ids) {
      if (severity === 'error' || !severityByRun.has(id)) severityByRun.set(id, severity);
    }
  }

  const { summaries: variants, byRun: variantByRun } = mergeVariants(
    index,
    isExcluded,
    runSubjectSession,
    runSession,
    sessionsOrdered,
    sessionName,
  );

  // Run facts, then FD comparability groups over the live bold runs.
  const facts: BidsRunFacts[] = index.runs.map((run) => {
    const isBold = run.suffix === 'bold';
    const meanFd = run.fd?.mean ?? run.iqms?.fd_mean ?? null;
    const excluded = isExcluded(run.id);
    const tr = isBold ? (metaNumber(run, 'RepetitionTime') ?? run.header?.tr_seconds ?? null) : null;
    return {
      run,
      subjectLabel: subjectLabel(run.subject),
      meanFd,
      tsnr: run.iqms?.tsnr ?? null,
      tsnrOutlier: null,
      ghost: run.iqms?.gsr_y ?? null,
      tr: tr === null ? null : roundTr(tr),
      multiband: isBold ? (metaNumber(run, 'MultibandAccelerationFactor') ?? 1) : null,
      volumes: run.header?.n_volumes ?? null,
      overThreshold: !excluded && meanFd !== null && meanFd > fdThreshold,
      excluded,
      variantKey: variantByRun.get(run.id) ?? null,
      severity: severityByRun.get(run.id) ?? null,
      fdCaveat: false,
      matchesLens: false,
      inLens: false,
    };
  });

  markTsnrOutliers(facts, variants);

  const fdCounts = new Map<string, BidsFdGroup>();
  // One acquisition, one count: the echoes of a run must not outvote other runs.
  const fdCounted = facts.filter(
    (item) => item.meanFd !== null && !item.excluded && item.tr !== null,
  );
  for (const item of oneEachAcquisition(fdCounted)) {
    const key = fdGroupKey(item);
    const group = fdCounts.get(key) ?? {
      key,
      tr: item.tr,
      multiband: item.multiband,
      runs: 0,
      modal: false,
    };
    group.runs += 1;
    fdCounts.set(key, group);
  }
  const fdGroups = [...fdCounts.values()].sort((a, b) => b.runs - a.runs);
  if (fdGroups.length) fdGroups[0].modal = true;
  const modalFd = fdGroups[0]?.key;
  for (const item of facts) {
    if (item.meanFd === null || modalFd === undefined) continue;
    // An unknown TR cannot be assumed comparable.
    item.fdCaveat = fdGroupKey(item) !== modalFd && !item.run.fd?.filtered;
  }

  // Listed but without images in a complete local scan: stated once, not a row,
  // and not a new participant either.
  const subjects = [...new Set([...index.subjects, ...index.runs.map((run) => run.subject)])].sort(
    naturalCompare,
  );
  const imagedSubjects = new Set(index.runs.map((run) => run.subject));
  const noLocalData =
    index.complete && absenceKnown ? subjects.filter((subject) => !imagedSubjects.has(subject)) : [];
  const withoutImages = new Set(noLocalData);

  // Lens.
  const newSubjects = new Set(index.new_subjects.filter((subject) => !withoutImages.has(subject)));
  const derivativeStatus = new Map<string, Record<string, string>>();
  for (const entry of index.derivative_status) {
    const own = derivativeStatus.get(entry.subject) ?? {};
    own[entry.name] = entry.status;
    derivativeStatus.set(entry.subject, own);
  }
  const lensContext: LensContext = { fdThreshold, newSubjects, subjectSessions, derivativeStatus };
  const matches = lens ? compilePredicate(lens.predicate, lensContext) : () => true;
  const lensCountsExcluded = lens ? usesExcluded(lens.predicate) : false;
  for (const item of facts) {
    item.matchesLens = matches(item);
    item.inLens = item.matchesLens && (lensCountsExcluded || !item.excluded);
  }

  // Participants and rows.
  const columnsOfTable = index.participant_columns;
  const groupColumn =
    options.groupBy === undefined ? findColumn(columnsOfTable, 'group') : options.groupBy;
  const sexColumn = findColumn(columnsOfTable, 'sex');
  const ageColumn = findColumn(columnsOfTable, 'age');
  const participantRows = new Map(
    index.participants.map((row) => [row.participant_id.replace(/^sub-/, ''), row.values]),
  );

  const rowFacts = new Map<string, BidsRunFacts[]>();
  for (const item of facts) {
    const own = rowFacts.get(item.run.subject) ?? [];
    own.push(item);
    rowFacts.set(item.run.subject, own);
  }

  interface Draft {
    subject: string;
    group: string | null;
    values: Record<string, string | undefined> | undefined;
    unread: boolean;
    facts: BidsRunFacts[];
  }
  const shownSubjects = subjects.filter((subject) => !withoutImages.has(subject));
  const drafts: Draft[] = shownSubjects.map((subject) => {
    const values = participantRows.get(subject);
    return {
      subject,
      group: groupColumn ? (values?.[groupColumn] ?? 'n/a') : null,
      values,
      unread: !index.complete && !rowFacts.has(subject),
      facts: rowFacts.get(subject) ?? [],
    };
  });
  const groupOrder = [...new Set(drafts.map((draft) => draft.group))].sort((a, b) => {
    if (a === 'n/a') return 1;
    if (b === 'n/a') return -1;
    return naturalCompare(a ?? '', b ?? '');
  });
  drafts.sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      naturalCompare(a.subject, b.subject),
  );

  const readDrafts = drafts.filter((draft) => !draft.unread);
  const byGroup = groupOrder
    .filter((group): group is string => group !== null)
    .map((group) => ({
      group,
      count: readDrafts.filter((draft) => draft.group === group).length,
    }))
    .filter((entry) => entry.count > 0);
  const ages = readDrafts
    .map((draft) => Number(ageColumn ? draft.values?.[ageColumn] : NaN))
    .filter((age) => Number.isFinite(age))
    .sort((a, b) => a - b);

  // "only" hides rows without a run in the lens.
  const visible =
    lens && lensMode === 'only' ? drafts.filter((draft) => draft.facts.some((f) => f.inLens)) : drafts;

  // Columns: session, then series, then run, natural order.
  const columnRuns = new Map<string, BidsRunRecord>();
  for (const run of index.runs) {
    if (!columnRuns.has(columnKey(run))) columnRuns.set(columnKey(run), run);
  }
  const ordered = [...columnRuns.values()].sort(
    (a, b) =>
      compareSessions(a.session, b.session) ||
      datatypeRank(a.datatype) - datatypeRank(b.datatype) ||
      naturalCompare(a.series, b.series) ||
      naturalCompare(a.run ?? '', b.run ?? ''),
  );
  const perSeries = new Map<string, number>();
  for (const run of ordered) {
    const key = `${run.session ?? ''}|${run.series}`;
    perSeries.set(key, (perSeries.get(key) ?? 0) + 1);
  }
  const columns: BidsColumn[] = ordered.map((run, position) => ({
    index: position,
    key: columnKey(run),
    session: run.session,
    series: run.series,
    seriesLabel: seriesLabel(run.series),
    runLabel: (perSeries.get(`${run.session ?? ''}|${run.series}`) ?? 0) > 1 ? (run.run ?? '') : '',
    isBold: run.suffix === 'bold',
    total: 0,
  }));
  const columnIndex = new Map(columns.map((column) => [column.key, column.index]));

  // What most subject-sessions' FD means are made of, per session (rule 4):
  // only a mean built differently from those is not comparable with them.
  const modalSignature = new Map<string | null, string>();
  for (const session of sessions) {
    const counts = new Map<string, number>();
    for (const draft of drafts) {
      const own = draft.facts.filter(
        (item) => item.run.session === session && item.meanFd !== null && !item.excluded,
      );
      if (own.length === 0) continue;
      const signature = fdSignature(own);
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    let top: string | null = null;
    for (const [signature, count] of counts) {
      if (top === null || count > (counts.get(top) ?? 0)) top = signature;
    }
    if (top !== null) modalSignature.set(session, top);
  }
  const hollowSignatures = new Set<string>();

  // Cells, totals, session summaries.
  const cells: BidsCell[] = new Array(visible.length * columns.length);
  const runPosition = new Map<string, { row: number; col: number }>();
  const rows: BidsMatrixRow[] = visible.map((draft, rowIndex) => {
    const base = rowIndex * columns.length;
    const blank = draft.unread ? UNREAD_CELL : absenceKnown ? EMPTY_CELL : UNKNOWN_CELL;
    cells.fill(blank, base, base + columns.length);
    for (const item of draft.facts) {
      const col = columnIndex.get(columnKey(item.run));
      if (col === undefined || cells[base + col].runId) continue;
      const trace = item.run.fd?.trace?.length ? item.run.fd.trace : null;
      const isBold = item.run.suffix === 'bold';
      cells[base + col] = {
        mark:
          item.severity === 'error'
            ? 'error'
            : item.severity === 'content'
              ? 'content'
              : isBold && trace
                ? 'spark'
                : 'hairline',
        hot: item.overThreshold,
        variant: item.variantKey !== null,
        excluded: item.excluded,
        inLens: lens !== null && item.inLens,
        runId: item.run.id,
        trace,
      };
      runPosition.set(item.run.id, { row: rowIndex, col });
      if (!item.excluded) columns[col].total += 1;
    }
    const sessionFd = sessions.map((session): BidsSessionFd => {
      const own = oneEachAcquisition(
        draft.facts.filter(
          (item) => item.run.session === session && item.meanFd !== null && !item.excluded,
        ),
      );
      if (own.length === 0) return { session, mean: null, nRuns: 0, over: false, hollow: false };
      const mean = own.reduce((sum, item) => sum + (item.meanFd as number), 0) / own.length;
      const signature = fdSignature(own);
      const hollow =
        signature !== modalSignature.get(session) && own.some((item) => !item.run.fd?.filtered);
      if (hollow) hollowSignatures.add(signature);
      return {
        session,
        mean,
        nRuns: own.length,
        over: mean > fdThreshold,
        hollow,
      };
    });
    return {
      index: rowIndex,
      subject: draft.subject,
      label: subjectLabel(draft.subject),
      group: draft.group,
      sex: sexColumn ? (draft.values?.[sexColumn] ?? null) : null,
      age: ageColumn ? (draft.values?.[ageColumn] ?? null) : null,
      isNew: newSubjects.has(draft.subject),
      unread: draft.unread,
      // A mirror's derivatives are as partial as its images.
      derivatives: absenceKnown ? (derivativeStatus.get(draft.subject) ?? {}) : {},
      sessionFd,
      inLens: lens !== null && draft.facts.some((item) => item.inLens),
    };
  });

  const groups: BidsMatrixGroup[] = [];
  if (groupColumn) {
    rows.forEach((row) => {
      const last = groups[groups.length - 1];
      if (last && last.label === row.group) last.count += row.unread ? 0 : 1;
      else {
        groups.push({ label: row.group ?? 'n/a', count: row.unread ? 0 : 1, firstRow: row.index });
      }
    });
  }

  // Findings.
  const live = (finding: BidsFinding) =>
    finding.run_ids.length === 0 || finding.run_ids.some((id) => !isExcluded(id));
  const findingItem = (group: BidsFindingGroupId, finding: BidsFinding): BidsFindingItem => ({
    id: finding.id,
    group,
    title: finding.title,
    entity: entityLabel(finding.subject, finding.session),
    detail: finding.detail,
    tag: finding.tag,
    lens: finding.run_ids.length
      ? lensOf(`finding:${finding.id}`, finding.title, { op: 'runs', ids: finding.run_ids })
      : finding.subject
        ? lensOf(`finding:${finding.id}`, finding.title, { op: 'subjects', ids: [finding.subject] })
        : null,
    runIds: finding.run_ids,
    source: null,
    file: finding.file,
    subject: finding.subject,
  });
  const liveFindings = index.findings.filter(live);
  const errorItems = liveFindings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => findingItem('errors', finding));
  const contentItems = liveFindings
    .filter((finding) => finding.severity === 'warning' && finding.tag === 'content')
    .map((finding) => findingItem('content', finding));
  const noteItems = liveFindings
    .filter(
      (finding) =>
        finding.severity !== 'error' && !(finding.tag === 'content' && finding.severity === 'warning'),
    )
    .map((finding) => findingItem('notes', finding));

  const variantItems: BidsFindingItem[] = variants.map((variant) => ({
    id: `variant:${variant.key}`,
    group: 'variants',
    title: `${variant.name}: ${variant.diff}`,
    entity: `${variant.participants} ${plural(variant.participants, 'participant')} · ${variant.runIds.length} ${plural(variant.runIds.length, 'run')}`,
    detail: variant.note,
    tag: 'variant',
    lens: lensOf(`variant:${variant.key}`, variant.name, { op: 'variant', key: variant.key }),
    runIds: variant.runIds,
    source: null,
    n: variant.runIds.length,
  }));

  const censor = options.censor ?? null;
  const qualityItems: BidsFindingItem[] = [];
  for (const draft of drafts) {
    for (const session of sessions) {
      const bold = oneEachAcquisition(
        draft.facts.filter(
          (item) => item.run.session === session && item.run.suffix === 'bold' && !item.excluded,
        ),
      );
      if (bold.length === 0) continue;
      const entity = entityLabel(draft.subject, session);
      const scope: BidsPredicate[] = [
        { op: 'subjects', ids: [draft.subject] },
        { op: 'session', id: session },
      ];
      const push = (
        kind: BidsQualityKind,
        over: BidsRunFacts[],
        of: number,
        title: string,
        predicate: BidsPredicate,
        source: string | null,
        detail = '',
        value = '',
        members = over,
      ) => {
        if (over.length === 0) return;
        const id = `quality:${kind}:${draft.subject}:${session ?? ''}`;
        qualityItems.push({
          id,
          group: 'quality',
          title,
          entity,
          detail,
          tag: 'quality',
          lens: lensOf(id, `${entity} · ${kind}`, { op: 'and', terms: [...scope, predicate] }),
          runIds: members.map((item) => item.run.id),
          source,
          n: over.length,
          of,
          kind,
          value,
        });
      };

      const withFd = bold.filter((item) => item.meanFd !== null);
      const overFd = withFd.filter((item) => item.overThreshold);
      if (overFd.length) {
        const max = Math.max(...overFd.map((item) => item.meanFd as number));
        push(
          'fd',
          overFd,
          withFd.length,
          `Mean FD over ${fdThreshold} mm in ${overFd.length} of ${withFd.length} runs, max ${max.toFixed(2)}`,
          { op: 'fdOver', mm: null },
          sharedSource(overFd.map((item) => item.run)),
          fdPoolingNote(withFd),
          max.toFixed(2),
        );
      }
      // Every echo has its own cut, and any echo below it counts for its run:
      // the same run count as the summary sentence.
      const echoes = draft.facts.filter(
        (item) => item.run.session === session && item.run.suffix === 'bold' && !item.excluded,
      );
      const withTsnr = oneEachAcquisition(echoes.filter((item) => item.tsnr !== null));
      const lowEchoes = echoes.filter((item) => item.tsnrOutlier !== null);
      const lowTsnr = oneEachAcquisition(lowEchoes);
      if (lowTsnr.length) {
        const min = Math.min(...lowEchoes.map((item) => item.tsnr as number));
        const origin = lowEchoes[0].run.iqms?.source;
        const cuts = new Map(lowEchoes.map((item) => [item.tsnrOutlier!.group, item.tsnrOutlier!]));
        push(
          'tsnr',
          lowTsnr,
          withTsnr.length,
          `tSNR outlier in ${lowTsnr.length} of ${withTsnr.length} runs, min ${Math.round(min)}`,
          { op: 'tsnrOutlier' },
          `${origin ? `${origin} · ` : ''}below ${TSNR_RULE}`,
          [...cuts.values()]
            .map((rule) => `${rule.group}: median ${Math.round(rule.median)} over ${rule.runs} runs, cut ${Math.round(rule.cut)}.`)
            .join(' '),
          Math.round(min).toString(),
          lowEchoes,
        );
      }
      const withGhost = bold.filter((item) => item.ghost !== null);
      const ghosted = withGhost.filter((item) => (item.ghost as number) > GHOST_CEILING);
      if (ghosted.length) {
        const max = Math.max(...ghosted.map((item) => item.ghost as number));
        push(
          'ghost',
          ghosted,
          withGhost.length,
          `Ghost ratio ${max.toFixed(2)} in ${ghosted.length} of ${withGhost.length} runs`,
          { op: 'ghostOver', value: GHOST_CEILING },
          ghosted[0].run.iqms?.source ?? null,
          '',
          max.toFixed(2),
        );
      }
      if (censor) {
        const framed = bold.filter((item) => item.run.fd);
        const censored = framed.filter(
          (item) => censorFraction(item.run, censor.lineMm) > censor.maxFraction,
        );
        if (censored.length) {
          const percent = Math.round(censor.maxFraction * 100);
          push(
            'censor',
            censored,
            framed.length,
            `Over ${percent}% of frames above ${censor.lineMm} mm in ${censored.length} of ${framed.length} runs`,
            { op: 'censored', lineMm: censor.lineMm, fraction: censor.maxFraction },
            sharedSource(censored.map((item) => item.run)),
            fdPoolingNote(framed),
            `${censored.length} of ${framed.length}`,
          );
        }
      }
    }
  }

  const liveRuns = facts.filter((item) => !item.excluded);
  const framedRuns = oneEachAcquisition(liveRuns).filter((item) => item.run.fd);
  const censorOffers: BidsCensorOffer[] = CENSOR_LINES_MM.map((lineMm) => ({
    lineMm,
    maxFraction: DEFAULT_CENSOR_FRACTION,
    runsOver: framedRuns.filter(
      (item) => censorFraction(item.run, lineMm) > DEFAULT_CENSOR_FRACTION,
    ).length,
    ofRuns: framedRuns.length,
  }));

  const contextFor = (saved: BidsLens) => compilePredicate(saved.predicate, lensContext);
  const savedItems: BidsFindingItem[] = (options.savedLenses ?? []).map((saved) => {
    const test = contextFor(saved);
    const countsExcluded = usesExcluded(saved.predicate);
    const members = facts.filter((item) => test(item) && (countsExcluded || !item.excluded));
    return {
      id: `saved:${saved.id}`,
      group: 'saved',
      title: saved.label,
      entity: `${members.length} of ${liveRuns.length} runs`,
      detail: '',
      tag: 'lens',
      lens: saved,
      runIds: [],
      source: null,
      n: members.length,
      of: liveRuns.length,
    };
  });
  const excludedItems: BidsFindingItem[] = exclusions.map((row) => ({
    id: `excluded:${row.entity}:${row.criterion}`,
    group: 'excluded',
    title: row.entity,
    entity: `${row.reason} · ${row.author}, ${row.date}`,
    detail: '',
    tag: 'excluded',
    lens: null,
    runIds: [],
    source: row.source || null,
    exclusion: row,
  }));

  const groupOf = (id: BidsFindingGroupId, label: string, items: BidsFindingItem[]): BidsFindingGroup => ({
    id,
    label,
    items,
    rules: findingRules(items, fdThreshold, censor),
  });
  const findingGroups: BidsFindingGroup[] = [
    groupOf('saved', 'Saved lenses', savedItems),
    groupOf('errors', 'Errors', errorItems),
    groupOf('content', 'Content problems', contentItems),
    groupOf('variants', 'Acquisition variants', variantItems),
    groupOf('quality', 'Quality', qualityItems),
    groupOf('notes', 'Notes', noteItems),
    groupOf('excluded', 'Excluded', excludedItems),
  ];
  // Saved lenses and exclusions are not findings about the data.
  const findingsTotal =
    errorItems.length +
    contentItems.length +
    variantItems.length +
    qualityItems.length +
    noteItems.length;
  const excludedRuns = facts.filter((item) => item.excluded).length;

  // Runs in lens, in matrix order.
  const runsById = new Map(facts.map((item) => [item.run.id, item]));
  const lensRuns: BidsRunFacts[] = [];
  for (const row of rows) {
    const base = row.index * columns.length;
    for (let col = 0; col < columns.length; col++) {
      const id = cells[base + col].runId;
      const item = id ? runsById.get(id) : undefined;
      if (item?.inLens) lensRuns.push(item);
    }
  }
  const lensTaskCounts = new Map<string, number>();
  for (const item of oneEachAcquisition(lensRuns)) {
    if (item.run.task) lensTaskCounts.set(item.run.task, (lensTaskCounts.get(item.run.task) ?? 0) + 1);
  }
  const lensTasks = [...lensTaskCounts.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([task, runs]) => ({ task, runs }));

  const partial = !index.complete;
  const unreadKnown = drafts.length - readDrafts.length;
  const streamedUnread = progress ? Math.max(0, progress.subjects_total - drafts.length) : 0;
  const expected = readDrafts.length + unreadKnown + streamedUnread;
  const claimsInput: ClaimsInput = {
    index,
    partial,
    streaming: progress !== null,
    read: readDrafts.length,
    expected,
    byGroup,
    ages,
    sessions,
    sessionsOrdered,
    absenceKnown,
    noLocalData: noLocalData.length,
    fdGroupCount: fdGroups.length,
    seriesCount: new Set(columns.map((column) => column.series)).size,
    subjectSessions,
    sessionName,
    newSubjects: [...newSubjects],
    readSubjects: readDrafts.map((draft) => draft.subject),
    variants,
    errors: errorItems,
    contentRuns: new Set(
      contentItems.flatMap((item) => item.runIds).filter((id) => !isExcluded(id)),
    ).size,
    participantsOverFd: new Set(
      qualityItems.filter((item) => item.kind === 'fd').map((item) => item.entity.split(' ')[0]),
    ).size,
    hasFd: facts.some((item) => item.meanFd !== null),
    tsnrOutliers: oneEachAcquisition(liveRuns.filter((item) => item.tsnrOutlier)).length,
    fdmissingForNew:
      absenceKnown &&
      newSubjects.size > 0 &&
      [...newSubjects].every((subject) => derivativeStatus.get(subject)?.fmriprep === 'missing') &&
      index.derivatives.some((derivative) => derivative.name === 'fmriprep'),
  };

  return {
    partial,
    streaming: progress !== null,
    datasetName: index.name,
    participants: {
      read: readDrafts.length,
      expected,
      byGroup,
      age: ages.length
        ? { min: ages[0], max: ages[ages.length - 1], median: median(ages) }
        : null,
      noLocalData: noLocalData.length,
    },
    sessions,
    sessionsOrdered,
    absenceKnown,
    columns,
    rows,
    groups,
    cells,
    pendingRows: lens && lensMode === 'only' ? 0 : streamedUnread,
    columnTotalOf: rows.filter((row) => !row.unread).length,
    derivativeColumns: index.derivatives,
    runs: facts,
    runsById,
    runPosition,
    variants,
    fdGroups,
    fdHollow:
      hollowSignatures.size > 0
        ? {
            modal: [...new Set(modalSignature.values())].map(fdSignatureName).join('; '),
            others: [...hollowSignatures].map(fdSignatureName),
          }
        : null,
    findings: { groups: findingGroups, total: findingsTotal },
    sparkClip: sparkClipOf(liveRuns),
    excluded: { rows: exclusions.length, runs: excludedRuns },
    lens: {
      lens,
      mode: lensMode,
      runs: lensRuns,
      ofRuns: liveRuns.length,
      bold: oneEachAcquisition(lensRuns.filter((item) => item.run.suffix === 'bold')),
      ofBold: oneEachAcquisition(liveRuns.filter((item) => item.run.suffix === 'bold')).length,
      participants: new Set(lensRuns.map((item) => item.run.subject)).size,
      tasks: lensTasks,
    },
    censorOffers,
    summary: { segments: buildSummarySegments(claimsInput), hasFd: claimsInput.hasFd },
    status: {
      bidsVersion: index.bids_version,
      datasetVersion: index.dataset_version,
      participants: readDrafts.length,
      findings: findingsTotal,
      excludedRuns,
      errors: errorItems.length,
      warnings:
        contentItems.length +
        noteItems.filter((item) => item.tag === 'validator').length,
      validatorErrors: errorItems.filter((item) => item.tag === 'validator').length,
      validatorWarnings: [...contentItems, ...noteItems].filter((item) => item.tag === 'validator')
        .length,
      filesRead: progress ? progress.files_done : index.files_read,
      filesTotal: progress ? progress.files_total : index.total_file_count,
      sizeBytes: index.total_size_bytes,
      soFar: partial,
    },
    fdThreshold,
    index,
  };
}

/** MRIQC computes Power's FD too, so the definition holds for both sources (rule 5). */
function fdSource(run: BidsRunRecord): string | null {
  if (run.fd) return `FD (${run.fd.definition}) · ${run.fd.source}`;
  return run.iqms ? `FD (Power) · ${run.iqms.source}` : null;
}

/** The source of a set of runs; a mixed set says so instead of naming one. */
function sharedSource(runs: readonly BidsRunRecord[]): string | null {
  const sources = [...new Set(runs.map(fdSource).filter((text): text is string => text !== null))];
  return sources.length ? sources.join('; ') : null;
}

/** Rule 4 where runs of different acquisitions are counted together. */
function fdPoolingNote(items: readonly BidsRunFacts[]): string {
  const groups = [...new Set(items.map(fdGroupKey))];
  return groups.length > 1
    ? `Counted across ${groups.map(fdGroupName).join(' and ')}; FD is not directly comparable across them.`
    : '';
}

// ---------------------------------------------------------------------------
// Summary sentence
// ---------------------------------------------------------------------------

interface ClaimsInput {
  index: BidsBrowserIndex;
  partial: boolean;
  streaming: boolean;
  read: number;
  expected: number;
  byGroup: Array<{ group: string; count: number }>;
  ages: number[];
  sessions: Array<string | null>;
  sessionsOrdered: boolean;
  absenceKnown: boolean;
  noLocalData: number;
  fdGroupCount: number;
  seriesCount: number;
  subjectSessions: Map<string, Set<string | null>>;
  sessionName: SessionName;
  /** New since the last scan, with images here. */
  newSubjects: string[];
  readSubjects: string[];
  variants: BidsVariantSummary[];
  errors: BidsFindingItem[];
  contentRuns: number;
  participantsOverFd: number;
  hasFd: boolean;
  tsnrOutliers: number;
  fdmissingForNew: boolean;
}

function buildSummarySegments(input: ClaimsInput): BidsSummarySegment[] {
  const { index, partial, read, expected, sessions } = input;
  const segments: BidsSummarySegment[] = [];
  const text = (value: string) => segments.push({ kind: 'text', text: value });
  const claim = (
    id: string,
    label: string,
    predicate: BidsPredicate,
    tone: 'neutral' | 'error' | 'warning' = 'neutral',
    lensLabel = label,
  ) => segments.push({ kind: 'claim', id, text: label, tone, lens: lensOf(id, lensLabel, predicate) });

  if (index.name) segments.push({ kind: 'head', text: `${index.name.replace(/[.\s]+$/, '')}.` });
  text(' ');
  const countedSessions = sessions.filter((session) => session !== null).length;

  if (partial) {
    text(input.streaming ? 'Reading… ' : 'Scan paused at ');
    claim(
      'all',
      `${read} of ${expected} ${plural(expected, 'participant')}`,
      { op: 'all' },
      'neutral',
      'All participants',
    );
    const scope: string[] = [];
    if (countedSessions > 0) scope.push(`${countedSessions} ${plural(countedSessions, 'session')}`);
    if (input.seriesCount > 0) scope.push(`${input.seriesCount} series`);
    text(` so far${scope.length ? `, ${scope.join(', ')}` : ''}. `);
  } else {
    claim(
      'all',
      `${read} ${plural(read, 'participant')}`,
      { op: 'all' },
      'neutral',
      'All participants',
    );
    const facts: string[] = [];
    if (input.byGroup.length) {
      facts.push(input.byGroup.map((entry) => `${entry.count} ${entry.group}`).join(', '));
    }
    if (input.ages.length) {
      const min = input.ages[0];
      const max = input.ages[input.ages.length - 1];
      facts.push(`age ${min}–${max}, median ${median(input.ages)}`);
    }
    if (facts.length) text(` (${facts.join('; ')})`);
    const scanned: string[] = [];
    if (countedSessions > 0) scanned.push(`in ${countedSessions} ${plural(countedSessions, 'session')}`);
    if (index.scanner) scanned.push(`on a ${index.scanner}`);
    text(scanned.length ? ` scanned ${scanned.join(' ')}. ` : '. ');
    if (input.noLocalData > 0) {
      const n = input.noLocalData;
      text(`${n} more ${plural(n, 'is', 'are')} listed in participants.tsv with no images here. `);
    }
  }
  if (!input.absenceKnown) {
    text('The remote listing is incomplete, so nothing here says a file is missing. ');
  }

  const lead = partial ? 'So far: ' : '';
  const sentences: Array<() => void> = [];

  const firstNamed = sessions.find((session) => session !== null);
  sessions.forEach((session) => {
    if (session === null || (input.sessionsOrdered && session === firstNamed) || !input.absenceKnown) {
      return;
    }
    const lacking = input.readSubjects.filter(
      (subject) => !input.subjectSessions.get(subject)?.has(session),
    ).length;
    if (lacking === 0) return;
    const name = input.sessionName(session);
    sentences.push(() => {
      claim(
        `no-session:${session}`,
        `${lacking} ${lacking === 1 ? 'has' : 'have'} no ${name}`,
        { op: 'noSession', id: session },
        'neutral',
        `No ${name}`,
      );
      text('. ');
    });
  });

  const largest = input.variants[0];
  if (largest) {
    sentences.push(() => {
      claim(
        `variant:${largest.key}`,
        largest.protocolWide
          ? `${largest.subjectSessions} ${largest.sessionsLabel} used a different protocol`
          : `${largest.runIds.length} ${plural(largest.runIds.length, 'run')} in ${largest.participants} ${plural(largest.participants, 'participant')} ${largest.runIds.length === 1 ? 'differs' : 'differ'} from the series modal`,
        { op: 'variant', key: largest.key },
        'neutral',
        largest.name,
      );
      const others = largest.protocolWide ? 0 : input.variants.length - 1;
      text(others > 0 ? `, and ${others} other acquisition ${plural(others, 'variant')}. ` : '. ');
    });
  }

  const nErrors = input.errors.length;
  const nContent = input.contentRuns;
  if (nErrors > 0 || nContent > 0) {
    sentences.push(() => {
      if (nErrors > 0) {
        const perFile = input.errors.every((item) => item.tag === 'validator' && item.file);
        const nFiles = new Set(input.errors.map((item) => item.file)).size;
        // An error on a file that is not a run still leads somewhere: its participant.
        const people = [
          ...new Set(
            input.errors
              .filter((item) => item.runIds.length === 0 && item.subject)
              .map((item) => item.subject as string),
          ),
        ];
        const severity: BidsPredicate = { op: 'severity', severity: 'error' };
        claim(
          'errors',
          perFile
            ? `${nFiles} ${plural(nFiles, 'file fails', 'files fail')} validation`
            : `${nErrors} ${plural(nErrors, 'error')}`,
          people.length
            ? { op: 'or', terms: [severity, { op: 'subjects', ids: people }] }
            : severity,
          'error',
          'Errors',
        );
      }
      if (nErrors > 0 && nContent > 0) text(' and ');
      if (nContent > 0) {
        claim(
          'content',
          `${nContent} ${plural(nContent, 'run has', 'runs have')} content problems`,
          { op: 'severity', severity: 'content' },
          'warning',
          'Content problems',
        );
      }
      text('. ');
    });
  }

  if (input.hasFd) {
    const n = input.participantsOverFd;
    sentences.push(() => {
      claim(
        'fd',
        `${n} ${plural(n, 'participant has', 'participants have')} runs over mean FD`,
        { op: 'fdOver', mm: null },
        'neutral',
        'Runs over mean FD',
      );
      text(' ');
      segments.push({ kind: 'threshold' });
      text(
        input.fdGroupCount > 1
          ? ` (${input.fdGroupCount} acquisition groups; FD is not directly comparable across them). `
          : '. ',
      );
    });
  }

  if (input.tsnrOutliers > 0) {
    const n = input.tsnrOutliers;
    sentences.push(() => {
      claim(
        'tsnr',
        `${n} ${plural(n, 'run is a tSNR outlier', 'runs are tSNR outliers')} for ${plural(n, 'its series', 'their series')}`,
        { op: 'tsnrOutlier' },
        'neutral',
        'tSNR outliers',
      );
      text('. ');
    });
  }

  const nNew = input.newSubjects.length;
  const since = index.previous_scan_at ? formatScanDate(index.previous_scan_at) : null;
  if (nNew > 0 && since) {
    sentences.push(() => {
      claim(
        'new',
        `Since ${since}: ${nNew} new ${plural(nNew, 'participant')}`,
        { op: 'new' },
        'neutral',
        'New since last scan',
      );
      text(input.fdmissingForNew ? ', not yet processed by fMRIPrep. ' : '. ');
    });
  }

  if (sentences.length) text(lead);
  for (const sentence of sentences) sentence();
  if (partial) {
    text(
      input.streaming
        ? 'Counts update as files are read; nothing is final until the scan completes.'
        : 'Nothing is final until the scan completes.',
    );
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Exports built from the model
// ---------------------------------------------------------------------------

/** The paragraph "Copy summary" puts on the clipboard, ready for a data descriptor. */
export function buildDataDescriptor(model: BidsModel): string {
  const index = model.index;
  if (!index) return '';
  const { participants, sessions, fdThreshold } = model;
  const sentences: string[] = [];
  const groupText = participants.byGroup.map((entry) => `${entry.count} ${entry.group}`).join(', ');
  const age = participants.age
    ? `age ${participants.age.min}–${participants.age.max}, median ${participants.age.median}`
    : '';
  const facts = [groupText, age].filter(Boolean).join('; ');
  const sessionCount = sessions.filter((session) => session !== null).length;
  const scanned = [
    sessionCount ? `in ${sessionCount} ${plural(sessionCount, 'session')}` : '',
    index.scanner ? `on a ${index.scanner}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const counted = model.status.soFar ? participants.expected : participants.read;
  sentences.push(
    `The dataset comprises ${model.status.soFar ? `${participants.read} of ${participants.expected}` : participants.read} ${plural(counted, 'participant')}${facts ? ` (${facts})` : ''}${scanned ? `, scanned ${scanned}` : ''}.`,
  );
  const live = model.runs.filter((item) => !item.excluded);
  const series = new Set(live.map((item) => item.run.series)).size;
  // Two denominators, each named: every image file, and each BOLD run once
  // however many echoes it has.
  const functional = oneEachAcquisition(live).filter((item) => item.run.suffix === 'bold');
  const echoes = live.filter((item) => item.run.suffix === 'bold').length > functional.length;
  sentences.push(
    `It holds ${live.length} image ${plural(live.length, 'file')} across ${series} series, including ${functional.length} functional ${plural(functional.length, 'run')}${echoes ? ' (echoes of a run counted once)' : ''}, organised to BIDS ${index.bids_version}${index.dataset_version ? ` (dataset version ${index.dataset_version})` : ''}.`,
  );
  if (model.variants.length) {
    const named = model.variants
      .map((variant) => `${variant.name.toLowerCase()} (${variant.runIds.length} ${plural(variant.runIds.length, 'run')})`)
      .join('; ');
    sentences.push(`Effective acquisition metadata differed from the modal protocol in: ${named}.`);
  }
  const measured = functional.filter((item) => item.meanFd !== null);
  const functionalRuns = (n: number) => `${n} functional ${plural(n, 'run')}`;
  if (measured.length) {
    const sources = sharedSource(measured.map((item) => item.run));
    const over = (items: readonly BidsRunFacts[]) =>
      items.filter((item) => item.overThreshold).length;
    const groups = [...new Set(measured.map(fdGroupKey))];
    const counts =
      groups.length > 1
        ? `${groups
            .map((key) => {
              const own = measured.filter((item) => fdGroupKey(item) === key);
              return `${over(own)} of ${functionalRuns(own.length)} at ${fdGroupName(key)}`;
            })
            .join(', ')} exceeded`
        : `${over(measured)} of ${functionalRuns(measured.length)} with FD exceeded`;
    const citation = fdThreshold === DEFAULT_FD_THRESHOLD_MM ? ' (Parkes et al. 2018, stringent)' : '';
    const caveat =
      groups.length > 1 ? ' FD is not directly comparable across these acquisition groups.' : '';
    sentences.push(
      `Head motion was summarised per run as mean framewise displacement (${sources}); ${counts} ${fdThreshold} mm${citation}.${caveat}`,
    );
  }
  if (model.excluded.runs > 0) {
    sentences.push(
      `${model.excluded.runs} ${plural(model.excluded.runs, 'run was', 'runs were')} excluded and ${model.excluded.runs === 1 ? 'does' : 'do'} not count toward session means.`,
    );
  }
  if (index.license) sentences.push(`License: ${index.license}.`);
  if (index.doi) sentences.push(`DOI: ${index.doi}.`);
  if (model.status.soFar) sentences.push('The scan had not completed; all counts are so far.');
  return sentences.join(' ');
}

/** CuBIDS-style table of acquisition groups, tab separated. */
export function buildCubidsTable(model: BidsModel): string {
  const index = model.index;
  const header = ['series', 'group', 'name', 'difference', 'participants', 'runs', 'note'];
  const lines = [header.join('\t')];
  if (!index) return lines[0];
  const clean = (value: string) => value.replace(/[\t\n]+/g, ' ');
  const live = model.runs.filter((item) => !item.excluded);
  const series = [...new Set(live.map((item) => item.run.series))].sort(naturalCompare);
  for (const name of series) {
    const own = live.filter((item) => item.run.series === name);
    const modal = own.filter((item) => item.variantKey === null);
    if (modal.length) {
      lines.push(
        [
          name,
          'modal',
          'Modal',
          '',
          new Set(modal.map((item) => item.run.subject)).size,
          modal.length,
          '',
        ].join('\t'),
      );
    }
    for (const group of index.variants.filter((variant) => variant.series === name)) {
      const members = own.filter((item) => group.run_ids.includes(item.run.id));
      if (members.length === 0) continue;
      lines.push(
        [
          name,
          group.id,
          clean(group.name),
          clean(group.diff),
          new Set(members.map((item) => item.run.subject)).size,
          members.length,
          clean(group.note),
        ].join('\t'),
      );
    }
  }
  return lines.join('\n');
}

/** What `buildLensExport` copies: every image in the lens, not only the dock's BOLD runs. */
export function lensExportLabel(model: BidsModel): string {
  const { runs, bold } = model.lens;
  return `Lens list: ${runs.length} ${plural(runs.length, 'file')}, ${bold.length} BOLD ${plural(bold.length, 'run')}`;
}

/** The runs a lens holds as a participant and run list, for fMRIPrep or FitLins. */
export function buildLensExport(model: BidsModel): string {
  const clean = (value: string) => value.replace(/[\t\n]+/g, ' ');
  const lines = [['participant_id', 'session_id', 'run_id', 'path'].join('\t')];
  for (const { run } of model.lens.runs) {
    lines.push(
      [
        subjectLabel(run.subject),
        run.session ? sessionLabel(run.session) : 'n/a',
        clean(run.id),
        clean(run.rel_path),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}

/** The runs an exclusion entity covers: a run id, `sub-XX_ses-YY` or `sub-XX`. */
export function entityRunIds(model: BidsModel, entity: string): string[] {
  return model.runs
    .filter(({ run }) => run.id === entity || run.id.startsWith(`${entity}_`))
    .map(({ run }) => run.id);
}

/** Findings › Excluded › Review: the excluded runs of one entity, as a lens. */
export function exclusionLens(model: BidsModel, entity: string): BidsLens {
  return lensOf(`excluded:${entity}`, entity, {
    op: 'and',
    terms: [{ op: 'excluded' }, { op: 'runs', ids: entityRunIds(model, entity) }],
  });
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

export type BidsMoveDirection = 'down' | 'up' | 'left' | 'right';

/** The run a J/K/H/L press lands on: the next present cell in that direction. */
export function nextRunId(
  model: BidsModel,
  runId: string | null,
  direction: BidsMoveDirection,
): string | null {
  const nCols = model.columns.length;
  const nRows = model.rows.length;
  if (nCols === 0 || nRows === 0) return null;
  const at = (row: number, col: number) => model.cells[row * nCols + col].runId;
  const position = runId ? model.runPosition.get(runId) : undefined;
  if (!position) {
    for (let i = 0; i < model.cells.length; i++) {
      if (model.cells[i].runId) return model.cells[i].runId;
    }
    return null;
  }
  const { row, col } = position;
  if (direction === 'down' || direction === 'up') {
    const step = direction === 'down' ? 1 : -1;
    for (let r = row + step; r >= 0 && r < nRows; r += step) {
      const id = at(r, col);
      if (id) return id;
    }
  } else {
    const step = direction === 'right' ? 1 : -1;
    for (let c = col + step; c >= 0 && c < nCols; c += step) {
      const id = at(row, c);
      if (id) return id;
    }
  }
  return runId;
}
