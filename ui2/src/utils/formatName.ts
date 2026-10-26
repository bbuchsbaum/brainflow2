/**
 * Display formatting for file and layer names.
 *
 * Neuroimaging names differ at the END ("…_brain.nii.gz" vs
 * "…_brain_mask.nii.gz") and their extension says what they are, so a plain
 * end ellipsis ("MNI152_T1_2mm_br…") or a head-only cut ("MN… _2mm_brain.nii.gz")
 * loses the useful part. `formatName` truncates in the MIDDLE of the stem and
 * never cuts the extension: "MNI152_T1_2mm_brain_mask.nii.gz" at 22 chars ->
 * "MNI152…brain_mask.nii.gz"-style output.
 */

/** Compound extensions recognised as one unit (lower case). */
export const COMPOUND_EXTENSIONS = [
  '.nii.gz',
  '.tar.gz',
  '.csv.gz',
  '.tsv.gz',
  '.func.gii',
  '.shape.gii',
  '.surf.gii',
  '.label.gii',
] as const;

/**
 * The extension of a file name: a known compound extension (".nii.gz"), else
 * the last ".xxx" of at most 10 characters, else "". Directories pass
 * `isDir` and have no extension.
 */
export function fileExtension(name: string, isDir = false): string {
  if (isDir) return '';
  const lower = name.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find(
    (ext) => lower.endsWith(ext) && lower.length > ext.length,
  );
  if (compound) return name.slice(name.length - compound.length);
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0 && name.length - lastDot <= 10) return name.slice(lastDot);
  return '';
}

const SEPARATORS = /[_\-.\s]/;

/** How far (characters) a cut may move to land on a word boundary. */
const SNAP_WINDOW = 3;

/**
 * Word-aware middle cut (balanced mode). Around the default head length
 * `head0` (and the tail that fills the rest of `budget`), try cuts up to
 * `SNAP_WINDOW` characters either way and pick, in order: the most cuts that
 * land on a separator ("_", "-", ".", space) rather than mid-word, then the
 * most characters kept, then the cut nearest the default. A separator next to
 * the ellipsis is dropped. Returns null when the stem is too short to choose.
 */
function snapToWords(
  stem: string[],
  budget: number,
  head0: number,
): { head: string; tail: string; score: number } | null {
  const n = stem.length;
  const sep = (i: number) => i >= 0 && i < n && SEPARATORS.test(stem[i]);
  const tail0 = budget - head0;
  let best: { score: number; used: number; dist: number; head: string; tail: string } | null = null;
  for (let h = Math.max(1, head0 - SNAP_WINDOW); h <= head0 + SNAP_WINDOW; h += 1) {
    for (let l = Math.max(1, tail0 - SNAP_WINDOW); l <= tail0 + SNAP_WINDOW; l += 1) {
      const t = n - l; // tail start
      if (t <= h) continue;
      let head = stem.slice(0, h);
      let tail = stem.slice(t);
      if (head.length > 1 && SEPARATORS.test(head[head.length - 1])) head = head.slice(0, -1);
      if (tail.length > 1 && SEPARATORS.test(tail[0])) tail = tail.slice(1);
      const used = head.length + tail.length;
      if (used > budget || head.length < Math.min(3, budget - 1) || tail.length < 1) continue;
      const score = (sep(h) || sep(h - 1) ? 1 : 0) + (sep(t - 1) || sep(t) ? 1 : 0);
      const dist = Math.abs(h - head0) + Math.abs(l - tail0);
      if (
        !best ||
        score > best.score ||
        (score === best.score && (used > best.used || (used === best.used && dist < best.dist)))
      ) {
        best = { score, used, dist, head: head.join(''), tail: tail.join('') };
      }
    }
  }
  return best;
}

export interface FormatNameOptions {
  /** Directory names have no protected extension. */
  isDir?: boolean;
  /** Ellipsis glyph (default U+2026). */
  ellipsis?: string;
  /**
   * Which end of the stem to favour. `balanced` (default): about 40% head,
   * the rest tail. `tail`: the distinctive END wins: no head at all below a
   * 16-character budget ("…brain_mask.nii.gz"), then a short head (20%, at
   * least 3 characters) for orientation. Use `tail` for sibling lists (the
   * Files tree) where names share a long prefix.
   */
  keep?: 'balanced' | 'tail' | 'auto';
}

/** `keep: 'auto'`: at or below this many characters the tail wins. */
export const AUTO_TAIL_MAX_CHARS = 16;

