/**
 * A small Markdown subset for README text, parsed to a plain tree.
 *
 * README files are untrusted (they arrive with downloaded datasets and from
 * remote mounts), so nothing here can produce markup: the tree holds text
 * only, and the renderer writes it as React text nodes. Raw HTML stays
 * visible as the characters that were typed. Images become their alt text
 * and links become "text (url)" in plain text; nothing is fetched and
 * nothing is clickable.
 *
 * Supported: ATX and setext headings, paragraphs, bullet and numbered lists
 * (one level of nesting is flattened), fenced and indented code, block
 * quotes, rules, pipe tables (kept as preformatted text), and inline code,
 * strong, emphasis, links, autolinks and images.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; alt: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; text: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'rule' };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?=\s|$)/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    ATX.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    TABLE_ROW.test(line)
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const close = FENCE.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence (or the end of the text)
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({
        type: 'heading',
        level: atx[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(atxText(line.slice(atx[0].length))),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(lines[i].trim());
        i += 1;
      }
      blocks.push({ type: 'code', text: rows.join('\n') });
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || isBlank(lines[i]))) {
        body.push(lines[i].replace(/^(?: {4}|\t)/, ''));
        i += 1;
      }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(body.join(' ')) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const start = numbered ? Number(numbered[2]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const item = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (item) {
          items.push(ordered ? item[3] : item[2]);
          i += 1;
          continue;
        }
        // The other list kind indented under an item is a nested list: flatten it.
        const nested = ordered ? BULLET.exec(current) : NUMBERED.exec(current);
        if (nested && nested[1].length >= 2) {
          items.push(ordered ? nested[2] : nested[3]);
          i += 1;
          continue;
        }
        // An indented line continues the item above it.
        if (!isBlank(current) && /^\s{2,}/.test(current) && items.length > 0) {
          items[items.length - 1] += ` ${current.trim()}`;
          i += 1;
          continue;
        }
        // A blank line inside a loose list.
        if (isBlank(current) && i + 1 < lines.length) {
          const next = lines[i + 1];
          if (ordered ? NUMBERED.test(next) : BULLET.test(next)) {
            i += 1;
            continue;
          }
        }
        break;
      }
      blocks.push({ type: 'list', ordered, start, items: items.map(parseInline) });
      continue;
    }

    // A paragraph, possibly a setext heading.
    const body: string[] = [line.trim()];
    i += 1;
    let heading: 1 | 2 | null = null;
    while (i < lines.length && !isBlank(lines[i])) {
      const setext = SETEXT.exec(lines[i]);
      if (setext) {
        heading = setext[1][0] === '=' ? 1 : 2;
        i += 1;
        break;
      }
      if (startsBlock(lines[i])) break;
      body.push(lines[i].trim());
      i += 1;
    }
    const children = parseInline(body.join(' '));
    blocks.push(
      heading ? { type: 'heading', level: heading, children } : { type: 'paragraph', children },
    );
  }
  return blocks;
}

const ESCAPABLE = '\\`*_{}[]()#+-.!<>|~';

/**
 * Inline text longer than this is shown as typed. Every scan below is linear,
 * but a paragraph this long is not prose, and marking it up helps nobody.
 */
export const INLINE_PARSE_LIMIT = 4096;
/** Emphasis and link labels nest; past this depth the rest is shown as typed. */
const MAX_INLINE_DEPTH = 6;

/**
 * The text of an ATX heading: what follows the `#`s, without the optional
 * closing `#`s. Written by hand: a lazy pattern here backtracks quadratically
 * on a long run of spaces.
 */
function atxText(rest: string): string {
  const text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end === text.length || end === 0 || !/\s/.test(text[end - 1])) return text;
  return text.slice(0, end).trimEnd();
}

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

interface Pairs {
  /** For each `[`, the index of the `]` that closes it, or -1. */
  bracket: Int32Array;
  /** For each `(`, the index of the `)` that closes it on the same line, or -1. */
  paren: Int32Array;
}

/**
 * Every bracket and parenthesis pair of `text`, found in one pass. Looking
 * for a closer again from each opener is quadratic on text such as `[[[[…`.
 */
function matchPairs(text: string): Pairs {
  const bracket = new Int32Array(text.length).fill(-1);
  const paren = new Int32Array(text.length).fill(-1);
  const openBrackets: number[] = [];
  const openParens: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') i += 1;
    else if (ch === '[') openBrackets.push(i);
    else if (ch === ']') {
      const open = openBrackets.pop();
      if (open !== undefined) bracket[open] = i;
    } else if (ch === '(') openParens.push(i);
    else if (ch === ')') {
      const open = openParens.pop();
      if (open !== undefined) paren[open] = i;
    } else if (ch === '\n') openParens.length = 0; // a destination stays on its line
  }
  return { bracket, paren };
}

