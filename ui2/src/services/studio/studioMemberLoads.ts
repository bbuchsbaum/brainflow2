/**
 * Loads the Set studio starts for its members, by source path, so the log
 * can attribute them to the Studio instead of reporting an ordinary file
 * load (QA rerun §2). Kept free of service imports: LogService reads it.
 */

const inFlight = new Map<string, string>();

/** Mark `sourcePath` as loading for Studio member `memberLabel`; returns the unmark. */
export function markStudioMemberLoad(sourcePath: string, memberLabel: string): () => void {
  inFlight.set(sourcePath, memberLabel);
  return () => {
    if (inFlight.get(sourcePath) === memberLabel) inFlight.delete(sourcePath);
  };
}

/** The Studio member a load of `sourcePath` belongs to, if the Studio started it. */
export function studioMemberForLoad(sourcePath: string | undefined): string | undefined {
  return sourcePath ? inFlight.get(sourcePath) : undefined;
}
