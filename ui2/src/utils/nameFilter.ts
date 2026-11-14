/**
 * Plain-text name filter for long file lists: space-separated terms must all
 * match (case-insensitive substring), a leading `-` excludes, and `*` is a
 * wildcard inside a term. `cue -probe` keeps names with "cue" and without
 * "probe"; `mod*tfce` keeps names where "mod" comes before "tfce".
 */
export interface NameFilter {
  /** True when the query has no usable term, so everything matches. */
  empty: boolean;
  matches: (name: string) => boolean;
}

function termTest(term: string): (name: string) => boolean {
  // The pieces between wildcards must appear in order. Plain scanning, not a
  // regular expression: a run of `*` must never cost more than one pass.
  const pieces = term.split('*').filter(Boolean);
  if (pieces.length === 1) return (name) => name.includes(pieces[0]);
  return (name) => {
    let from = 0;
    for (const piece of pieces) {
      const at = name.indexOf(piece, from);
      if (at < 0) return false;
      from = at + piece.length;
    }
    return true;
  };
}

export function parseNameFilter(query: string): NameFilter {
  const include: Array<(name: string) => boolean> = [];
  const exclude: Array<(name: string) => boolean> = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const negative = raw.startsWith('-');
    const term = negative ? raw.slice(1) : raw;
    // A lone "-" or "*" is a term still being typed, not a filter.
    if (!term.replace(/\*/g, '')) continue;
    (negative ? exclude : include).push(termTest(term));
  }
  return {
    empty: include.length === 0 && exclude.length === 0,
    matches: (name) => {
      const lower = name.toLowerCase();
      return include.every((test) => test(lower)) && !exclude.some((test) => test(lower));
    },
  };
}
