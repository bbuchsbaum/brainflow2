import { describe, expect, it } from 'vitest';
import {
  activeStudioBackground,
  matchTemplateLattice,
  populationUnderlaySource,
  resolveStudioBackground,
  resolveStudioBackgroundNote,
  studioGridEvidence,
  selectStudioBackgroundNote,
  selectStudioBackgroundPath,
  studioBackgroundNote,
  studioBackgroundOptions,
  templateSourcePath,
  withCurrentBackground,
  type StudioBackgroundState,
  type StudioGridHeader,
} from '../studioBackground';

const DECLARED = 'MNI152NLin2009cAsym (2mm)';
const DEFAULT = 'template:MNI152NLin2009cAsym_brain_1mm';
const T1 = 'template:MNI152NLin2009cAsym_T1w_1mm';

describe('resolveStudioBackground', () => {
  it('unset: a declared space gives its template', () => {
    expect(resolveStudioBackground(null, 'set', DECLARED)).toEqual({
      sourcePath: DEFAULT,
      issue: null,
      origin: 'space',
    });
  });

  it('unset: an undeclared space gives none, and says why', () => {
    expect(resolveStudioBackground(null, 'set', 'Verified saved native grid')).toEqual({
      sourcePath: null,
      issue: 'space not declared',
      origin: 'space',
    });
    expect(resolveStudioBackground(undefined, 'set', null).sourcePath).toBeNull();
    expect(resolveStudioBackground(null, 'set', 'T1w (sub-01)').issue).toBe('no template for T1w');
  });

  it('an explicit template wins over the space default, and over no space', () => {
    const choice = { setId: 'set', sourcePath: T1 };
    expect(resolveStudioBackground(choice, 'set', DECLARED)).toEqual({
      sourcePath: T1,
      issue: null,
      origin: 'chosen',
    });
    expect(resolveStudioBackground(choice, 'set', 'folder of maps').sourcePath).toBe(T1);
  });

  it('an explicit "None" wins too: it is not the same as unset', () => {
    expect(resolveStudioBackground({ setId: 'set', sourcePath: null }, 'set', DECLARED)).toEqual({
      sourcePath: null,
      issue: null,
      origin: 'chosen',
    });
  });

  it("ignores another set's choice", () => {
    const choice = { setId: 'other', sourcePath: T1 };
    expect(resolveStudioBackground(choice, 'set', DECLARED).sourcePath).toBe(DEFAULT);
    expect(resolveStudioBackground(choice, null, DECLARED).origin).toBe('space');
  });

  it('keeps the space rule Population used', () => {
    expect(populationUnderlaySource('MNI152NLin6Asym (res-02)').sourcePath).toBe(
      'template:MNI152NLin6Asym_T1w_1mm',
    );
  });
});

describe('active set selectors', () => {
  const state = (
    supportLabel: string,
    studioBackground: StudioBackgroundState['studioBackground'] = null,
  ): StudioBackgroundState => ({
    selection: { activeSetId: 'set' },
    sets: { set: { supportLabel } },
    studioBackground,
  });

  it('reads the active set', () => {
    expect(selectStudioBackgroundPath(state(DECLARED))).toBe(DEFAULT);
    expect(selectStudioBackgroundPath(state('folder'))).toBeNull();
    expect(selectStudioBackgroundPath(state('folder', { setId: 'set', sourcePath: T1 }))).toBe(T1);
    expect(activeStudioBackground(state(DECLARED, { setId: 'set', sourcePath: null }))).toEqual({
      sourcePath: null,
      issue: null,
      origin: 'chosen',
    });
  });

  it('gives nothing without an active set', () => {
    const none = { ...state(DECLARED), selection: { activeSetId: null } };
    expect(selectStudioBackgroundPath(none)).toBeNull();
    expect(selectStudioBackgroundNote(none)).toBeNull();
  });

  it('notes an unchecked alignment only where there is one', () => {
    expect(selectStudioBackgroundNote(state('folder', { setId: 'set', sourcePath: T1 }))).toBe(
      'Assumed to match these images; not checked.',
    );
    expect(selectStudioBackgroundNote(state('folder'))).toBeNull();
    expect(selectStudioBackgroundNote(state(DECLARED))).toBeNull();
    expect(selectStudioBackgroundNote(state(DECLARED, { setId: 'set', sourcePath: T1 }))).toBeNull();
    expect(
      studioBackgroundNote('template:MNI152NLin6Asym_T1w_1mm', DECLARED),
    ).toBe("Not the set's declared space (MNI152NLin2009cAsym).");
  });
});

