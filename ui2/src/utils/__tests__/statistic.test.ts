import { describe, expect, it } from 'vitest';
import type { StatisticInfo } from '@brainflow/api';
import {
  describeStatistic,
  formatStatisticValue,
  statisticSignAssumed,
  splitStatisticSymbol,
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
