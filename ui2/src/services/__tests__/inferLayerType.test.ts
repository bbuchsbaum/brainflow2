import { describe, it, expect } from 'vitest';
import { inferLayerTypeFromName, looksLikeSegmentation } from '../VolumeLoadingService';

describe('inferLayerTypeFromName', () => {
  it('classifies parcellation/atlas/segmentation files as label (-> nearest sampling)', () => {
    const segFiles = [
      'aparc+aseg.nii.gz',
      'wmparc.nii',
      'sub-01_desc-aparcaseg_dseg.nii.gz',
      'Schaefer2018_400Parcels_7Networks.nii.gz',
      'AAL3v1.nii',
      'HarvardOxford-cort-maxprob.nii.gz',
      'desikan_killiany.nii',
      'my_atlas.nii.gz',
      'lh.roi.nii',
    ];
    for (const f of segFiles) {
      expect(inferLayerTypeFromName(f, 'file')).toBe('label');
    }
  });

  it('does not misclassify continuous anatomical/functional volumes', () => {
    expect(inferLayerTypeFromName('sub-01_T1w.nii.gz', 'file')).toBe('anatomical');
    expect(inferLayerTypeFromName('MNI152_T1_1mm.nii.gz', 'file')).toBe('anatomical');
    expect(inferLayerTypeFromName('sub-01_task-rest_bold.nii.gz', 'file')).toBe('functional');
  });

  it('keeps binary masks as mask', () => {
    expect(inferLayerTypeFromName('brain_mask.nii.gz', 'file')).toBe('mask');
  });

  it('looksLikeSegmentation is conservative on plain anatomicals', () => {
    expect(looksLikeSegmentation('sub-01_t1w.nii.gz')).toBe(false);
    expect(looksLikeSegmentation('aparc+aseg.nii.gz')).toBe(true);
  });
});
