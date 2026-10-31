/**
 * Command palette matching and shortcut display.
 *
 * Each query token must match the command's title, keywords, group or
 * subtitle, as a substring or (title and keywords only) as runs that each
 * start a word ("tsv" → Toggle Snap to Voxel); "hdr" and "xhair" are aliases
 * (header, crosshair). Results rank title-prefix > word-start > substring >
 * word-prefix runs, title above keywords above group/subtitle; ties keep the
 * caller's order.
 */

export interface MatchableCommand {
  title: string;
  subtitle?: string;
  group?: string;
  keywords?: string[];
}

/** Common abbreviations users type for words in command titles. */
const QUERY_ALIASES: Readonly<Record<string, string>> = {
  xhair: 'crosshair',
  xh: 'crosshair',
  hdr: 'header',
  cfg: 'settings',
  prefs: 'settings',
  ws: 'workspace',
  img: 'image',
  vol: 'volume',
  surf: 'surface',
  pal: 'palette',
};

function normalize(text: string): string {
  return text.toLocaleLowerCase();
}

/** Score of `token` against one field; 0 means no match. */
function scoreField(token: string, field: string, allowSubsequence: boolean): number {
  if (!field) return 0;
  if (field.startsWith(token)) return 1000;
  const at = field.indexOf(token);
  if (at >= 0) {
    if (isWordStart(field, at)) return 800 - Math.min(at, 100);
    // Two letters inside a word ("rm" in "colormap") are weaker than an
    // abbreviated word ("rm" → Remove).
    return token.length < 3 ? 150 : 600 - Math.min(at, 100);
  }
  return allowSubsequence ? scoreSubsequence(token, field) : 0;
}

const isWordStart = (field: string, at: number) =>
  at === 0 || /[^\p{L}\p{N}]/u.test(field[at - 1]);

/**
 * Word-anchored subsequence score (0 when there is none). Two forms, both
 * anchored at word starts, words in order:
 * - word-prefix runs: `token` splits into runs, each matched contiguously
 *   from the START of a word ("tsv" → Toggle Snap to Voxel, "orthpan" →
 *   Orthogonal Panels); fewer, longer runs score higher;
 * - abbreviated words (lower): each piece is a subsequence of ONE word,
 *   starting at its first letter ("kb" → Keyboard, "nsynth" → Neurosynth,
 *   "expimg" → Export … Image, "tmpl" → Template).
 * A subsequence scattered across words without that anchoring is no match
 * (QA 2026-10-30 F30: "atlas" found "Layout: Orthogonal Panels" and "aseg"
 * "Crosshair Settings…").
 */
function scoreSubsequence(token: string, field: string): number {
  if (token.length < 2) return 0;
  const runs = wordPrefixRuns(token, field, 0);
  if (runs !== null) return Math.max(1, 400 - (runs - 1) * 40);
  const words = wordSpans(field);
  const pieces = abbreviatedWords(token, field, words, 0);
  if (pieces === null) return 0;
  return Math.max(1, 250 - (pieces - 1) * 30);
}

/** Fewest word-prefix runs covering `token` from word index `from`, or null. */
function wordPrefixRuns(token: string, field: string, from: number): number | null {
  if (token.length === 0) return 0;
  let best: number | null = null;
  for (let at = from; at < field.length; at += 1) {
    if (!isWordStart(field, at) || field[at] !== token[0]) continue;
    // The longest run here first, then shorter ones.
    let len = 0;
    while (len < token.length && field[at + len] === token[len]) len += 1;
    for (let take = len; take >= 1; take -= 1) {
      const rest = wordPrefixRuns(token.slice(take), field, at + take);
      if (rest !== null && (best === null || rest + 1 < best)) best = rest + 1;
      if (best === 1) return best;
    }
  }
  return best;
}