/**
 * The longest run of WHOLE trailing tokens of `stem` (tokens split at
 * "_", "-", ".", space) that fits `budget`, without its leading separator
 * ("brain_mask", else "mask"); null when not even the last token fits.
 */
function wholeTokenTail(stem: string[], budget: number): string | null {
  for (let i = 1; i < stem.length; i += 1) {
    if (!SEPARATORS.test(stem[i - 1]) || SEPARATORS.test(stem[i])) continue;
    if (stem.length - i <= budget) return stem.slice(i).join('');
  }
  return null;
}

/**
 * Fit `name` into `maxChars` characters (code points) with a middle ellipsis
 * that keeps the extension whole and the distinctive end of the stem.
 *
 * - Names that fit are returned unchanged.
 * - The stem keeps a head (about 40% of the budget, at least 3 characters)
 *   and a tail; a separator ("_", "-", ".") at the cut is dropped so the
 *   ellipsis does not sit next to a dangling underscore.
 * - Balanced mode is word-aware: when a separator lies within 3 characters
 *   of a cut, the cut moves to it rather than splitting a word
 *   ("MNI152…brain.nii.gz", not "MNI15…m_brain.nii.gz").
 * - When even "x…" + extension does not fit, the extension itself is the
 *   last resort: the result is an end-truncated name ("sub-01_ses…").
 */
export function formatName(
  name: string,
  maxChars: number,
  options: FormatNameOptions = {},
): string {
  const ellipsis = options.ellipsis ?? '…';
  const chars = Array.from(name);
  if (chars.length <= maxChars) return name;
  if (maxChars <= 1) return ellipsis.slice(0, Math.max(0, maxChars));
  const ext = Array.from(fileExtension(name, options.isDir));
  const stem = chars.slice(0, chars.length - ext.length);
  const budget = maxChars - ext.length - 1; // characters of stem around the ellipsis
  if (budget < 2) {
    // Too narrow to keep the extension: plain end truncation.
    return `${chars.slice(0, maxChars - 1).join('')}${ellipsis}`;
  }
  if (options.keep === 'auto' && maxChars <= AUTO_TAIL_MAX_CHARS) {
    const tokens = wholeTokenTail(stem, budget);
    if (tokens !== null) return `${ellipsis}${tokens}${ext.join('')}`;
    // Not even the last token fits: fall through to the character tail.
  }
  const tailBias = options.keep === 'tail' || (options.keep === 'auto' && maxChars <= AUTO_TAIL_MAX_CHARS);
  if (!tailBias) {
    const snapped = snapToWords(stem, budget, Math.max(Math.min(3, budget - 1), Math.round(budget * 0.4)));
    if (snapped) {
      // `auto`: a middle cut that still splits a word ("MNI15…brain") loses
      // to whole trailing tokens ("…brain.nii.gz") when those fit.
      if (options.keep === 'auto' && snapped.score < 2) {
        const tokens = wholeTokenTail(stem, budget);
        if (tokens !== null) return `${ellipsis}${tokens}${ext.join('')}`;
      }
      return `${snapped.head}${ellipsis}${snapped.tail}${ext.join('')}`;
    }
  }
  let headLen = tailBias
    ? budget >= 16
      ? Math.max(3, Math.round(budget * 0.2))
      : 0
    : Math.max(Math.min(3, budget - 1), Math.round(budget * 0.4));
  let tailLen = budget - headLen;
  let head = stem.slice(0, headLen);
  let tail = tailLen > 0 ? stem.slice(stem.length - tailLen) : [];
  if (headLen === 0) {
    // Tail only: just drop a separator touching the ellipsis ("…_mask" -> "…mask").
    if (tail.length > 1 && SEPARATORS.test(tail[0])) tail = tail.slice(1);
    return `${ellipsis}${tail.join('')}${ext.join('')}`;
  }
  // Drop a separator touching the ellipsis and give the character back to the other side.
  if (tail.length > 1 && SEPARATORS.test(tail[0])) {
    tail = tail.slice(1);
    headLen += 1;
    head = stem.slice(0, headLen);
  }
  if (head.length > 1 && SEPARATORS.test(head[head.length - 1])) {
    head = head.slice(0, -1);
    tailLen = budget - head.length;
    tail = stem.slice(stem.length - tailLen);
    if (tail.length > 1 && SEPARATORS.test(tail[0])) tail = tail.slice(1);
  }
  return `${head.join('')}${ellipsis}${tail.join('')}${ext.join('')}`;
}
