/**
 * The anatomy image a Set studio set is shown on: one resolver for the Deck,
 * the Compare panes and the Population maps.
 *
 * A user's choice for the set wins, and so does an explicit "None": "not
 * chosen" and "none" are different states. Unchosen, the default follows the
 * evidence, strongest first:
 *
 * 1. Declared: the support label ("<space> (<grid>)") or, failing that, a
 *    BIDS `space-<Label>` entity that every member file name carries. A known
 *    space gives its template; a declared space the app has no template for
 *    gives none, whatever the grid looks like.
 * 2. Grid: the image grid is a standard template lattice (same matrix and
 *    voxel size, axis-aligned, the same field of view to within one voxel).
 *    That template is filled in, and a note says what was matched: the
 *    lattice is shared by a family of templates (MNI152), so the note names
 *    the family, not a space the files declare; the template shown is the
 *    Background select's value.
 * 3. Header code only: the NIfTI header says MNI152 or Talairach but no
 *    lattice matches. Nothing is filled in; the note suggests choosing.
 * 4. Nothing: none. A brain-sized bounding box is not evidence, and neither
 *    are xform codes 1 and 2.
 *
 * A template under images of another space would misregister, so the grid
 * tiers apply only to what the evidence covers: the image the grid was read
 * from, or the whole set when its header audit found one grid.
 *
 * Kept free of store and service imports: the store's consumers and the
 * Population slice service both read it. The evidence comes in as plain data.
 */

/** Anatomy per declared template space (TemplateFlow IDs the app resolves). */
const SPACE_UNDERLAYS: Record<string, string> = {
  MNI152NLin2009cAsym: 'template:MNI152NLin2009cAsym_brain_1mm',
  MNI152NLin6Asym: 'template:MNI152NLin6Asym_T1w_1mm',
  MNIColin27: 'template:MNIColin27_T1w_native',
  MNI305: 'template:MNI305_T1w_native',
};

const TEMPLATE_PREFIX = 'template:';

