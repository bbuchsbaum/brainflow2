/** What fixes a Series locus that failed to resolve (SeriesIssue.tsx). */
export type SeriesIssueAction = 'atlas' | 'clusters' | null;

/** The action for a locus kind that failed to resolve. */
export function seriesIssueAction(locus: string | undefined): SeriesIssueAction {
  return locus === 'region' ? 'atlas' : locus === 'cluster' ? 'clusters' : null;
}