describe('background options', () => {
  it('accepts only template sources', () => {
    expect(templateSourcePath(' template:MNI305_T1w_native ')).toBe('template:MNI305_T1w_native');
    for (const value of ['template:', '/data/t1.nii.gz', '', null, undefined, 3])
      expect(templateSourcePath(value)).toBeNull();
  });

  it('lists the anatomy templates by name, without masks and tissue maps', () => {
    const entry = (id: string, name: string, template_type: string) => ({
      id,
      name,
      config: { template_type },
    });
    expect(
      studioBackgroundOptions([
        entry('MNI152NLin2009cAsym_T1w_2mm', 'MNI152 T1w (2mm)', 'T1w'),
        entry('MNI152NLin2009cAsym_mask_1mm', 'MNI152 Brain Mask (1mm)', 'mask'),
        entry('MNI152NLin2009cAsym_GM_1mm', 'MNI152 Gray Matter (1mm)', 'GM'),
        entry('MNI152NLin2009cAsym_brain_1mm', 'MNI152 Skull-stripped Brain (1mm)', 'brain'),
        entry('MNI152NLin2009cAsym_T1w_1mm', 'MNI152 T1w (1mm)', 'T1w'),
        { id: 7 },
        null,
      ]),
    ).toEqual([
      { value: 'template:MNI152NLin2009cAsym_brain_1mm', label: 'MNI152 Skull-stripped Brain (1mm)' },
      { value: T1, label: 'MNI152 T1w (1mm)' },
      { value: 'template:MNI152NLin2009cAsym_T1w_2mm', label: 'MNI152 T1w (2mm)' },
    ]);
    expect(studioBackgroundOptions({ not: 'a list' })).toEqual([]);
  });

  it('keeps the current value selectable when the catalog does not list it', () => {
    const options = [{ value: T1, label: 'MNI152 T1w (1mm)' }];
    expect(withCurrentBackground(options, T1)).toEqual(options);
    expect(withCurrentBackground(options, null)).toEqual(options);
    expect(withCurrentBackground(options, 'template:Custom_T1w')[0]).toEqual({
      value: 'template:Custom_T1w',
      label: 'Custom_T1w',
    });
  });
});

/** A row-major voxel-to-world matrix from three rows of (x, y, z, offset). */
const affine = (rows: number[][]): number[] => [...rows.flat(), 0, 0, 0, 1];
/** An axis-aligned header: `step` mm per voxel from a first voxel centre at `first`. */
const header = (
  dims: number[],
  step: number[],
  first: number[],
  codes: [number, number] = [1, 1],
): StudioGridHeader => ({
  dims,
  voxelToWorld: affine([
    [step[0], 0, 0, first[0]],
    [0, step[1], 0, first[1]],
    [0, 0, step[2], first[2]],
  ]),
  sformCode: codes[0],
  qformCode: codes[1],
});

/** The header the owner's folder of maps has: scanner codes, half-voxel origin. */
const REAL = header([91, 109, 91], [2, 2, 2], [-90.5, -126.5, -72.5]);
const NLIN6 = 'template:MNI152NLin6Asym_T1w_1mm';