/** A link destination without its optional title: `url "title"`, `url 'title'`, `url (title)`. */
function withoutTitle(destination: string): string {
  const last = destination[destination.length - 1];
  const opener = last === '"' || last === "'" ? last : last === ')' ? '(' : null;
  if (opener === null) return destination;
  const open = destination.lastIndexOf(opener, destination.length - 2);
  if (open < 1 || !/\s/.test(destination[open - 1])) return destination;
  if (last === ')' && destination.slice(open + 1, -1).includes(')')) return destination;
  return destination.slice(0, open).trimEnd();
}

/** `[label](destination)` starting at `start` (the `[`), or null. */
function linkAt(
  text: string,
  start: number,
  pairs: Pairs,
): { label: string; url: string; end: number } | null {
  const close = pairs.bracket[start];
  if (close === undefined || close < 0 || text[close + 1] !== '(') return null;
  const end = pairs.paren[close + 1];
  if (end < 0) return null;
  const destination = text.slice(close + 2, end).trim();
  const url = withoutTitle(destination).replace(/^<|>$/g, '');
  return { label: text.slice(start + 1, close), url, end: end + 1 };
}

function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text;
        case 'strong':
        case 'em':
          return plainText(node.children);
        case 'link':
          return node.text;
        case 'image':
          return node.alt;
      }
    })
    .join('');
}

const AUTOLINK = /<((?:https?|ftp|mailto):[^\s<>]+)>/y;

export function parseInline(text: string): Inline[] {
  if (text.length > INLINE_PARSE_LIMIT) return [{ type: 'text', text }];
  return parseSpan(text, 0);
}

function parseSpan(text: string, depth: number): Inline[] {
  if (depth >= MAX_INLINE_DEPTH) return text ? [{ type: 'text', text }] : [];
  const out: Inline[] = [];
  const pairs = matchPairs(text);
  // A search that found no closer need not be made again further along:
  // whether a closer is valid does not depend on where its opener is.
  const noCloser = new Set<string>();
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      pushText(out, text[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      let length = 1;
      while (text[i + length] === '`') length += 1;
      const run = text.slice(i, i + length);
      const close = noCloser.has(run) ? -1 : text.indexOf(run, i + length);
      if (close >= 0) {
        out.push({ type: 'code', text: text.slice(i + length, close).trim() });
        i = close + length;
        continue;
      }
      noCloser.add(run);
      pushText(out, run);
      i += length;
      continue;
    }

    if (ch === '!' && text[i + 1] === '[') {
      const link = linkAt(text, i + 1, pairs);
      if (link) {
        out.push({ type: 'image', alt: plainText(parseSpan(link.label, depth + 1)) });
        i = link.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = linkAt(text, i, pairs);
      if (link) {
        out.push({
          type: 'link',
          text: plainText(parseSpan(link.label, depth + 1)),
          url: link.url,
        });
        i = link.end;
        continue;
      }
    }

    if (ch === '<') {
      AUTOLINK.lastIndex = i;
      const auto = AUTOLINK.exec(text);
      if (auto) {
        out.push({ type: 'link', text: '', url: auto[1] });
        i += auto[0].length;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const marker = text[i + 1] === ch ? ch + ch : ch;
      const before = i > 0 ? text[i - 1] : ' ';
      const after = text[i + marker.length] ?? ' ';
      // `_` inside a word (snake_case, file names) is never emphasis.
      const opens = !/\s/.test(after) && (ch === '*' || !/\w/.test(before));
      if (opens && !noCloser.has(marker)) {
        let close = text.indexOf(marker, i + marker.length + 1);
        while (close >= 0) {
          const inside = text[close - 1];
          const next = text[close + marker.length] ?? ' ';
          if (!/\s/.test(inside) && (ch === '*' || !/\w/.test(next))) break;
          close = text.indexOf(marker, close + 1);
        }
        if (close >= 0) {
          const children = parseSpan(text.slice(i + marker.length, close), depth + 1);
          out.push(marker.length === 2 ? { type: 'strong', children } : { type: 'em', children });
          i = close + marker.length;
          continue;
        }
        noCloser.add(marker);
      }
      pushText(out, marker);
      i += marker.length;
      continue;
    }

    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** Whether a README file name is Markdown (everything else is shown as plain text). */
export function isMarkdownFile(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName) || !/\.[A-Za-z0-9]+$/.test(fileName);
}
