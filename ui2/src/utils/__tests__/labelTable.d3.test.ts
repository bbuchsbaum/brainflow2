import { describe, expect, it } from 'vitest';
import { looksLikeSegmentation, parseLabelTable } from '../labelTable';

describe('label detection by whole name tokens (review D3 / R12)', () => {
  it.each([
    'sub-01_desc-aseg_dseg.nii.gz',
    'sub-01_space-MNI152NLin2009cAsym_atlas-Schaefer2018_dseg.nii.gz',
    'aparc+aseg.mgz',
    'aparc.a2009s+aseg.nii.gz',
    'wmparc.mgz',
    'Yeo2011_7Networks_MNI152.nii.gz',
    'HarvardOxford-cort-maxprob-thr25-2mm.nii.gz',
    'AAL3v1.nii.gz',
    'synthseg.nii.gz',
    'atlas-synth3_dseg.nii.gz',
    'left_hippocampus_roi.nii.gz',
  ])('a segmentation: %s', (name) => {
    expect(looksLikeSegmentation(name.toLowerCase())).toBe(true);
  });

  it.each([
    'sub-01_task-eyeopen_bold.nii.gz', // "yeo" inside "eyeopen"
    'steroid_study_T1w.nii.gz', // "roi" inside "steroid"
    'android_scan.nii.gz',
    'sub-01_T1w.nii.gz',
    'sub-01_label-GM_probseg.nii.gz', // continuous probability map
    'zmap_synthetic.nii.gz',
    'parcelling_notes_T2w.nii.gz', // "parc" inside a word
    'sub-02_acq-seq3_T1w.nii.gz',
  ])('not a segmentation: %s', (name) => {
    expect(looksLikeSegmentation(name.toLowerCase())).toBe(false);
  });
});

describe('headerless LUT needs id, name and RGB on most rows (review D3)', () => {
  it('rejects a same-stem .txt of notes or numbers', () => {
    expect(parseLabelTable('12 34 56 78\n90 12 34 56\n')).toEqual([]);
    expect(parseLabelTable('1 scanner\n2 notes about the session\n')).toEqual([]);
    expect(parseLabelTable('3 TR 2.0 seconds\n4 TE 30 ms\n')).toEqual([]);
  });

  it('accepts a FreeSurfer LUT', () => {
    const lut = '# FreeSurferColorLUT\n0 Unknown 0 0 0 0\n2 Left-Cerebral-White-Matter 245 245 245 0\n17 Left-Hippocampus 220 216 20 0\n';
    expect(parseLabelTable(lut).map((e) => e.id)).toEqual([0, 2, 17]);
  });
});