/** [start, end) of each letter/digit word of `field`. */
function wordSpans(field: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(field); m; m = re.exec(field)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * Fewest words covering `token` as pieces, each a subsequence of one word
 * that starts at the word's first letter (words from index `from`), or null.
 */
function abbreviatedWords(
  token: string,
  field: string,
  words: ReadonlyArray<[number, number]>,
  from: number,
): number | null {
  if (token.length === 0) return 0;
  let best: number | null = null;
  for (let w = from; w < words.length; w += 1) {
    const [start, end] = words[w];
    if (field[start] !== token[0]) continue;
    // Greedy: the most of `token` this word holds in order, then fewer.
    let taken = 1;
    for (let at = start + 1; at < end && taken < token.length; at += 1) {
      if (field[at] === token[taken]) taken += 1;
    }
    for (let take = taken; take >= 1; take -= 1) {
      const rest = abbreviatedWords(token.slice(take), field, words, w + 1);
      if (rest !== null && (best === null || rest + 1 < best)) best = rest + 1;
      if (best === 1) return best;
    }
  }
  return best;
}

function scoreToken(token: string, command: MatchableCommand): number {
  const title = normalize(command.title);
  const keywords = (command.keywords ?? []).map(normalize);
  const others = [normalize(command.group ?? ''), normalize(command.subtitle ?? '')];
  const titleScore = scoreField(token, title, true) * 3;
  const keywordScore = Math.max(0, ...keywords.map((k) => scoreField(token, k, true))) * 2;
  const otherScore = Math.max(...others.map((field) => scoreField(token, field, false)));
  return Math.max(titleScore, keywordScore, otherScore);
}

/**
 * A token that starts with an alias and continues ("xhset": crosshair +
 * set): both parts must match; the score is their mean.
 */
function aliasPrefixScore(token: string, command: MatchableCommand): number {
  let best = 0;
  for (const [short, word] of Object.entries(QUERY_ALIASES)) {
    if (token.length <= short.length || !token.startsWith(short)) continue;
    const head = scoreToken(word, command);
    const tail = head > 0 ? scoreToken(token.slice(short.length), command) : 0;
    if (head > 0 && tail > 0) best = Math.max(best, (head + tail) / 2);
  }
  return best;
}

/** Relevance of `command` for `query`; 0 = no match. An empty query matches all (1). */
export function scoreCommand(command: MatchableCommand, query: string): number {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const token of tokens) {
    const alias = QUERY_ALIASES[token];
    const best = Math.max(
      scoreToken(token, command),
      alias ? scoreToken(alias, command) : 0,
      aliasPrefixScore(token, command),
    );
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Matching commands, best first; equal scores keep their input order. */
export function rankCommands<T extends MatchableCommand>(
  commands: readonly T[],
  query: string,
): T[] {
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac/i.test(platform);
}

const MAC_GLYPHS: Readonly<Record<string, string>> = {
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  cmd: '⌘',
  meta: '⌘',
  'cmd/ctrl': '⌘',
};
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

/**
 * Display form of a shortcut written as "Cmd/Ctrl+Shift+E": "⇧⌘E" on macOS,
 * "Ctrl+Shift+E" elsewhere. Single keys ("G", "?") pass through.
 */
export function formatShortcut(shortcut: string, mac: boolean = isMacPlatform()): string {
  const parts = shortcut.split('+').map((part) => part.trim());
  // A trailing "+" key ("Cmd+Shift++") splits into an empty last part.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts[parts.length - 1] = '+';
  const key = parts.pop() ?? '';
  const modifiers = parts.filter(Boolean);
  if (modifiers.length === 0) return key;
  if (!mac) {
    return [...modifiers.map((m) => (/^cmd\/ctrl$/i.test(m) ? 'Ctrl' : m)), key].join('+');
  }
  const glyphs = modifiers.map((m) => MAC_GLYPHS[m.toLowerCase()] ?? m);
  glyphs.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
  return `${glyphs.join('')}${key.length === 1 ? key.toUpperCase() : key}`;
}
