/**
 * Command palette matching and shortcut display.
 *
 * Each query token must match the command's title, keywords, group or
 * subtitle, as a substring or (title and keywords only) as an in-order
 * subsequence, so "hdr" finds "Image Header…" and "xhair" (an alias) finds the
 * crosshair commands. Results rank title-prefix > word-start > substring >
 * subsequence, title above keywords above group/subtitle; ties keep the
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
    const wordStart = at === 0 || /[^\p{L}\p{N}]/u.test(field[at - 1]);
    return (wordStart ? 800 : 600) - Math.min(at, 100);
  }
  return allowSubsequence ? scoreSubsequence(token, field) : 0;
}

/**
 * In-order subsequence score (0 when `token` is not a subsequence). Rewards
 * matches at word starts and consecutive runs; penalises the spread.
 */
function scoreSubsequence(token: string, field: string): number {
  if (token.length < 2) return 0;
  let score = 300;
  let from = 0;
  let previous = -2;
  const first = field.indexOf(token[0]);
  if (first < 0) return 0;
  for (const ch of token) {
    const at = field.indexOf(ch, from);
    if (at < 0) return 0;
    if (at === previous + 1) score += 15;
    if (at === 0 || /[^\p{L}\p{N}]/u.test(field[at - 1])) score += 10;
    previous = at;
    from = at + 1;
  }
  const spread = previous - first + 1 - token.length;
  return Math.max(1, score - spread * 4);
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

/** Relevance of `command` for `query`; 0 = no match. An empty query matches all (1). */
export function scoreCommand(command: MatchableCommand, query: string): number {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const token of tokens) {
    const alias = QUERY_ALIASES[token];
    const best = Math.max(scoreToken(token, command), alias ? scoreToken(alias, command) : 0);
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
