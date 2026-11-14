import { describe, expect, it } from 'vitest';
import { describeKindGrouping, groupImagesByKind, type KindGrouping } from '../imageSetKinds';

const items = (names: string[]) => names.map((name) => ({ name, path: `/d/${name}` }));
const cross = (stems: string[], endings: string[], ext = '.nii.gz') =>
  stems.flatMap((stem) => endings.map((ending) => `${stem}_${ending}${ext}`));
/** label → member count, in chip order. */
const summary = (grouping: KindGrouping | null) =>
  grouping ? Object.fromEntries(grouping.groups.map((g) => [g.label, g.paths.length])) : null;
const total = (grouping: KindGrouping) =>
  grouping.groups.reduce((sum, group) => sum + group.paths.length, 0);

const CONTRASTS = [
  'contrast-mod_cue_new',
  'contrast-mod_cue_old',
  'contrast-mod_probe_new',
  'contrast-mod_probe_old',
  'contrast-xnew_cue_new',
  'contrast-xold_cue_old',
  'contrast-xold_probe_old',
  'contrast-old_gt_new_cue',
  'contrast-old_gt_new_probe',
];
const KINDS = ['t_g', 'tfce', 'fwer', 'perm', 'beta_g', 'se_g'];
const WORKING = cross(CONTRASTS, KINDS);

