import { describe, expect, it } from 'vitest';
import { inferFileType } from '../inferFileType';

describe('inferFileType badges', () => {
  it('names GIfTI label and shape files instead of a bare GII', () => {
    expect(inferFileType('/s/lh.aparc.label.gii', false)).toMatchObject({ kind: 'gii', badge: 'LABEL' });
    expect(inferFileType('/s/lh.thickness.shape.gii', false)).toMatchObject({ kind: 'gii', badge: 'SHAPE' });
    expect(inferFileType('/s/lh.pial.surf.gii', false).badge).toBe('SURF');
    expect(inferFileType('/s/lh.func.gii', false).badge).toBe('FUNC');
    expect(inferFileType('/s/other.gii', false).badge).toBe('GII');
  });

  it('treats .nii and .nii.gz the same way: 4D only once known', () => {
    expect(inferFileType('/s/oblique4d.nii', false).badge).toBe('NII');
    expect(inferFileType('/s/oblique4d.nii.gz', false).badge).toBe('NII');
    expect(inferFileType('/s/oblique4d.nii', false, { isFourD: true }).badge).toBe('4D');
    expect(inferFileType('/s/oblique4d.nii.gz', false, { isFourD: true }).badge).toBe('4D');
  });
});
