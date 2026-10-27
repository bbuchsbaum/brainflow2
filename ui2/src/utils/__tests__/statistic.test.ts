import { describe, expect, it } from 'vitest';
import type { StatisticInfo } from '@brainflow/api';
import {
  describeStatistic,
  formatStatisticValue,
  statisticSignAssumed,
  splitStatisticSymbol,
  statisticPhrase,
  splitStatisticSymbol,
  isInferredStatistic,
  statisticLongName,
  inferStatisticFromName,
  statisticVariable,
  statisticUnits,
} from '../statistic';

const stat = (over: Partial<StatisticInfo>): StatisticInfo => ({
  kind: 'z',
  intentCode: 5,
  intentParams: [0, 0, 0],
  intentName: '',
  dof: [],
  label: 'z',
  fromDescription: false,
  positiveDataLabel: null,
  ...over,
});

const T24 = stat({ kind: 't', intentCode: 3, intentParams: [24, 0, 0], intentName: 't-stat', dof: [24], label: 't(24)' });
const LOG10P = stat({ kind: 'log10p', intentCode: 24, label: 'log10(p)', positiveDataLabel: '−log10(p)' });

describe('statisticUnits', () => {
  it('uses the backend label for statistics', () => {
    expect(statisticUnits(stat({}))).toBe('z');
    expect(statisticUnits(T24)).toBe('t(24)');
  });

  it('is null for plain images, label volumes and data intents', () => {
    expect(statisticUnits(undefined)).toBeNull();
    expect(statisticUnits(stat({ kind: 'none', intentCode: 0, label: '' }))).toBeNull();
    expect(statisticUnits(stat({ kind: 'label', intentCode: 1002, label: 'label' }))).toBeNull();
    expect(statisticUnits(stat({ kind: 'data', intentCode: 2003, label: '' }))).toBeNull();
  });

  it('reads a non-negative log-p map as −log10(p), with the sign marked as assumed', () => {
    expect(statisticUnits(LOG10P, { min: -3, max: 0 })).toBe('log10(p)');
    expect(statisticUnits(LOG10P, { min: 0, max: 7.2 })).toBe('−log10(p)');
    expect(statisticSignAssumed(LOG10P, { min: 0, max: 7.2 })).toBe(true);
    expect(statisticSignAssumed(LOG10P, null)).toBe(false);
    expect(statisticSignAssumed(T24, { min: 0, max: 7 })).toBe(false);
  });
});

describe('formatStatisticValue / describeStatistic', () => {
  it('prefixes the statistic to the formatted value', () => {
    expect(formatStatisticValue('5.97', stat({}))).toBe('z 5.97');
    expect(formatStatisticValue('6.76', T24)).toBe('t(24) 6.76');
    expect(formatStatisticValue('235', undefined)).toBe('235');
  });

  it('names the source of the statistic', () => {
    expect(describeStatistic(T24)).toBe('t(24) · t-stat');
    expect(describeStatistic(stat({}))).toBe('z · intent 5');
    expect(describeStatistic(stat({ kind: 't', intentCode: 0, label: 't(18)', fromDescription: true }))).toBe(
      't(18) · SPM description',
    );
    expect(describeStatistic(LOG10P, { min: 0, max: 4 })).toBe('−log10(p) · intent 24 (sign assumed)');
  });
});

describe('splitStatisticSymbol', () => {
  it('italicises the variable only', () => {
    expect(splitStatisticSymbol('z')).toEqual([{ text: 'z', italic: true }]);
    expect(splitStatisticSymbol('t(24)')).toEqual([
      { text: 't', italic: true },
      { text: '(24)', italic: false },
    ]);
    expect(splitStatisticSymbol('χ²(3)')).toEqual([
      { text: 'χ', italic: true },
      { text: '²(3)', italic: false },
    ]);
    expect(splitStatisticSymbol('−log10(p)')).toEqual([
      { text: '−log10(', italic: false },
      { text: 'p', italic: true },
      { text: ')', italic: false },
    ]);
    expect(splitStatisticSymbol('beta')).toEqual([{ text: 'beta', italic: false }]);
  });
});