describe('matchTemplateLattice', () => {
  it('recognises the MNI152 2 mm lattice with a half-voxel origin and scanner codes', () => {
    expect(matchTemplateLattice(REAL)).toBe('MNI152NLin6Asym');
    expect(matchTemplateLattice(header([91, 109, 91], [2, 2, 2], [-90, -126, -72]))).toBe(
      'MNI152NLin6Asym',
    );
  });

  it('recognises the 1 mm lattices and the 2009c ones', () => {
    expect(matchTemplateLattice(header([182, 218, 182], [1, 1, 1], [-91, -126, -72]))).toBe(
      'MNI152NLin6Asym',
    );
    expect(matchTemplateLattice(header([97, 115, 97], [2, 2, 2], [-96, -132, -78]))).toBe(
      'MNI152NLin2009cAsym',
    );
    // As TemplateFlow ships res-02: half a voxel off the 1 mm lattice.
    expect(matchTemplateLattice(header([97, 115, 97], [2, 2, 2], [-96.5, -132.5, -78.5]))).toBe(
      'MNI152NLin2009cAsym',
    );
    expect(matchTemplateLattice(header([193, 229, 193], [1, 1, 1], [-96, -132, -78]))).toBe(
      'MNI152NLin2009cAsym',
    );
  });

  it('does not match the same matrix placed three voxels away', () => {
    expect(matchTemplateLattice(header([91, 109, 91], [2, 2, 2], [-84, -126, -72]))).toBeNull();
    expect(matchTemplateLattice(header([91, 109, 91], [2, 2, 2], [-90, -126, -78]))).toBeNull();
    // One voxel is the tolerance; a little more is not.
    expect(matchTemplateLattice(header([91, 109, 91], [2, 2, 2], [-92, -126, -72]))).toBe(
      'MNI152NLin6Asym',
    );
    expect(matchTemplateLattice(header([91, 109, 91], [2, 2, 2], [-92.1, -126, -72]))).toBeNull();
  });

  it('matches a left-right flipped affine, compared in world space', () => {
    expect(matchTemplateLattice(header([91, 109, 91], [-2, 2, 2], [90, -126, -72]))).toBe(
      'MNI152NLin6Asym',
    );
  });

  it('matches permuted voxel axes that are each along one world axis', () => {
    // Voxel axes (j, i, k) -> world (y, x, z): the matrix is 109 x 91 x 91 on file.
    expect(
      matchTemplateLattice({
        dims: [109, 91, 91],
        voxelToWorld: affine([
          [0, 2, 0, -90],
          [2, 0, 0, -126],
          [0, 0, 2, -72],
        ]),
      }),
    ).toBe('MNI152NLin6Asym');
  });

  it('does not match an oblique affine', () => {
    const c = Math.cos(0.05) * 2;
    const s = Math.sin(0.05) * 2;
    expect(
      matchTemplateLattice({
        dims: [91, 109, 91],
        voxelToWorld: affine([
          [c, -s, 0, -90],
          [s, c, 0, -126],
          [0, 0, 2, -72],
        ]),
      }),
    ).toBeNull();
  });

  it('does not match another voxel size or matrix, however brain-sized the box', () => {
    expect(matchTemplateLattice(header([91, 109, 91], [3, 3, 3], [-90, -126, -72]))).toBeNull();
    // The same field of view on a 3 mm grid: a brain-sized box is not evidence.
    expect(matchTemplateLattice(header([61, 73, 61], [3, 3, 3], [-90, -126, -72]))).toBeNull();
    expect(matchTemplateLattice(header([91, 109, 90], [2, 2, 2], [-90, -126, -72]))).toBeNull();
  });

  it('gives nothing for a malformed header', () => {
    expect(matchTemplateLattice({ dims: [91, 109], voxelToWorld: REAL.voxelToWorld })).toBeNull();
    expect(matchTemplateLattice({ dims: [91, 109, 91], voxelToWorld: [1, 2, 3] })).toBeNull();
    expect(
      matchTemplateLattice({ dims: [91, 109, 91], voxelToWorld: new Array(16).fill(Number.NaN) }),
    ).toBeNull();
    expect(studioGridEvidence('set', 'm', { dims: [91, 109, 91], voxelToWorld: [] })).toBeNull();
  });
});

