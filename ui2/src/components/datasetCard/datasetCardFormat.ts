/** Pure text helpers for the dataset, collection and sidecar cards. */
import type {
  DatasetAnalysis,
  DatasetContainer,
  DatasetContents,
  DatasetImageKind,
  DatasetMarker,
  DatasetPipelineRef,
  SidecarEntry,
  SidecarHeader,
  SidecarLevel,
} from '@brainflow/api';
import type { FileTreeNode } from '@/types/filesystem';

export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

export function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : '';
}

/** `path` below `base` (no leading slash), or null when it is not inside it. */
export function relativeTo(base: string, path: string): string | null {
  const root = base.replace(/[\\/]+$/, '');
  if (path === root) return '';
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/**
 * A path as the user knows it. A folder of a remote mount reads
 * "user@host:/absolute/remote/path", the remote root said once: the mount's
 * own label already ends with that root, so it is not put in front. A local
 * path is shown as it is.
 */
export function displayPath(path: string, entries: FileTreeNode[]): string {
  const mount = entries
    .filter(
      (entry) =>
        entry.mountSource?.kind === 'remote' &&
        (path === entry.path || path.startsWith(`${entry.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  const origin = mount?.mountSource;
  if (!mount || !origin?.remotePath) return path;
  const remoteRoot = origin.remotePath.replace(/\/+$/, '');
  const remote = `${remoteRoot}${path.slice(mount.path.length)}` || '/';
  let host: string | null = null;
  if (origin.host) {
    // An IPv6 address has colons of its own: bracketed, as in a URL, so the
    // one before the path (or the port) is not taken for part of it.
    const address =
      origin.host.includes(':') && !origin.host.startsWith('[')
        ? `[${origin.host}]`
        : origin.host;
    host = origin.user ? `${origin.user}@${address}` : address;
    if (origin.port && origin.port !== 22) host += `:${origin.port}`;
  } else if (origin.label) {
    // Only a label is known: it is "host:/remote/root", so drop that root.
    const label = origin.label;
    for (const root of [origin.remotePath, remoteRoot]) {
      if (root && label.endsWith(`:${root}`)) {
        host = label.slice(0, -(root.length + 1));
        break;
      }
    }
    host ??= label;
  }
  return host ? `${host}:${remote}` : remote;
}

/** A row's path for the hover summary: the browse root's name, then the way down. */
export function pathFromRoot(rootPath: string, path: string): string {
  const relative = relativeTo(rootPath, path);
  const rootName = baseName(rootPath);
  if (relative === null) return path;
  return relative ? `${rootName}/${relative}` : rootName;
}

/** BIDS `DatasetType` in words; an unknown value is shown as written. */
export function datasetTypeLabel(datasetType: string | null | undefined): string | null {
  const value = datasetType?.trim();
  if (!value) return null;
  switch (value.toLowerCase()) {
    case 'raw':
      return 'Raw dataset';
    case 'derivative':
      return 'Derivative';
    case 'study':
      return 'Study';
    default:
      return value;
  }
}

export function pipelineLabel(ref: DatasetPipelineRef | null | undefined): string | null {
  if (!ref?.name) return null;
  return ref.version ? `${ref.name} ${ref.version}` : ref.name;
}

export function containerLabel(container: DatasetContainer | null | undefined): string | null {
  if (!container) return null;
  if (container.uri) return container.uri;
  const parts = [container.type, container.tag].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(':') : null;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "35", or "35+" when the count is only a floor. */
export function countText(count: number, floor: boolean): string {
  return floor ? `${count}+` : String(count);
}

/** "35 subjects", or "at least 35 subjects": what a screen reader hears. */
export function countSpoken(count: number, floor: boolean, one: string, many?: string): string {
  const unit = plural(count, one, many);
  return floor ? `at least ${count} ${unit}` : `${count} ${unit}`;
}

/**
 * A folder's analyses in words, for the hover summary: "4 analyses", or
 * "at least 24 analyses" when the probe stopped counting. Never "24+" beside
 * a card that counts more.
 */
export function analysesLabel(
  marker: Pick<DatasetMarker, 'analysisCount' | 'analysisCountTruncated'>,
) {
  return countSpoken(
    marker.analysisCount ?? 0,
    marker.analysisCountTruncated,
    'analysis',
    'analyses',
  );
}

export interface CountPhrase {
  key: string;
  /** "35 subjects", "105+ images". */
  text: string;
  /** "at least 105 images": what a screen reader hears. */
  spoken: string;
}

/**
 * The one line of totals of "What is in the folder": each number is said
 * here and nowhere else. A kind of thing that is absent is left out.
 */
export function contentTotals(contents: DatasetContents): CountPhrase[] {
  const floor = contents.truncated;
  const phrase = (key: string, count: number, one: string, many?: string): CountPhrase => ({
    key,
    text: `${countText(count, floor)} ${plural(count, one, many)}`,
    spoken: countSpoken(count, floor, one, many),
  });
  const totals: CountPhrase[] = [];
  if (contents.subjectCount > 0) totals.push(phrase('subjects', contents.subjectCount, 'subject'));
  if (contents.sessionCount > 0) totals.push(phrase('sessions', contents.sessionCount, 'session'));
  if (contents.imageKindCount > 0) {
    totals.push(phrase('kinds', contents.imageKindCount, 'image kind'));
  }
  totals.push(phrase('images', contents.imageCount, 'image'));
  if (contents.groupImageCount > 0) {
    totals.push(phrase('group', contents.groupImageCount, 'group-level image'));
  } else if (contents.hasGroupLevel) {
    totals.push({ key: 'group', text: 'a group folder', spoken: 'a group folder' });
  }
  return totals;
}

export interface KindCount {
  /** "35 of 35", "33 of 35", or the plain count ("70", "35+"). */
  text: string;
  spoken: string;
  /** Subjects without an image of this kind; 0 when complete or unknown. */
  missing: number;
}

/**
 * How many images a kind has, against the number of subjects where that is a
 * fair comparison: an exact walk, a kind with one image per subject (no
 * session or run in its path) and no more images than subjects. The subjects
 * are the subject folders of the level the kind's images are in
 * (`subjectFolders`), never the folder's total: that also counts stray
 * `sub-*` folders elsewhere and `sub-` labels in group-level file names, and
 * would report images as missing that nothing says should exist. Otherwise
 * the count alone, since "of 35" would claim something the listing does not
 * show.
 */
export function kindCount(kind: DatasetImageKind, contents: DatasetContents): KindCount {
  const subjects = kind.subjectFolders ?? 0;
  const perSubject =
    !contents.truncated &&
    subjects > 0 &&
    contents.sessionCount === 0 &&
    kind.count <= subjects &&
    !/(^|[/_])(ses|run)-\*/.test(kind.path);
  if (!perSubject) {
    return {
      text: countText(kind.count, contents.truncated),
      spoken: countSpoken(kind.count, contents.truncated, 'image'),
      missing: 0,
    };
  }
  const missing = subjects - kind.count;
  return {
    text: `${kind.count} of ${subjects}`,
    spoken:
      missing === 0
        ? `${kind.count} ${plural(kind.count, 'image')}, one for each of ${subjects} ${plural(subjects, 'subject')}`
        : `${kind.count} ${plural(kind.count, 'image')} for ${subjects} ${plural(subjects, 'subject')}, ${missing} missing`,
    missing,
  };
}

// ── the analyses table ────────────────────────────────────────────────────

/**
 * What the folder's marker says about analyses, before the card has counted:
 * `true` when it found some, `false` when it looked and found none, `null`
 * when that is not known (no marker yet, or a marker that did not look: on a
 * remote mount only a folder that announces `derivatives` is looked into).
 */
export function collectionHint(
  marker: Pick<DatasetMarker, 'analysisCount'> | undefined,
  remote: boolean,
): boolean | null {
  if (!marker) return null;
  if (marker.analysisCount !== null) return marker.analysisCount > 0;
  return remote ? null : false;
}

/**
 * Whether a card is laid out as a collection (the analyses table first, the
 * wider card). Once counted, the card's own analyses decide. Before that the
 * marker does, so a folder of analyses has its layout from the first paint
 * instead of changing shape when the count arrives.
 */
export function showsAsCollection(
  analysisCount: number,
  counted: boolean,
  hint: boolean | null,
): boolean {
  return analysisCount > 0 || (!counted && hint === true);
}

/**
 * The order the analyses table lists its rows in before the user sorts:
 * rows already listed keep their places, and rows that arrive later (found
 * by the count, with no description) go after them. A click aimed at a row
 * therefore never lands on another one because the list grew above it.
 * Returns `order` itself when nothing changed.
 */
export function stableAnalysisOrder(
  order: readonly string[],
  analyses: readonly Pick<DatasetAnalysis, 'path'>[],
): readonly string[] {
  const present = new Set(analyses.map((analysis) => analysis.path));
  const listed = new Set(order);
  const next = [
    ...order.filter((path) => present.has(path)),
    ...analyses.map((analysis) => analysis.path).filter((path) => !listed.has(path)),
  ];
  const same = next.length === order.length && next.every((path, index) => path === order[index]);
  return same ? order : next;
}

/** Separators a shared title prefix may end at ("PCMRI — "). */
const PREFIX_SEPARATORS = [' — ', ' – ', ' - ', ' | ', ' · ', ' / ', ': '];

/**
 * The leading part every title shares, when it ends at a separator:
 * "PCMRI — " for "PCMRI — Encoding" and "PCMRI — Recall". Empty when there
 * are fewer than two titles, when they share nothing up to a separator, or
 * when stripping it would leave a title empty.
 */
export function sharedTitlePrefix(titles: readonly string[]): string {
  if (titles.length < 2) return '';
  let common = titles[0];
  for (const title of titles) {
    let end = 0;
    while (end < common.length && end < title.length && common[end] === title[end]) end += 1;
    common = common.slice(0, end);
    if (!common) return '';
  }
  let cut = 0;
  for (const separator of PREFIX_SEPARATORS) {
    const at = common.lastIndexOf(separator);
    if (at > 0) cut = Math.max(cut, at + separator.length);
  }
  if (cut === 0) return '';
  const prefix = common.slice(0, cut);
  return titles.every((title) => title.slice(cut).trim().length > 0) ? prefix : '';
}

/** A name without case or `_`, `-` and space differences, for comparing. */
function plainName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * What the "Generated by" cell of an analysis says, or null for nothing: a
 * pipeline named like its folder ("glm_recog" in `glm_recog/`) says nothing
 * new, so only its version is left, if it declares one.
 */
export function analysisGeneratedBy(
  analysis: Pick<DatasetAnalysis, 'generatedBy' | 'folderName'>,
): { name: string | null; version: string | null } | null {
  const ref = analysis.generatedBy;
  if (!ref?.name) return null;
  const repeats = plainName(ref.name) === plainName(analysis.folderName);
  if (repeats && !ref.version) return null;
  return { name: repeats ? null : ref.name, version: ref.version ?? null };
}

/**
 * The subjects cell of an analysis, on one line: "35", "35 + group",
 * "at least 12", "group only", or "none".
 */
export function analysisSubjects(
  analysis: Pick<DatasetAnalysis, 'subjectCount' | 'subjectCountTruncated' | 'hasGroupLevel'>,
): { text: string; spoken: string } {
  const { subjectCount: count, subjectCountTruncated: floor, hasGroupLevel: group } = analysis;
  if (count === 0 && !floor) {
    return group
      ? { text: 'group only', spoken: 'Group level only, no subject folders' }
      : { text: 'none', spoken: 'No subject folders' };
  }
  const number = floor ? `at least ${count}` : String(count);
  return {
    text: group ? `${number} + group` : number,
    spoken: `${countSpoken(count, floor, 'subject')}${group ? ' and a group level' : ''}`,
  };
}

export interface AnalysisRowModel {
  analysis: DatasetAnalysis;
  /** The description's `Name`, or the folder name when it has none. */
  fullTitle: string;
  /** The title with the shared prefix left out. */
  title: string;
  /** The title is the description's own, not the folder name standing in. */
  named: boolean;
  generatedBy: ReturnType<typeof analysisGeneratedBy>;
}

export interface AnalysisTableModel {
  rows: AnalysisRowModel[];
  /** Shown once above the table and left out of every titled row. */
  prefix: string;
  showFolder: boolean;
  showGeneratedBy: boolean;
  showDate: boolean;
}

/** The rows and columns of the analyses table, before filtering and sorting. */
export function analysisTable(analyses: readonly DatasetAnalysis[]): AnalysisTableModel {
  const declared = analyses
    .map((analysis) => analysis.title?.trim() ?? '')
    .filter((title) => title.length > 0);
  const prefix = sharedTitlePrefix(declared);
  const rows = analyses.map((analysis): AnalysisRowModel => {
    const declaredTitle = analysis.title?.trim() ?? '';
    const named = declaredTitle.length > 0;
    return {
      analysis,
      fullTitle: named ? declaredTitle : analysis.folderName,
      title: named ? declaredTitle.slice(prefix.length).trim() : analysis.folderName,
      named,
      generatedBy: analysisGeneratedBy(analysis),
    };
  });
  return {
    rows,
    prefix,
    showFolder: rows.some((row) => row.named && row.fullTitle !== row.analysis.folderName),
    showGeneratedBy: rows.some((row) => row.generatedBy !== null),
    showDate: rows.some((row) => Boolean(row.analysis.date)),
  };
}

/** Rows whose title or folder name contains `query`, without regard to case. */
export function filterAnalysisRows(
  rows: readonly AnalysisRowModel[],
  query: string,
): AnalysisRowModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.fullTitle.toLowerCase().includes(needle) ||
      row.analysis.folderName.toLowerCase().includes(needle),
  );
}

export type AnalysisSortKey = 'name' | 'subjects' | 'date';
export interface AnalysisSort {
  key: AnalysisSortKey;
  descending: boolean;
}

const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Rows in the order asked for; `null` keeps the order the folder gave. Names
 * sort as shown (prefix left out), dates as written (so only same-format
 * dates order sensibly), and a row without a date goes last either way.
 */
export function sortAnalysisRows(
  rows: readonly AnalysisRowModel[],
  sort: AnalysisSort | null,
): AnalysisRowModel[] {
  if (!sort) return [...rows];
  const direction = sort.descending ? -1 : 1;
  const byName = (a: AnalysisRowModel, b: AnalysisRowModel) =>
    NAME_ORDER.compare(a.title, b.title) ||
    NAME_ORDER.compare(a.analysis.folderName, b.analysis.folderName);
  return [...rows].sort((a, b) => {
    if (sort.key === 'subjects') {
      return direction * (a.analysis.subjectCount - b.analysis.subjectCount) || byName(a, b);
    }
    if (sort.key === 'date') {
      const left = a.analysis.date ?? '';
      const right = b.analysis.date ?? '';
      if (!left || !right) return left ? -1 : right ? 1 : byName(a, b);
      return direction * NAME_ORDER.compare(left, right) || byName(a, b);
    }
    return direction * byName(a, b);
  });
}

// ── sidecar ───────────────────────────────────────────────────────────────

export const SIDECAR_LEVEL_LABEL: Record<SidecarLevel, string> = {
  file: 'This file',
  directory: 'Folder',
  session: 'Session',
  subject: 'Subject',
  dataset: 'Dataset',
};

/** Border form of a level tag: the nearer the source, the more solid the line. */
export const SIDECAR_LEVEL_BORDER: Record<SidecarLevel, 'solid' | 'dashed' | 'dotted'> = {
  file: 'solid',
  directory: 'dashed',
  session: 'dashed',
  subject: 'dashed',
  dataset: 'dotted',
};

export interface SidecarValueDisplay {
  text: string;
  mono: boolean;
}

const PATH_LIKE = /[\\/]|^[A-Za-z][\w+.-]*:/;

/**
 * A sidecar value for display. The backend sends compact JSON: a plain string
 * loses its quotes and reads as text; numbers, paths, identifiers, arrays and
 * objects stay mono. A value cut short by the backend cannot be parsed and is
 * shown as it came.
 */
export function sidecarValueDisplay(entry: Pick<SidecarEntry, 'value' | 'valueTruncated'>) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.value);
  } catch {
    return { text: entry.value, mono: true } satisfies SidecarValueDisplay;
  }
  if (typeof parsed === 'string') {
    const identifier = !/\s/.test(parsed) && /[_\d]/.test(parsed) && parsed.length > 12;
    return { text: parsed, mono: PATH_LIKE.test(parsed) || identifier };
  }
  if (typeof parsed === 'boolean' || parsed === null) return { text: String(parsed), mono: false };
  return { text: entry.value, mono: true };
}

function trimNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** "97 × 115 × 97 · 2.00 mm" (or each voxel size when they differ). */
export function gridLabel(header: SidecarHeader): string | null {
  const dim = header.dim.slice(0, 3).filter((n) => n > 0);
  if (dim.length === 0) return null;
  const sizes = header.voxelSizes.slice(0, dim.length).filter((n) => Number.isFinite(n) && n > 0);
  const shape = dim.join(' × ');
  if (sizes.length !== dim.length) return shape;
  const same = sizes.every((size) => Math.abs(size - sizes[0]) < 1e-4);
  const voxel = same ? trimNumber(sizes[0], 2) : sizes.map((s) => trimNumber(s, 2)).join(' × ');
  return `${shape} · ${voxel} mm`;
}

/** "240 volumes · TR 1.5 s" for a series; null for a single volume. */
export function seriesLabel(header: SidecarHeader): string | null {
  const volumes = header.nVolumes ?? 0;
  if (volumes <= 1) return null;
  const tr =
    header.trSeconds !== null && header.trSeconds > 0
      ? ` · TR ${Number(header.trSeconds.toFixed(3))} s`
      : '';
  return `${volumes} volumes${tr}`;
}

/** The merged sidecar entries as one JSON object, for "Show raw JSON". */
export function sidecarEntriesJson(entries: readonly SidecarEntry[]): string {
  const lines = entries.map((entry) => {
    let value = entry.value;
    try {
      value = JSON.stringify(JSON.parse(entry.value));
    } catch {
      // Cut short by the backend: keep it readable as a string.
      value = JSON.stringify(entry.value);
    }
    return `  ${JSON.stringify(entry.key)}: ${value}`;
  });
  return lines.length > 0 ? `{\n${lines.join(',\n')}\n}` : '{}';
}

/** Indent a description file's text when it is whole, valid JSON; else leave it. */
export function prettyJson(raw: string, truncated: boolean): string {
  if (truncated) return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** "a", "a and b", "a, b and c". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The files a card was read from, by name: "README.md and
 * dataset_description.json". A name read from several folders (one
 * description per analysis of a collection) is counted, not repeated:
 * "README.md and 3 dataset_description.json files".
 */
export function sourcesLabel(sourcePaths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const path of sourcePaths) {
    const name = baseName(path);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return joinNames(
    [...counts].map(([name, count]) => (count > 1 ? `${count} ${name} files` : name)),
  );
}

/** The same files, one per line and relative to the card's folder where they are inside it. */
export function sourcesDetail(folder: string, sourcePaths: readonly string[]): string {
  return sourcePaths.map((path) => relativeTo(folder, path) || path).join('\n');
}

/** A card's title: the description's `Name`, else the folder's name. */
export function datasetCardTitle(card: {
  description: { name: string | null } | null;
  folderName: string;
}): string {
  return card.description?.name?.trim() || card.folderName;
}

/** Keep the entries that are present (a fact whose value is absent has no row). */
export function present<T>(items: Array<T | null | false | undefined>): T[] {
  return items.filter((item): item is T => Boolean(item));
}