describe('statistic wording (v1 critics)', () => {
  it('phrases the Data card row', () => {
    expect(statisticPhrase(stat({}))).toEqual({ variable: 'z', rest: ' score' });
    expect(statisticPhrase(T24)).toEqual({ variable: 't(24)', rest: '' });
    expect(statisticPhrase(stat({ kind: 'f', intentCode: 4, dof: [2, 30], label: 'F(2,30)' }))).toEqual({
      variable: 'F(2,30)',
      rest: '',
    });
    expect(statisticPhrase(stat({ kind: 'none', label: '' }))).toBeNull();
  });

  it('speaks the symbol in full', () => {
    expect(statisticLongName('t(24)')).toBe('t statistic, 24 degrees of freedom');
    expect(statisticLongName('F(2,30)')).toBe('F statistic, 2 and 30 degrees of freedom');
    expect(statisticLongName('z')).toBe('z score');
    expect(statisticLongName('\u2212log10(p)')).toBe('negative log 10 p value');
    expect(statisticLongName('z*')).toBe('z score, inferred from file name');
    expect(statisticLongName('t*')).toBe('t statistic, inferred from file name');
  });

  it('guesses z / t from FSL names only, and marks the guess', () => {
    const z = inferStatisticFromName('task-motor_zstat1.nii.gz', 'f32');
    expect(z).toMatchObject({ kind: 'z', label: 'z', intentCode: 0 });
    expect(isInferredStatistic(z)).toBe(true);
    expect(inferStatisticFromName('tstat2.nii.gz')).toMatchObject({ kind: 't', label: 't', dof: [] });
    expect(inferStatisticFromName('thresh_zstat1.nii.gz')).toMatchObject({ kind: 'z' });
    expect(inferStatisticFromName('cope1.nii.gz')).toBeNull();
    expect(inferStatisticFromName('sub-01_T1w.nii.gz')).toBeNull();
  });

  it('does not guess for FSL randomise p maps or cluster images (v2 fidelity)', () => {
    for (const name of [
      'grot_tfce_corrp_tstat1.nii.gz',
      'grot_vox_p_tstat1.nii.gz',
      'grot_tfce_p_tstat2.nii.gz',
      'grot_vox_corrp_tstat1.nii.gz',
      'cluster_mask_zstat1.nii.gz',
      'cluster_index_zstat1.nii.gz',
      'zstat1_mask.nii.gz',
      'rendered_thresh_zstat1.nii.gz',
    ]) {
      expect(inferStatisticFromName(name, 'f32'), name).toBeNull();
    }
    // Integer-typed z: a cluster index, not a z map.
    expect(inferStatisticFromName('zstat1.nii.gz', 'i16')).toBeNull();
    expect(inferStatisticFromName('zstat1.nii.gz', 'u8')).toBeNull();
  });

  it('drops a name-guessed t whose values lie in [0, 1]', () => {
    const t = inferStatisticFromName('tstat1.nii.gz', 'f32');
    expect(statisticUnits(t, { min: 0, max: 0.998 })).toBeNull();
    expect(statisticUnits(t, { min: -3.2, max: 5.1 })).toBe('t*');
  });

  it('names the threshold variable', () => {
    expect(statisticVariable('t(24)')).toBe('t');
    expect(statisticVariable(null)).toBe('value');
  });

  it('marks a guessed statistic on every surface: "z*" with its long name', () => {
    const z = inferStatisticFromName('zstat1.nii.gz', 'f32');
    expect(statisticUnits(z)).toBe('z*');
    expect(statisticVariable(statisticUnits(z))).toBe('z*');
    expect(splitStatisticSymbol('z*')).toEqual([
      { text: 'z', italic: true },
      { text: '*', italic: false },
    ]);
  });
});
