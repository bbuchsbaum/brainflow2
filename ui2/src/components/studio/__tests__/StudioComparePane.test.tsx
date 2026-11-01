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

  it('a long title shrinks inside its header, and a clipped footer carries its full provenance (review of 456128a2)', () => {
    const longTitle = 'All members of the matched controls cohort, Site A, scanner 2 (n=72)';
    const pane = {
      id: 'cohort-mean',
      title: longTitle,
      subtitle: 'Mean',
      status: 'ready',
      reason: null,
      recipe: 'reducer: Mean; norm: z',
      binding: { kind: 'derived_field', ready: true, cacheStatus: 'hit', sourcePath: '/x.nii.gz' },
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
        cohortId={null}
        activeMemberId="s01"
        activeSet={{ supportLabel: 'MNI152NLin2009cAsym (2mm)' } as never}
      />,
    );
    const title = screen.getByText(longTitle);
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('truncate');
    expect(title.className).not.toContain('shrink-0');
    expect(title.parentElement!.className).toContain('overflow-hidden');
    const footer = screen.getByRole('article').querySelector('footer')!;
    expect(footer.getAttribute('title')).toBe(
      'n=72 · Reducer Mean · Norm z · Support MNI152NLin2009cAsym (2mm)',
    );
    // The last chip truncates instead of clipping at the pane edge.
    const support = screen.getByTitle('Support MNI152NLin2009cAsym (2mm)');
    expect(support.className).toMatch(/\bshrink\b/);
    expect(support.className).toContain('min-w-0');
  });
});
