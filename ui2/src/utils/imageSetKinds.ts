/**
 * Groups the images of a folder by "kind" (tfce, t_g, fwer, …) from their
 * file names, for the kind chips in the open-image-set dialog.
 *
 * The rule prefers no grouping to a doubtful one
 * (docs/plans/sidecar-info-and-set-subsets.md, sections 5.2 and 5.3):
 *
 * 1. Names made entirely of BIDS `key-value` parts group by `stat-`, else
 *    `desc-`, else the suffix.
 * 2. Otherwise the endings (one to three trailing `_` parts) must cross the
 *    remaining stems almost completely: every stem has the same endings.
 *    Of several such crossings the one covering the most files wins, then
 *    the one with the most stems (the shortest endings).
 * 3. Names that end in a number (`zstat1`, `spmT_0001`) group by the name
 *    without that number.
 *
 * Every image lands in exactly one group; images that fit none go to
 * "Ungrouped". A group's label is the text found in the names, never a
 * translated statistic.
 */

export interface KindItem {
  path: string;
  name: string;
}

export interface KindGroup {
  /** Stable key, unique within the grouping. */
  key: string;
  /** Text found in the file names, or "Other". */
  label: string;
  paths: string[];
  /** The catch-all for images that fit no kind. */
  other: boolean;
}

export interface KindGrouping {
  source: 'entity' | 'ending' | 'numbered';
  /** Kinds in first-appearance order; "Other" (if any) last. */
  groups: KindGroup[];
  /** Stems crossed with the kinds (contrasts), when the rule found them. */
  stemCount: number | null;
}

const OTHER_KEY = '\u0000other';
/** Not "Other": a folder may have a real ending called `other`. */
const OTHER_LABEL = 'Ungrouped';
const MAX_ENDING_PARTS = 3;
/** Share of images that may fit no kind, and of stem-by-kind cells that may be empty. */
const TOLERANCE = 0.1;
const MAX_OTHER = 5;
/** No chips when one group holds more than this share of the images. */
const DOMINANT_SHARE = 0.9;

const stripExtension = (name: string) => name.replace(/\.nii(\.gz)?$/i, '');
const isNumeric = (text: string) => /^[\d_]+$/.test(text);

function otherLimit(total: number): number {
  return Math.max(1, Math.min(MAX_OTHER, Math.floor(total * TOLERANCE)));
}

interface Bucket {
  label: string;
  paths: string[];
}

function finish(
  source: KindGrouping['source'],
  buckets: Map<string, Bucket>,
  other: string[],
  total: number,
  stemCount: number | null,
): KindGrouping | null {
  if (buckets.size < 2) return null;
  if (other.length > otherLimit(total)) return null;
  const largest = Math.max(...[...buckets.values()].map((bucket) => bucket.paths.length));
  if (largest > total * DOMINANT_SHARE) return null;
  const groups: KindGroup[] = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    paths: bucket.paths,
    other: false,
  }));
  if (other.length) groups.push({ key: OTHER_KEY, label: OTHER_LABEL, paths: other, other: true });
  return { source, groups, stemCount };
}

function add(buckets: Map<string, Bucket>, key: string, label: string, path: string) {
  const bucket = buckets.get(key);
  if (bucket) bucket.paths.push(path);
  else buckets.set(key, { label, paths: [path] });
}

/** `sub-01_task-x_stat-t_statmap` → entities and suffix; null unless every part but the last is `key-value`. */
function parseEntities(stem: string): { entities: Map<string, string>; suffix: string | null } | null {
  const parts = stem.split('_');
  const entities = new Map<string, string>();
  let suffix: string | null = null;
  for (let i = 0; i < parts.length; i += 1) {
    const match = /^([A-Za-z0-9]+)-(.+)$/.exec(parts[i]);
    if (match) entities.set(match[1].toLowerCase(), match[2]);
    else if (i === parts.length - 1 && i > 0 && /^[A-Za-z0-9]+$/.test(parts[i])) suffix = parts[i];
    else return null;
  }
  return entities.size ? { entities, suffix } : null;
}

function groupByEntity(items: KindItem[]): KindGrouping | null {
  const parsed = items.map((item) => parseEntities(stripExtension(item.name)));
  if (parsed.some((entry) => entry === null)) return null;
  type Entry = NonNullable<(typeof parsed)[number]>;
  const stat = (entry: Entry) => entry.entities.get('stat');
  const desc = (entry: Entry) => entry.entities.get('desc');
  const suffix = (entry: Entry) => entry.suffix;
  // Different suffixes (T1w, bold, mask) are different kinds of image, so
  // they outrank `desc-`, which only qualifies images of one suffix.
  const suffixes = new Set(parsed.map((entry) => entry!.suffix?.toLowerCase() ?? ''));
  const pick = suffixes.size > 1 ? [stat, suffix, desc] : [stat, desc, suffix];
  for (const choose of pick) {
    const values = parsed.map((entry) => choose(entry!));
    if (values.some((value) => !value)) continue;
    const buckets = new Map<string, Bucket>();
    values.forEach((value, i) => add(buckets, value!.toLowerCase(), value!, items[i].path));
    const grouping = finish('entity', buckets, [], items.length, null);
    if (grouping) return grouping;
  }
  return null;
}

