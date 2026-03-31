import { describe, it, expect } from 'vitest';
import { parseBidsFilename, formatBidsDisplayName } from '../bids';

describe('parseBidsFilename', () => {
  it('parses a standard fMRI BOLD filename', () => {
    const result = parseBidsFilename('sub-01_task-rest_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz');
    expect(result).not.toBeNull();
    expect(result!.entities.sub).toBe('01');
    expect(result!.entities.task).toBe('rest');
    expect(result!.entities.space).toBe('MNI152NLin2009cAsym');
    expect(result!.entities.desc).toBe('preproc');
    expect(result!.suffix).toBe('bold');
    expect(result!.extension).toBe('.nii.gz');
  });

  it('parses a T1w anatomical', () => {
    const result = parseBidsFilename('sub-03_ses-02_T1w.nii.gz');
    expect(result).not.toBeNull();
    expect(result!.entities.sub).toBe('03');
    expect(result!.entities.ses).toBe('02');
    expect(result!.suffix).toBe('T1w');
  });

  it('parses a surface file', () => {
    const result = parseBidsFilename('sub-01_hemi-L_space-fsaverage_desc-thickness.shape.gii');
    expect(result).not.toBeNull();
    expect(result!.entities.hemi).toBe('L');
    expect(result!.entities.space).toBe('fsaverage');
    expect(result!.entities.desc).toBe('thickness');
    expect(result!.extension).toBe('.shape.gii');
  });

  it('parses with run entity', () => {
    const result = parseBidsFilename('sub-02_task-nback_run-03_bold.nii.gz');
    expect(result).not.toBeNull();
    expect(result!.entities.run).toBe('03');
    expect(result!.entities.task).toBe('nback');
  });

  it('returns null for non-BIDS filenames', () => {
    expect(parseBidsFilename('brain.nii.gz')).toBeNull();
    expect(parseBidsFilename('MNI152_T1_1mm.nii.gz')).toBeNull();
    expect(parseBidsFilename('results.csv')).toBeNull();
  });

  it('handles full path by extracting basename', () => {
    const result = parseBidsFilename('/data/bids/sub-01/func/sub-01_task-rest_bold.nii.gz');
    expect(result).not.toBeNull();
    expect(result!.entities.sub).toBe('01');
    expect(result!.entities.task).toBe('rest');
  });
});

describe('formatBidsDisplayName', () => {
  it('formats fMRI BOLD with task and context', () => {
    const parsed = parseBidsFilename('sub-01_task-rest_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz')!;
    const name = formatBidsDisplayName(parsed);
    expect(name).toBe('Rest BOLD (sub-01, MNI152, preproc)');
  });

  it('formats T1w anatomical', () => {
    const parsed = parseBidsFilename('sub-03_ses-02_T1w.nii.gz')!;
    const name = formatBidsDisplayName(parsed);
    expect(name).toBe('T1w (sub-03, ses-02)');
  });

  it('formats with run number', () => {
    const parsed = parseBidsFilename('sub-02_task-nback_run-03_bold.nii.gz')!;
    const name = formatBidsDisplayName(parsed);
    expect(name).toBe('Nback BOLD (sub-02, run-03)');
  });

  it('formats hemisphere labels', () => {
    const parsed = parseBidsFilename('sub-01_hemi-L_space-fsaverage_desc-thickness.shape.gii')!;
    const name = formatBidsDisplayName(parsed);
    expect(name).toContain('Left');
    expect(name).toContain('fsavg');
  });

  it('formats mask suffix', () => {
    const parsed = parseBidsFilename('sub-01_space-MNI152NLin2009cAsym_desc-brain_mask.nii.gz')!;
    const name = formatBidsDisplayName(parsed);
    expect(name).toBe('Mask (sub-01, MNI152, brain)');
  });
});
