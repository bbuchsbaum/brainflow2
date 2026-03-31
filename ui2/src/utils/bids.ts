/** Format bare subject ID for display: "01" → "sub-01" */
export const formatSubjectId = (id: string): string =>
  id.startsWith('sub-') ? id : `sub-${id}`;

/** Format bare session ID for display: "01" → "ses-01" */
export const formatSessionId = (id: string): string =>
  id.startsWith('ses-') ? id : `ses-${id}`;

// ── BIDS filename parsing ───────────────────────────────────────

/** Standard BIDS entity keys in display-priority order. */
const ENTITY_KEYS = [
  'sub', 'ses', 'task', 'acq', 'ce', 'dir', 'rec', 'run',
  'echo', 'space', 'desc', 'res', 'den', 'label', 'hemi',
  'from', 'to', 'mode',
] as const;

/** Regex: key-value pairs separated by underscores, with suffix before extension. */
const ENTITY_RE = /(?:^|_)([a-z]+)-([^_]+)/g;

/** Known compound extensions. */
const COMPOUND_EXTS = ['.nii.gz', '.surf.gii', '.func.gii', '.label.gii', '.shape.gii'];

export interface BidsEntities {
  /** Raw entity map, e.g. { sub: "01", task: "rest", space: "MNI152NLin2009cAsym" } */
  entities: Record<string, string>;
  /** Suffix (e.g. "bold", "T1w", "mask") */
  suffix: string;
  /** Extension (e.g. ".nii.gz") */
  extension: string;
}

/**
 * Parse a BIDS-formatted filename into entities, suffix, and extension.
 * Returns null for non-BIDS filenames (no entities detected).
 */
export function parseBidsFilename(filename: string): BidsEntities | null {
  // Strip path — only use the basename
  const basename = filename.includes('/') ? filename.split('/').pop()! : filename;

  // Detect extension (compound first, then simple)
  let ext = '';
  const lower = basename.toLowerCase();
  for (const ce of COMPOUND_EXTS) {
    if (lower.endsWith(ce)) { ext = ce; break; }
  }
  if (!ext) {
    const dotIdx = basename.lastIndexOf('.');
    ext = dotIdx > 0 ? basename.slice(dotIdx) : '';
  }

  const stem = ext ? basename.slice(0, basename.length - ext.length) : basename;

  // Extract key-value entities
  const entities: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ENTITY_RE.lastIndex = 0;
  while ((match = ENTITY_RE.exec(stem)) !== null) {
    entities[match[1]] = match[2];
  }

  // No entities → not a BIDS filename
  if (Object.keys(entities).length === 0) return null;

  // Suffix = last underscore-separated segment that isn't a key-value pair
  const parts = stem.split('_');
  const lastPart = parts[parts.length - 1];
  const suffix = lastPart.includes('-') ? '' : lastPart;

  return { entities, suffix, extension: ext };
}

/** Human-friendly suffix labels. */
const SUFFIX_LABELS: Record<string, string> = {
  bold: 'BOLD',
  T1w: 'T1w',
  T2w: 'T2w',
  FLAIR: 'FLAIR',
  mask: 'Mask',
  dseg: 'Segmentation',
  probseg: 'Prob. Seg.',
  stat: 'Stat Map',
  cbv: 'CBV',
  cbf: 'CBF',
  epi: 'EPI',
};

/**
 * Build a human-readable display name from parsed BIDS entities.
 *
 * Examples:
 *   sub-01_task-rest_space-MNI152_desc-preproc_bold.nii.gz
 *     → "Rest BOLD (sub-01, MNI152, preproc)"
 *   sub-03_ses-02_T1w.nii.gz
 *     → "T1w (sub-03, ses-02)"
 */
export function formatBidsDisplayName(parsed: BidsEntities): string {
  const { entities, suffix } = parsed;

  // Build the primary label from task + suffix
  const parts: string[] = [];
  if (entities.task) {
    // Capitalize first letter of task name
    parts.push(entities.task.charAt(0).toUpperCase() + entities.task.slice(1));
  }
  const suffixLabel = SUFFIX_LABELS[suffix] ?? (suffix || 'Volume');
  parts.push(suffixLabel);
  const primary = parts.join(' ');

  // Build parenthetical context tags
  const tags: string[] = [];
  if (entities.sub) tags.push(`sub-${entities.sub}`);
  if (entities.ses) tags.push(`ses-${entities.ses}`);
  if (entities.space) {
    // Shorten common space names
    const space = entities.space
      .replace('MNI152NLin2009cAsym', 'MNI152')
      .replace('MNI152NLin6Asym', 'MNI152')
      .replace('fsaverage', 'fsavg');
    tags.push(space);
  }
  if (entities.desc) tags.push(entities.desc);
  if (entities.run) tags.push(`run-${entities.run}`);
  if (entities.hemi) tags.push(entities.hemi === 'L' ? 'Left' : entities.hemi === 'R' ? 'Right' : entities.hemi);

  return tags.length > 0 ? `${primary} (${tags.join(', ')})` : primary;
}