describe('groupImagesByKind', () => {
  it('groups the working folder into six kinds of nine, keeping t_g whole', () => {
    const grouping = groupImagesByKind(items(WORKING));
    expect(grouping?.source).toBe('ending');
    expect(summary(grouping)).toEqual({ t_g: 9, tfce: 9, fwer: 9, perm: 9, beta_g: 9, se_g: 9 });
    expect(grouping?.stemCount).toBe(9);
    expect(describeKindGrouping(grouping!)).toBe('6 kinds × 9 names');
    const tfce = grouping!.groups.find((group) => group.label === 'tfce')!;
    expect(tfce.paths).toContain('/d/contrast-mod_cue_old_tfce.nii.gz');
    expect(tfce.paths.every((path) => path.endsWith('_tfce.nii.gz'))).toBe(true);
  });

  it('puts every image in exactly one group', () => {
    const names = [...WORKING, 'mask.nii.gz', 'mean_func.nii.gz'];
    const grouping = groupImagesByKind(items(names))!;
    expect(total(grouping)).toBe(names.length);
    expect(new Set(grouping.groups.flatMap((group) => group.paths)).size).toBe(names.length);
  });

  it('tolerates three missing images and two extras, which stay ungrouped', () => {
    const missing = new Set([
      'contrast-mod_cue_new_tfce.nii.gz',
      'contrast-xold_cue_old_perm.nii.gz',
      'contrast-old_gt_new_probe_se_g.nii.gz',
    ]);
    const names = [...WORKING.filter((name) => !missing.has(name)), 'mask.nii.gz', 'mean_func.nii.gz'];
    const grouping = groupImagesByKind(items(names));
    expect(summary(grouping)).toEqual({
      t_g: 9,
      tfce: 8,
      fwer: 9,
      perm: 8,
      beta_g: 9,
      se_g: 8,
      Ungrouped: 2,
    });
    expect(grouping!.groups.at(-1)).toMatchObject({ label: 'Ungrouped', other: true });
    expect(grouping!.stemCount).toBe(9);
  });

  it('offers nothing when too many images fit no kind', () => {
    const strays = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => `notes${s}.nii.gz`);
    expect(groupImagesByKind(items([...cross(['c-a', 'c-b', 'c-c'], ['t', 'tfce']), ...strays]))).toBeNull();
  });

  it('prefers the crossing with the most stems when two cover the same images', () => {
    const names = cross(['mod_cue', 'mod_probe', 'xold_cue', 'xold_probe'], ['t', 'tfce']);
    const grouping = groupImagesByKind(items(names));
    expect(summary(grouping)).toEqual({ t: 4, tfce: 4 });
    expect(grouping?.stemCount).toBe(4);
  });

  it('keeps a kind that is a longer form of another kind', () => {
    const grouping = groupImagesByKind(items(['a_g.nii', 'a_t_g.nii', 'b_g.nii', 'b_t_g.nii']));
    expect(summary(grouping)).toEqual({ g: 2, t_g: 2 });
  });

  it('never files an image under a kind on the strength of one ending', () => {
    const stems = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const grouping = groupImagesByKind(items([...cross(stems, ['g', 't_g'], '.nii'), 'zz_t_g.nii']));
    expect(summary(grouping)).toEqual({ g: 10, t_g: 10, Ungrouped: 1 });
    expect(grouping?.stemCount).toBe(10);
  });

  it('keeps a real ending called other apart from the ungrouped images', () => {
    const stems = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const grouping = groupImagesByKind(items([...cross(stems, ['t', 'other'], '.nii'), 'mask.nii']));
    expect(summary(grouping)).toEqual({ t: 10, other: 10, Ungrouped: 1 });
  });

  it('separates kinds that share a first part (t_g, t_p) from single-part kinds', () => {
    const grouping = groupImagesByKind(items(cross(['c-a', 'c-b', 'c-c'], ['t_g', 't_p', 'tfce'])));
    expect(summary(grouping)).toEqual({ t_g: 3, t_p: 3, tfce: 3 });
  });

  it('is fixed for a name whose own ending is a kind word', () => {
    // `x_old_t` is the contrast "x_old" with kind "t"; `y_t` is contrast "y".
    const grouping = groupImagesByKind(
      items(['x_old_t.nii', 'x_old_tfce.nii', 'y_t.nii', 'y_tfce.nii', 'z_t.nii', 'z_tfce.nii']),
    );
    expect(summary(grouping)).toEqual({ t: 3, tfce: 3 });
    expect(grouping?.stemCount).toBe(3);
  });

  it('ignores case and treats .nii and .nii.gz alike, labelling as first written', () => {
    const grouping = groupImagesByKind(
      items(['A_TFCE.nii', 'a_t.nii.gz', 'b_tfce.nii.gz', 'B_T.nii', 'c_Tfce.nii', 'c_t.nii']),
    );
    expect(summary(grouping)).toEqual({ TFCE: 3, t: 3 });
  });

  it('uses the stat- entity when names are made of BIDS entities', () => {
    const names = ['modCueOld', 'modCueNew', 'xold'].flatMap((c) =>
      ['t', 'tfce', 'p'].map((s) => `contrast-${c}_stat-${s}_statmap.nii.gz`),
    );
    const grouping = groupImagesByKind(items(names));
    expect(grouping?.source).toBe('entity');
    expect(summary(grouping)).toEqual({ t: 3, tfce: 3, p: 3 });
    expect(describeKindGrouping(grouping!)).toBe('3 kinds');
  });

  it('falls back from entities to desc-, then to the suffix', () => {
    const byDesc = ['01', '02'].flatMap((s) => ['preproc', 'smooth'].map((d) => `sub-${s}_desc-${d}_bold.nii.gz`));
    expect(summary(groupImagesByKind(items(byDesc)))).toEqual({ preproc: 2, smooth: 2 });
    const bySuffix = ['01', '02'].flatMap((s) => ['T1w', 'T2w'].map((x) => `sub-${s}_${x}.nii.gz`));
    expect(summary(groupImagesByKind(items(bySuffix)))).toEqual({ T1w: 2, T2w: 2 });
  });

  it('prefers the suffix to desc- when images differ in suffix', () => {
    const names = ['01', '02'].flatMap((s) => [
      `sub-${s}_desc-preproc_T1w.nii.gz`,
      `sub-${s}_desc-preproc_bold.nii.gz`,
      `sub-${s}_desc-brain_mask.nii.gz`,
    ]);
    expect(summary(groupImagesByKind(items(names)))).toEqual({ T1w: 2, bold: 2, mask: 2 });
  });

  it('removes only the trailing number, so T1 and T2 stay apart', () => {
    const names = ['T1_1', 'T1_2', 'T2_1', 'T2_2', 'FLAIR_1', 'FLAIR_2'].map((n) => `${n}.nii`);
    expect(summary(groupImagesByKind(items(names)))).toEqual({ T1: 2, T2: 2, FLAIR: 2 });
  });

  it('offers nothing for an FSL folder with more strays than the limit allows', () => {
    const names = ['zstat1', 'zstat2', 'thresh_zstat1', 'thresh_zstat2', 'mask', 'example_func'];
    expect(groupImagesByKind(items(names.map((n) => `${n}.nii.gz`)))).toBeNull();
  });

  it('groups FSL numbered names by the name without its number', () => {
    const names = [1, 2, 3].flatMap((n) => [`zstat${n}`, `cope${n}`, `varcope${n}`, `thresh_zstat${n}`]);
    const grouping = groupImagesByKind(items(names.map((n) => `${n}.nii.gz`)));
    expect(grouping?.source).toBe('numbered');
    expect(summary(grouping)).toEqual({ zstat: 3, cope: 3, varcope: 3, thresh_zstat: 3 });
  });

  it('groups SPM names by kind, never by contrast number', () => {
    const names = ['0001', '0002', '0003'].flatMap((n) => [`spmT_${n}.nii`, `con_${n}.nii`, `beta_${n}.nii`]);
    const grouping = groupImagesByKind(items([...names, 'ResMS.nii']));
    expect(grouping?.source).toBe('numbered');
    expect(summary(grouping)).toEqual({ spmT: 3, con: 3, beta: 3, Ungrouped: 1 });
  });

  it('offers nothing for unrelated names', () => {
    expect(
      groupImagesByKind(items(['anat.nii', 'mask_final.nii', 'template.nii.gz', 'brain2.nii', 'notes_old.nii'])),
    ).toBeNull();
  });

  it('offers nothing for a single-kind folder', () => {
    expect(groupImagesByKind(items(CONTRASTS.map((c) => `${c}_tfce.nii.gz`)))).toBeNull();
  });

  it('offers nothing for one name with several kinds, or for very few images', () => {
    expect(groupImagesByKind(items(cross(['contrast-a'], KINDS)))).toBeNull();
    expect(groupImagesByKind(items(['a_t.nii', 'b_t.nii', 'a_p.nii']))).toBeNull();
  });

  it('offers nothing when one kind holds nearly every image', () => {
    const names = [...Array.from({ length: 20 }, (_, i) => `s${i}_t.nii`), 's0_p.nii', 's1_p.nii'];
    expect(groupImagesByKind(items(names))).toBeNull();
  });

  it('does not treat a run number as a kind', () => {
    // Same shape as SPM's `con_0001`: the name is the kind, the number is not.
    const grouping = groupImagesByKind(items(cross(['sess_a', 'sess_b', 'sess_c'], ['1', '2'])));
    expect(grouping?.source).toBe('numbered');
    expect(summary(grouping)).toEqual({ sess_a: 2, sess_b: 2, sess_c: 2 });
  });
});