describe('grid evidence', () => {
  const UNKNOWN = [64, 64, 36];
  const evidence = (h: StudioGridHeader, memberId = 'm1') => studioGridEvidence('set', memberId, h);
  const resolve = (h: StudioGridHeader, more: Record<string, unknown> = {}) => {
    const args = [null, 'set', 'Folder of maps', { grid: evidence(h), ...more }] as const;
    return { ...resolveStudioBackground(...args), note: resolveStudioBackgroundNote(...args) };
  };

  it('records the grid in file order, the matched space and the header space', () => {
    expect(evidence(REAL)).toEqual({
      setId: 'set',
      memberId: 'm1',
      dims: [91, 109, 91],
      voxelMm: [2, 2, 2],
      space: 'MNI152NLin6Asym',
      headerSpace: null,
    });
    expect(evidence(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [4, 1]))?.headerSpace).toBe(
      'MNI152',
    );
    expect(evidence(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [2, 4]))?.headerSpace).toBe(
      'MNI152',
    );
    expect(evidence(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [3, 0]))?.headerSpace).toBe(
      'Talairach',
    );
  });

  it('a grid match fills the template in, and says it came from this image', () => {
    expect(resolve(REAL)).toEqual({
      sourcePath: NLIN6,
      issue: null,
      origin: 'grid',
      note: "MNI152 grid matched from this image (91 × 109 × 91, 2 mm); the other images were not checked.",
    });
  });

  it('an MNI152 header code on an unknown grid only suggests choosing', () => {
    expect(resolve(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [4, 4]))).toEqual({
      sourcePath: null,
      issue: 'space not declared',
      origin: 'space',
      note: "This image's header says MNI152 space; choose a template.",
    });
    const talairach = resolve(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [3, 3]));
    expect(talairach.sourcePath).toBeNull();
    expect(talairach.note).toBe("This image's header says Talairach space; there is no template for it.");
  });

  it('scanner and aligned codes on an unknown grid give nothing', () => {
    for (const codes of [
      [1, 1],
      [2, 2],
      [0, 0],
      [1, 2],
    ] as [number, number][])
      expect(resolve(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], codes))).toEqual({
        sourcePath: null,
        issue: 'space not declared',
        origin: 'space',
        note: null,
      });
  });

  it("the user's choice and an explicit None beat a grid match", () => {
    const grid = evidence(REAL);
    expect(resolveStudioBackground({ setId: 'set', sourcePath: T1 }, 'set', 'Folder', { grid })).toEqual(
      { sourcePath: T1, issue: null, origin: 'chosen' },
    );
    expect(
      resolveStudioBackground({ setId: 'set', sourcePath: null }, 'set', 'Folder', { grid }),
    ).toEqual({ sourcePath: null, issue: null, origin: 'chosen' });
    expect(
      resolveStudioBackgroundNote({ setId: 'set', sourcePath: null }, 'set', 'Folder', { grid }),
    ).toBeNull();
    // A choice made for another set is not this set's.
    expect(
      resolveStudioBackground({ setId: 'other', sourcePath: null }, 'set', 'Folder', { grid }).origin,
    ).toBe('grid');
  });

  it('a declared space beats a grid match, also one the app has no template for', () => {
    const grid = evidence(REAL);
    expect(resolveStudioBackground(null, 'set', DECLARED, { grid })).toEqual({
      sourcePath: DEFAULT,
      issue: null,
      origin: 'space',
    });
    expect(resolveStudioBackgroundNote(null, 'set', DECLARED, { grid })).toBeNull();
    expect(resolveStudioBackground(null, 'set', 'T1w (sub-01)', { grid })).toEqual({
      sourcePath: null,
      issue: 'no template for T1w',
      origin: 'space',
    });
  });

  it("ignores another set's evidence", () => {
    const grid = studioGridEvidence('other', 'm1', REAL);
    expect(resolveStudioBackground(null, 'set', 'Folder', { grid }).sourcePath).toBeNull();
    expect(resolveStudioBackground(null, null, 'Folder', { grid }).sourcePath).toBeNull();
  });

  const AUDITED = '91×109×91 voxels · 2.00×2.00×2.00 mm (sampled)';

  it("covers the whole set only on the set's own audit of that grid", () => {
    const grid = evidence(REAL);
    const audited = { grid, alignmentClass: 'same-grid' };
    expect(resolveStudioBackgroundNote(null, 'set', AUDITED, audited)).toBe(
      'MNI152 grid matched from the images (91 × 109 × 91, 2 mm); not declared by the files.',
    );
    expect(resolveStudioBackground(null, 'set', AUDITED, audited).origin).toBe('grid');
    // Not audited as one grid, or audited as another grid: this image only.
    for (const [label, alignmentClass] of [
      [AUDITED, 'unknown'],
      ['header audit incomplete', 'unknown'],
      ['mixed volume grids (sampled)', 'mixed'],
      ['97×115×97 voxels · 2.00×2.00×2.00 mm (sampled)', 'same-grid'],
      ['91×109×91 voxels · 3.00×3.00×3.00 mm (sampled)', 'same-grid'],
    ])
      expect(resolveStudioBackgroundNote(null, 'set', label, { grid, alignmentClass })).toMatch(
        /^MNI152 grid matched from this image /,
      );
  });

  it('gives Population the grid default only on the audited set grid', () => {
    const grid = evidence(REAL);
    expect(
      resolveStudioBackground(null, 'set', AUDITED, {
        grid,
        alignmentClass: 'same-grid',
        lens: 'population',
      }),
    ).toEqual({ sourcePath: NLIN6, issue: null, origin: 'grid' });
    for (const lens of ['deck', 'compare'])
      expect(resolveStudioBackground(null, 'set', 'Folder', { grid, lens }).sourcePath).toBe(NLIN6);
    const population = { grid, lens: 'population' };
    expect(resolveStudioBackground(null, 'set', 'Folder', population)).toEqual({
      sourcePath: null,
      issue: 'space not declared',
      origin: 'space',
    });
    expect(resolveStudioBackgroundNote(null, 'set', 'Folder', population)).toBeNull();
    // Nor a header-code suggestion about one member.
    const coded = evidence(header(UNKNOWN, [3, 3, 4], [-96, -96, -60], [4, 4]));
    expect(
      resolveStudioBackgroundNote(null, 'set', 'Folder', { grid: coded, lens: 'population' }),
    ).toBeNull();
  });
});