/** The space a support label declares ("<space> (<grid>)"), if any. */
function declaredSpace(supportLabel: string | null | undefined): string | null {
  return /^(\S+) \(/.exec(supportLabel ?? '')?.[1] ?? null;
}

/**
 * The template a set's declared space gives, or why there is none. Neither
 * NeuroTabs manifests nor set summaries carry a reference image, so only a
 * support that declares a known template space ("<space> (<grid>)") gets
 * that template. An undeclared, subject-native or unknown space gets none.
 */
export function populationUnderlaySource(supportLabel: string | null | undefined): {
  sourcePath: string | null;
  issue: string | null;
} {
  const space = declaredSpace(supportLabel);
  if (!space) return { sourcePath: null, issue: 'space not declared' };
  if (!Object.hasOwn(SPACE_UNDERLAYS, space))
    return { sourcePath: null, issue: `no template for ${space}` };
  return { sourcePath: SPACE_UNDERLAYS[space], issue: null };
}

/** A standard template grid, described along the world axes. */
interface TemplateLattice {
  /** A key of `SPACE_UNDERLAYS`. */
  space: string;
  /** Matrix size along world x, y, z. */
  dims: readonly [number, number, number];
  voxelMm: number;
  /** World coordinates of the first and last voxel centres, per axis. */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * The standard lattices a grid is matched against, as the TemplateFlow files
 * the app resolves carry them (read from the cached res-01 / res-02 headers).
 * The 2 mm 2009c lattice sits half a voxel off the 1 mm one, and the 1 mm
 * NLin6 lattice has an even matrix; both are as shipped.
 */
const TEMPLATE_LATTICES: readonly TemplateLattice[] = [
  {
    space: 'MNI152NLin6Asym',
    dims: [91, 109, 91],
    voxelMm: 2,
    min: [-90, -126, -72],
    max: [90, 90, 108],
  },
  {
    space: 'MNI152NLin6Asym',
    dims: [182, 218, 182],
    voxelMm: 1,
    min: [-91, -126, -72],
    max: [90, 91, 109],
  },
  {
    space: 'MNI152NLin2009cAsym',
    dims: [97, 115, 97],
    voxelMm: 2,
    min: [-96.5, -132.5, -78.5],
    max: [95.5, 95.5, 113.5],
  },
  {
    space: 'MNI152NLin2009cAsym',
    dims: [193, 229, 193],
    voxelMm: 1,
    min: [-96, -132, -78],
    max: [96, 96, 114],
  },
];

/** Voxel sizes and normalised direction terms equal within this. */
const GRID_EPSILON = 1e-3;

/** The header facts a grid is judged from. */
export interface StudioGridHeader {
  /** Matrix size along the voxel axes (further axes, such as time, ignored). */
  dims: readonly number[];
  /** Voxel index to world mm, a row-major 4x4 (get_nifti_header_info). */
  voxelToWorld: readonly number[];
  sformCode?: number | null;
  qformCode?: number | null;
}

/** An axis-aligned grid, described along the world axes. */
interface WorldGrid {
  /** Per world axis: matrix size, voxel size, first and last voxel centre. */
  dims: [number, number, number];
  voxelMm: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Voxel size per voxel axis (the file's order). */
  fileVoxelMm: [number, number, number];
}

/**
 * `header`'s grid along the world axes, or null when it has none to speak
 * of: a malformed affine, or voxel axes that are not each along one world
 * axis (an oblique or sheared image). Flipped and permuted axes are fine;
 * the comparison is made in world space.
 */
function worldGrid(header: StudioGridHeader): WorldGrid | null {
  const m = header.voxelToWorld;
  const n = header.dims;
  if (!Array.isArray(m) || m.length < 16 || !Array.isArray(n) || n.length < 3) return null;
  if (!m.slice(0, 16).every((value) => typeof value === 'number' && Number.isFinite(value)))
    return null;
  if (!n.slice(0, 3).every((value) => Number.isInteger(value) && value > 0)) return null;
  // Row-major with a (0, 0, 0, 1) last row, or it is not the matrix expected.
  if (m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) return null;

  const grid: WorldGrid = {
    dims: [0, 0, 0],
    voxelMm: [0, 0, 0],
    min: [0, 0, 0],
    max: [0, 0, 0],
    fileVoxelMm: [0, 0, 0],
  };
  const taken = [false, false, false];
  for (let axis = 0; axis < 3; axis += 1) {
    const step = [m[axis], m[4 + axis], m[8 + axis]];
    const size = Math.hypot(step[0], step[1], step[2]);
    if (!(size > 0)) return null;
    grid.fileVoxelMm[axis] = size;
    const along = step.findIndex((value) => Math.abs(Math.abs(value) / size - 1) <= GRID_EPSILON);
    if (along < 0 || taken[along]) return null;
    if (step.some((value, index) => index !== along && Math.abs(value) / size > GRID_EPSILON))
      return null;
    taken[along] = true;
    const first = m[4 * along + 3];
    const last = first + step[along] * (n[axis] - 1);
    grid.dims[along] = n[axis];
    grid.voxelMm[along] = size;
    grid.min[along] = Math.min(first, last);
    grid.max[along] = Math.max(first, last);
  }
  return grid;
}

/**
 * The template space whose standard lattice `header`'s grid is, or null. A
 * lattice matches when the matrix and voxel size are equal, the axes are
 * axis-aligned, and the first and last voxel centres are each within one
 * voxel of the lattice's on every world axis.
 */
export function matchTemplateLattice(header: StudioGridHeader): string | null {
  const grid = worldGrid(header);
  if (!grid) return null;
  const lattice = TEMPLATE_LATTICES.find((candidate) =>
    [0, 1, 2].every(
      (axis) =>
        grid.dims[axis] === candidate.dims[axis] &&
        Math.abs(grid.voxelMm[axis] - candidate.voxelMm) <= GRID_EPSILON &&
        Math.abs(grid.min[axis] - candidate.min[axis]) <= candidate.voxelMm + GRID_EPSILON &&
        Math.abs(grid.max[axis] - candidate.max[axis]) <= candidate.voxelMm + GRID_EPSILON,
    ),
  );
  return lattice && Object.hasOwn(SPACE_UNDERLAYS, lattice.space) ? lattice.space : null;
}

/** The template spaces a NIfTI xform code names (codes 1 and 2 name none). */
const HEADER_SPACES: Record<number, 'Talairach' | 'MNI152'> = { 3: 'Talairach', 4: 'MNI152' };

/** The template space the header's xform codes name: the sform's, else the qform's. */
function headerSpace(header: StudioGridHeader): 'Talairach' | 'MNI152' | null {
  return HEADER_SPACES[header.sformCode ?? 0] ?? HEADER_SPACES[header.qformCode ?? 0] ?? null;
}

/**
 * What one image's header says about the space of a set: the grid evidence
 * the resolver reads. It describes the member it was read from; the resolver
 * extends it to the set only on the set's own header audit.
 */
export interface StudioGridEvidence {
  setId: string;
  /** The member whose header this is. */
  memberId: string;
  /** Matrix and voxel size along the voxel axes (the file's order). */
  dims: [number, number, number];
  voxelMm: [number, number, number];
  /** The template space whose lattice the grid is, if any. */
  space: string | null;
  /** The space the xform codes name (3 or 4), if any. */
  headerSpace: 'Talairach' | 'MNI152' | null;
}

/** The grid evidence of `header`, read from member `memberId` of set `setId`. */
export function studioGridEvidence(
  setId: string,
  memberId: string,
  header: StudioGridHeader,
): StudioGridEvidence | null {
  const grid = worldGrid(header);
  if (!grid) return null;
  return {
    setId,
    memberId,
    dims: [header.dims[0], header.dims[1], header.dims[2]],
    voxelMm: grid.fileVoxelMm,
    space: matchTemplateLattice(header),
    headerSpace: headerSpace(header),
  };
}

/** Whether two pieces of grid evidence say the same thing. */
export function sameGridEvidence(
  a: StudioGridEvidence | null | undefined,
  b: StudioGridEvidence | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.setId === b.setId &&
    a.memberId === b.memberId &&
    a.space === b.space &&
    a.headerSpace === b.headerSpace &&
    a.dims.every((value, axis) => value === b.dims[axis]) &&
    a.voxelMm.every((value, axis) => value === b.voxelMm[axis])
  );
}

/** "91 × 109 × 91, 2 mm". */
function gridLabel(grid: Pick<StudioGridEvidence, 'dims' | 'voxelMm'>): string {
  const mm = grid.voxelMm.map((value) => String(Number(value.toFixed(2))));
  const size = mm.every((value) => value === mm[0]) ? mm[0] : mm.join(' × ');
  return `${grid.dims.join(' × ')}, ${size} mm`;
}

/**
 * What a matched lattice establishes. Several MNI152 variants are distributed
 * on the same matrix and field of view (91 × 109 × 91 at 2 mm is NLin6Asym's,
 * and also the grid of other MNI152 templates), so a match names the family,
 * not the template the images were normalised to.
 */
function latticeFamily(space: string): string {
  return space.startsWith('MNI152') ? 'MNI152 grid' : `${space} grid`;
}

/**
 * Whether a header audit's support label ("91×109×91 voxels · 2.00×2.00×2.00
 * mm", as the folder and table audits write it) names the grid of `grid`.
 */
function auditedGridIs(supportLabel: string | null | undefined, grid: StudioGridEvidence): boolean {
  const match = /^(\d+)×(\d+)×(\d+) voxels · ([\d.]+)×([\d.]+)×([\d.]+) mm\b/.exec(
    supportLabel ?? '',
  );
  if (!match) return false;
  return [0, 1, 2].every(
    (axis) =>
      Number(match[1 + axis]) === grid.dims[axis] &&
      Math.abs(Number(match[4 + axis]) - grid.voxelMm[axis]) <= 0.006,
  );
}

/** What the member file names say about the set's space. */
interface NamedSpaces {
  /** The `space-` label every named member file carries, if they all carry one. */
  unanimous: string | null;
  /** Whether any member file name carries a `space-` label. */
  any: boolean;
}

const NO_NAMED_SPACES: NamedSpaces = { unanimous: null, any: false };
/** Per member list (replaced, never edited, by the store): scanned once. */
const namedSpacesCache = new WeakMap<object, NamedSpaces>();

/** The BIDS `space-<Label>` entity of a path's file name, if any. */
function fileNameSpace(sourcePath: string): string | null {
  const name = sourcePath.split(/[\\/]/).pop() ?? '';
  return /(?:^|_)space-([A-Za-z0-9]+)(?=[_.]|$)/.exec(name)?.[1] ?? null;
}

function namedSpaces(
  members: readonly { sourcePath?: string | null }[] | null | undefined,
): NamedSpaces {
  if (!members?.length) return NO_NAMED_SPACES;
  const cached = namedSpacesCache.get(members);
  if (cached) return cached;
  const labels = new Set<string>();
  let named = 0;
  let labelled = 0;
  for (const member of members) {
    const path = member?.sourcePath?.trim();
    if (!path || !path.split(/[\\/]/).pop()) continue;
    named += 1;
    const label = fileNameSpace(path);
    if (!label) continue;
    labelled += 1;
    labels.add(label);
  }
  const result: NamedSpaces = {
    unanimous: named > 0 && labelled === named && labels.size === 1 ? [...labels][0] : null,
    any: labelled > 0,
  };
  namedSpacesCache.set(members, result);
  return result;
}

/** A user's background choice for one set; `sourcePath` null is "None". */
export interface StudioBackgroundChoice {
  setId: string;
  sourcePath: string | null;
}

export interface StudioBackground {
  /** The `template:<id>` source to draw under the images, or null for none. */
  sourcePath: string | null;
  /** Why the set's space gives no template; null once the user has chosen. */
  issue: string | null;
  /**
   * Who decided: the user (`chosen`), the set's declared space (`space`, also
   * when nothing is declared and there is none), or a standard template
   * lattice recognised in the image grid (`grid`).
   */
  origin: 'chosen' | 'space' | 'grid';
}

/** What, beyond the user's choice and the support label, the default rests on. */
export interface StudioBackgroundEvidence {
  /** The set's members: their file names may carry a `space-` entity. */
  members?: readonly { sourcePath?: string | null }[] | null;
  /** The set's audited alignment (`same-grid` when its headers agree). */
  alignmentClass?: string | null;
  /** The lens asking: Population shows the whole set, never one member. */
  lens?: string | null;
  /** The header of the member on display. */
  grid?: StudioGridEvidence | null;
}

/** A `template:<id>` source path, trimmed; null for anything else. */
export function templateSourcePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  return path.startsWith(TEMPLATE_PREFIX) && path.length > TEMPLATE_PREFIX.length ? path : null;
}

/** A resolved background and the note the Background control shows with it. */
interface ResolvedBackground extends StudioBackground {
  note: string | null;
}

const NOT_DECLARED = 'space not declared';

function resolveBackground(
  choice: StudioBackgroundChoice | null | undefined,
  setId: string | null | undefined,
  supportLabel: string | null | undefined,
  evidence: StudioBackgroundEvidence | null | undefined,
): ResolvedBackground {
  const names = namedSpaces(evidence?.members);
  const space = declaredSpace(supportLabel) ?? names.unanimous;
  if (choice && setId && choice.setId === setId)
    return {
      sourcePath: choice.sourcePath,
      issue: null,
      origin: 'chosen',
      note: choiceNote(choice.sourcePath, space),
    };
  // 1. Declared. A declared space without a template is still declared: the
  // grid does not overrule it.
  if (space) {
    return Object.hasOwn(SPACE_UNDERLAYS, space)
      ? { sourcePath: SPACE_UNDERLAYS[space], issue: null, origin: 'space', note: null }
      : { sourcePath: null, issue: `no template for ${space}`, origin: 'space', note: null };
  }
  const none: ResolvedBackground = {
    sourcePath: null,
    issue: NOT_DECLARED,
    origin: 'space',
    note: null,
  };
  // File names that name a space for some members only, or different spaces,
  // declare nothing, and leave no room to assume one.
  const grid = evidence?.grid;
  if (names.any || !grid || !setId || grid.setId !== setId) return none;
  // The header is one member's. The set's audit extends it to every member
  // when it found one grid and that grid is this one; otherwise it covers
  // the member on display, which Population does not show.
  const wholeSet = evidence?.alignmentClass === 'same-grid' && auditedGridIs(supportLabel, grid);
  if (!wholeSet && evidence?.lens === 'population') return none;
  // 2. Grid. The lattice identifies a family of grids, not one template: the
  // note says what was matched and which template it is shown on.
  if (grid.space && Object.hasOwn(SPACE_UNDERLAYS, grid.space)) {
    // The essential part first, short enough to read in the toolbar; the
    // template it is shown on is the Background select's own value.
    const family = latticeFamily(grid.space);
    return {
      sourcePath: SPACE_UNDERLAYS[grid.space],
      issue: null,
      origin: 'grid',
      note: wholeSet
        ? `${family} matched from the images (${gridLabel(grid)}); not declared by the files.`
        : `${family} matched from this image (${gridLabel(grid)}); the other images were not checked.`,
    };
  }
  // 3. Header code only: a suggestion, never a template.
  if (grid.headerSpace === 'MNI152')
    return { ...none, note: "This image's header says MNI152 space; choose a template." };
  if (grid.headerSpace === 'Talairach')
    return { ...none, note: "This image's header says Talairach space; there is no template for it." };
  return none;
}

/**
 * The background of set `setId`: the user's choice for that set when there
 * is one (an explicit "None" included), else the default its evidence gives
 * (see the top of this file).
 */
export function resolveStudioBackground(
  choice: StudioBackgroundChoice | null | undefined,
  setId: string | null | undefined,
  supportLabel: string | null | undefined,
  evidence?: StudioBackgroundEvidence | null,
): StudioBackground {
  const { sourcePath, issue, origin } = resolveBackground(choice, setId, supportLabel, evidence);
  return { sourcePath, issue, origin };
}

/**
 * What the reader should know about the background {@link resolveStudioBackground}
 * gives, or null: where an automatic template came from, what a header
 * suggests, or how far a chosen template's alignment is known.
 */
export function resolveStudioBackgroundNote(
  choice: StudioBackgroundChoice | null | undefined,
  setId: string | null | undefined,
  supportLabel: string | null | undefined,
  evidence?: StudioBackgroundEvidence | null,
): string | null {
  return resolveBackground(choice, setId, supportLabel, evidence).note;
}

/** The store fields the background is read from. */
export interface StudioBackgroundState {
  selection: { activeSetId: string | null; activeLens?: string | null };
  sets: Record<
    string,
    | {
        supportLabel?: string | null;
        alignmentClass?: string | null;
        memberSummaries?: readonly { sourcePath?: string | null }[] | null;
      }
    | undefined
  >;
  studioBackground: StudioBackgroundChoice | null;
  studioGridEvidence?: StudioGridEvidence | null;
}

function activeBackground(state: StudioBackgroundState): ResolvedBackground {
  const setId = state.selection.activeSetId;
  const set = setId ? state.sets[setId] : undefined;
  return resolveBackground(state.studioBackground, setId, set?.supportLabel, {
    members: set?.memberSummaries,
    alignmentClass: set?.alignmentClass,
    lens: state.selection.activeLens,
    grid: state.studioGridEvidence,
  });
}

/** The active set's background (a new object per call: not a store selector). */
export function activeStudioBackground(state: StudioBackgroundState): StudioBackground {
  const { sourcePath, issue, origin } = activeBackground(state);
  return { sourcePath, issue, origin };
}

/** Store selector: the active set's background source path, or null. */
export function selectStudioBackgroundPath(state: StudioBackgroundState): string | null {
  return state.selection.activeSetId ? activeStudioBackground(state).sourcePath : null;
}

/** The alignment note of a template the user chose, given the set's declared space. */
function choiceNote(sourcePath: string | null, space: string | null): string | null {
  const template = templateSourcePath(sourcePath);
  if (!template) return null;
  if (!space) return 'Assumed to match these images; not checked.';
  return template.slice(TEMPLATE_PREFIX.length).startsWith(`${space}_`)
    ? null
    : `Not the set's declared space (${space}).`;
}

/**
 * What the reader should know about a background's alignment, or null. The
 * app does not register images: a template is drawn where its own affine
 * puts it.
 */
export function studioBackgroundNote(
  sourcePath: string | null,
  supportLabel: string | null | undefined,
): string | null {
  return choiceNote(sourcePath, declaredSpace(supportLabel));
}

/** Store selector: the note shown beside the active set's Background select. */
export function selectStudioBackgroundNote(state: StudioBackgroundState): string | null {
  return state.selection.activeSetId ? activeBackground(state).note : null;
}

export interface StudioBackgroundOption {
  /** `template:<id>`. */
  value: string;
  label: string;
}

/** The catalog fields the options are built from (get_template_catalog). */
interface CatalogEntry {
  id?: unknown;
  name?: unknown;
  config?: { template_type?: unknown } | null;
}

/** Template types that are anatomy images, not masks or tissue maps. */
const ANATOMY_TYPES = new Set(['T1w', 'T2w', 'FLAIR', 'brain']);

/** The anatomy templates of a catalog, by display name. */
export function studioBackgroundOptions(catalog: unknown): StudioBackgroundOption[] {
  if (!Array.isArray(catalog)) return [];
  return (catalog as CatalogEntry[])
    .filter(
      (entry) =>
        !!entry &&
        typeof entry.id === 'string' &&
        !!entry.id.trim() &&
        ANATOMY_TYPES.has(String(entry.config?.template_type)),
    )
    .map((entry) => ({
      value: `${TEMPLATE_PREFIX}${(entry.id as string).trim()}`,
      label:
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : (entry.id as string),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/**
 * The options a Background select lists after "None": the catalog's anatomy
 * templates, plus the current value when the catalog does not list it (a
 * space default such as a skull-stripped brain, or a catalog not yet read).
 */
export function withCurrentBackground(
  options: readonly StudioBackgroundOption[],
  current: string | null,
): StudioBackgroundOption[] {
  if (!current || options.some((option) => option.value === current)) return [...options];
  const id = current.startsWith(TEMPLATE_PREFIX) ? current.slice(TEMPLATE_PREFIX.length) : current;
  return [{ value: current, label: id }, ...options];
}

/** The catalog's anatomy templates, read once per app session. */
let catalogOptions: Promise<StudioBackgroundOption[]> | null = null;

/**
 * The Background options of the template catalog `readCatalog` returns
 * (get_template_catalog). Read once; a failed read is asked for again.
 */
export function loadStudioBackgroundOptions(
  readCatalog: () => Promise<unknown>,
): Promise<StudioBackgroundOption[]> {
  if (!catalogOptions) {
    const load = Promise.resolve()
      .then(readCatalog)
      .then(studioBackgroundOptions);
    catalogOptions = load;
    load.catch(() => {
      if (catalogOptions === load) catalogOptions = null;
    });
  }
  return catalogOptions;
}

/** Test hook. */
export function resetStudioBackgroundOptions(): void {
  catalogOptions = null;
}
