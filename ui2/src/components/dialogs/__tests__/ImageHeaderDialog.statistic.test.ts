import { describe, expect, it } from 'vitest';
import { statisticFacts } from '@/utils/statistic';
import type { StatisticInfo } from '@brainflow/api';

const base: StatisticInfo = {
  kind: 't',
  intentCode: 3,
  intentParams: [24, 0, 0],
  intentName: 't-stat',
  dof: [24],
  label: 't(24)',
  fromDescription: false,
  positiveDataLabel: null,
};

const rows = (facts: ReturnType<typeof statisticFacts>) =>
  facts.filter(Boolean).map((f) => [f!.label, f!.value]);

describe('statisticFacts', () => {
  it('lists label, intent code and name, parameters and dof', () => {
    expect(rows(statisticFacts(base))).toEqual([
      ['Shown as', 't(24)'],
      ['Intent code', '3 (t-stat)'],
      ['Intent params', '24, 0, 0'],
      ['Degrees of freedom', '24'],
    ]);
  });

  it('says None for a plain image', () => {
    expect(rows(statisticFacts({ ...base, kind: 'none', intentCode: 0, label: '', dof: [] }))).toEqual([
      ['Statistic', 'None'],
    ]);
  });

  it('marks an SPM description source and an assumed log-p sign', () => {
    const spm = rows(statisticFacts({ ...base, intentCode: 0, intentName: '', fromDescription: true }));
    expect(spm[1]).toEqual(['Intent code', 'unset (read from description)']);
    const logp = rows(
      statisticFacts(
        { ...base, kind: 'log10p', intentCode: 24, intentName: '', dof: [], label: 'log10(p)', positiveDataLabel: '−log10(p)' },
        { min: 0, max: 5 },
      ),
    );
    expect(logp[0]).toEqual(['Shown as', '−log10(p)']);
    expect(logp[1][0]).toBe('Sign convention');
  });
});