describe('space- entity in member file names', () => {
  const paths = (...names: (string | null)[]) => ({
    members: names.map((name) => ({ sourcePath: name === null ? null : `/data/sub-01/${name}` })),
  });
  const bold = (space: string, sub = '01') => `sub-${sub}_task-x_space-${space}_stat-t_statmap.nii.gz`;
  const resolve = (evidence: Parameters<typeof resolveStudioBackground>[3]) => ({
    ...resolveStudioBackground(null, 'set', 'Folder of maps', evidence),
    note: resolveStudioBackgroundNote(null, 'set', 'Folder of maps', evidence),
  });

  it('declares the space when every member file name carries the same known label', () => {
    expect(resolve(paths(bold('MNI152NLin2009cAsym'), bold('MNI152NLin2009cAsym', '02')))).toEqual({
      sourcePath: DEFAULT,
      issue: null,
      origin: 'space',
      note: null,
    });
    // Members without a file are not counted against it.
    expect(resolve(paths(bold('MNI152NLin6Asym'), null, '')).sourcePath).toBe(NLIN6);
    // The label is an entity of the file name, not of a folder.
    expect(
      resolve({ members: [{ sourcePath: '/data/space-MNI152NLin6Asym/sub-01_statmap.nii.gz' }] })
        .sourcePath,
    ).toBeNull();
  });

  it('a unanimous label the app has no template for is declared, and gets none', () => {
    const grid = studioGridEvidence('set', 'm1', REAL);
    expect(resolve({ ...paths(bold('T1w'), bold('T1w', '02')), grid })).toEqual({
      sourcePath: null,
      issue: 'no template for T1w',
      origin: 'space',
      note: null,
    });
  });

  it('mixed or partial labels declare nothing, and rule out a grid default', () => {
    const grid = studioGridEvidence('set', 'm1', REAL);
    const none = { sourcePath: null, issue: 'space not declared', origin: 'space', note: null };
    expect(resolve(paths(bold('MNI152NLin2009cAsym'), bold('MNI152NLin6Asym', '02')))).toEqual(none);
    expect(
      resolve({ ...paths(bold('MNI152NLin2009cAsym'), bold('MNI152NLin6Asym', '02')), grid }),
    ).toEqual(none);
    expect(resolve({ ...paths(bold('MNI152NLin6Asym'), 'sub-02_statmap.nii.gz'), grid })).toEqual(
      none,
    );
    // No labels at all: the grid decides.
    expect(resolve({ ...paths('same_item.nii.gz', 'other_item.nii.gz'), grid }).origin).toBe('grid');
  });

  it('the support label wins over the file names, and a choice is noted against either', () => {
    const named = paths(bold('MNI152NLin6Asym'));
    expect(resolveStudioBackground(null, 'set', DECLARED, named).sourcePath).toBe(DEFAULT);
    const choice = { setId: 'set', sourcePath: T1 };
    expect(resolveStudioBackgroundNote(choice, 'set', 'Folder', named)).toBe(
      "Not the set's declared space (MNI152NLin6Asym).",
    );
    expect(resolveStudioBackgroundNote({ setId: 'set', sourcePath: NLIN6 }, 'set', 'Folder', named)).toBeNull();
  });
});