interface Split {
  item: number;
  /** Lower-cased ending, the comparison key. */
  ending: string;
  /** Ending as written in the file name. */
  label: string;
}

function groupByEnding(items: KindItem[]): KindGrouping | null {
  const original = items.map((item) => stripExtension(item.name).split('_'));
  const lowered = original.map((parts) => parts.map((part) => part.toLowerCase()));

  // Every way of cutting a name into stem + ending, indexed by stem.
  const byStem = new Map<string, Split[]>();
  lowered.forEach((parts, item) => {
    for (let take = 1; take <= MAX_ENDING_PARTS && take < parts.length; take += 1) {
      const cut = parts.length - take;
      const stem = parts.slice(0, cut).join('_');
      const split = {
        item,
        ending: parts.slice(cut).join('_'),
        label: original[item].slice(cut).join('_'),
      };
      const list = byStem.get(stem);
      if (list) list.push(split);
      else byStem.set(stem, [split]);
    }
  });

  // Stems that share exactly the same set of endings form a complete crossing.
  const bySignature = new Map<string, { endings: string[]; stems: string[] }>();
  for (const [stem, splits] of byStem) {
    const endings = [...new Set(splits.map((split) => split.ending))].sort();
    if (endings.length < 2 || endings.every(isNumeric)) continue;
    const signature = endings.join('\u0000');
    const entry = bySignature.get(signature);
    if (entry) entry.stems.push(stem);
    else bySignature.set(signature, { endings, stems: [stem] });
  }
  let best: { endings: string[]; stems: string[] } | null = null;
  for (const entry of bySignature.values()) {
    if (entry.stems.length < 2) continue;
    const cover = entry.stems.length * entry.endings.length;
    const bestCover = best ? best.stems.length * best.endings.length : -1;
    if (cover > bestCover || (cover === bestCover && entry.stems.length > best!.stems.length)) {
      best = entry;
    }
  }
  if (!best) return null;
  const kinds = new Set(best.endings);

  // Assign each image once: complete stems first, then stems that hold at
  // least half of the kinds and never fewer than two (an image missing or
  // extra), longest stem first. One matching ending alone proves nothing.
  const enough = (count: number) => count >= 2 && count * 2 >= kinds.size;
  const assigned = new Map<number, { stem: string; split: Split }>();
  const complete = new Set(best.stems);
  const candidates = [...byStem.entries()]
    .map(([stem, splits]) => ({ stem, splits: splits.filter((split) => kinds.has(split.ending)) }))
    .filter(
      ({ stem, splits }) =>
        complete.has(stem) || enough(new Set(splits.map((split) => split.ending)).size),
    )
    .sort(
      (a, b) =>
        Number(complete.has(b.stem)) - Number(complete.has(a.stem)) ||
        b.stem.length - a.stem.length ||
        a.stem.localeCompare(b.stem),
    );
  for (const { stem, splits } of candidates) {
    const free = splits.filter((split) => !assigned.has(split.item));
    // A partial stem must still hold enough kinds after earlier claims.
    if (!complete.has(stem) && !enough(new Set(free.map((split) => split.ending)).size)) continue;
    for (const split of free) assigned.set(split.item, { stem, split });
  }

  const stems = new Set([...assigned.values()].map((entry) => entry.stem));
  const cells = new Set([...assigned.values()].map((entry) => `${entry.stem}\u0000${entry.split.ending}`));
  if (stems.size < 2) return null;
  const emptyCells = stems.size * kinds.size - cells.size;
  if (emptyCells > stems.size * kinds.size * TOLERANCE) return null;

  const buckets = new Map<string, Bucket>();
  const other: string[] = [];
  items.forEach((item, index) => {
    const entry = assigned.get(index);
    if (entry) add(buckets, entry.split.ending, entry.split.label, item.path);
    else other.push(item.path);
  });
  return finish('ending', buckets, other, items.length, stems.size);
}

function groupByNumberedName(items: KindItem[]): KindGrouping | null {
  const buckets = new Map<string, Bucket>();
  const other: string[] = [];
  for (const item of items) {
    // Only the trailing number goes: `T1_2` is kind `T1`, never `T`.
    const match = /^(.*?)[_\-.]*\d+$/.exec(stripExtension(item.name));
    const label = match?.[1] ?? '';
    if (!label) other.push(item.path);
    else add(buckets, label.toLowerCase(), label, item.path);
  }
  // Numbered names only mean kinds when a name repeats with different numbers.
  if (![...buckets.values()].some((bucket) => bucket.paths.length > 1)) return null;
  return finish('numbered', buckets, other, items.length, null);
}

/** The kind grouping for a folder's images, or null when the names give none worth offering. */
export function groupImagesByKind(items: readonly KindItem[]): KindGrouping | null {
  if (items.length < 4) return null;
  const list = [...items];
  return groupByEntity(list) ?? groupByEnding(list) ?? groupByNumberedName(list);
}

/** "6 kinds × 9 contrasts" or "4 kinds", for the caption beside the chips. */
export function describeKindGrouping(grouping: KindGrouping): string {
  const kinds = grouping.groups.filter((group) => !group.other).length;
  const count = `${kinds} ${kinds === 1 ? 'kind' : 'kinds'}`;
  return grouping.stemCount === null ? count : `${count} × ${grouping.stemCount} names`;
}
