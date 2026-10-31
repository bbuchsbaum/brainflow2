import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudioComparePane } from '../StudioComparePane';
import { paneReasonText } from '../paneReasonText';
import type { StudioComparePaneSpec } from '@/types/studio';

const CACHE_REASON =
  'Derived cohort mean cache hit at /var/folders/9h/abc/T/brainflow_set_studio_cache/cohort-mean:2e0ba322f905e089.nii.gz.';

describe('Studio Compare pane text (QA F8)', () => {
  it('never shows a cache or file path', () => {
    expect(paneReasonText(CACHE_REASON)).toBe('Derived cohort mean cache hit.');
    expect(paneReasonText('Cohort mean materialization failed: cannot read /tmp/x/y/members.nii.gz')).toBe(
      'Cohort mean materialization failed: cannot read members.nii.gz',
    );
    expect(paneReasonText('C:\\Users\\me\\cache\\residual.nii.gz is missing.')).toBe(
      'residual.nii.gz is missing.',
    );
    expect(paneReasonText('No cohort selected.')).toBe('No cohort selected.');
    expect(paneReasonText(null)).toBeNull();
  });

  it('a ready pane without a body says so, not its cache record', () => {
    const pane = {
      id: 'cohort-mean',
      title: 'All members (n=72)',
      subtitle: 'Mean',
      status: 'ready',
      reason: CACHE_REASON,
      recipe: null,
      binding: { kind: 'derived_field', ready: true, cacheStatus: 'hit', sourcePath: '/var/x.nii.gz' },
    } as unknown as StudioComparePaneSpec;
    render(
      <StudioComparePane
        letter="B"
        accent="emerald"
        pane={pane}
        fallbackTitle="Cohort mean"
        fallbackSubtitle=""
        selected={false}
        isRefreshing={false}
        isAnyLoading={false}
        cohortMemberCount={72}
        cohortLabel="All members"
        cohortId="all"
        activeMemberId="s01"
        activeSet={null}
      />,
    );
    expect(screen.getByText('Map ready.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/brainflow_set_studio_cache|\/var\//);
  });
});