describe('active set selectors with grid evidence', () => {
  const state = (more: Partial<StudioBackgroundState> = {}): StudioBackgroundState => ({
    selection: { activeSetId: 'set', activeLens: 'deck' },
    sets: {
      set: {
        supportLabel: 'headers not sampled',
        alignmentClass: 'unknown',
        memberSummaries: [{ sourcePath: '/maps/sub-1006/enc_rep/maps/same_item.nii.gz' }],
      },
    },
    studioBackground: null,
    studioGridEvidence: studioGridEvidence('set', 'm1', REAL),
    ...more,
  });

  it('fills the matched template in as the current value, with its note', () => {
    expect(selectStudioBackgroundPath(state())).toBe(NLIN6);
    expect(activeStudioBackground(state()).origin).toBe('grid');
    expect(selectStudioBackgroundNote(state())).toMatch(/^MNI152 grid matched from this image /);
  });

  it('an explicit None after the automatic fill sticks', () => {
    const none = state({ studioBackground: { setId: 'set', sourcePath: null } });
    expect(selectStudioBackgroundPath(none)).toBeNull();
    expect(selectStudioBackgroundNote(none)).toBeNull();
    expect(activeStudioBackground(none).origin).toBe('chosen');
  });

  it('keeps Population on its own evidence', () => {
    const population = state({ selection: { activeSetId: 'set', activeLens: 'population' } });
    expect(selectStudioBackgroundPath(population)).toBeNull();
    const audited = state({
      selection: { activeSetId: 'set', activeLens: 'population' },
      sets: {
        set: {
          supportLabel: '91×109×91 voxels · 2.00×2.00×2.00 mm (sampled)',
          alignmentClass: 'same-grid',
          memberSummaries: [],
        },
      },
    });
    expect(selectStudioBackgroundPath(audited)).toBe(NLIN6);
    expect(selectStudioBackgroundNote(audited)).toMatch(/^MNI152 grid matched from the images /);
  });
});
