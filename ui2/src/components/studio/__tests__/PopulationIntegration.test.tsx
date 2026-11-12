import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { StudioInspectorPanel } from '../StudioInspectorPanel';
import { StudioToolbar } from '../StudioToolbar';
import { StudioLensSwitcher } from '../StudioLensSwitcher';
import { preparePopulationRestore } from '@/services/studio/PopulationRestoreService';
import { deriveWorkspaceReadiness } from '@/hooks/useStudioDerivedState';
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(cleanup);
it('routes the existing Inspector to live population settings and updates focus across roots', () => {
  useSetStudioStore.getState().setActiveLens('population');
  render(<StudioInspectorPanel />);
  expect(screen.getByRole('region', { name: 'Population inspector' })).toBeInTheDocument();
  expect(screen.queryByText('No active artifact')).not.toBeInTheDocument();
  const id =
    useSetStudioStore.getState().sets[useSetStudioStore.getState().selection.activeSetId!]
      .memberIds[0];
  act(() => useSetStudioStore.getState().setActiveMember(id));
  // C′: the focused subject heads the Inspector; the mask is in Analysis setup.
  expect(
    within(screen.getByTestId('population-focused-block')).getAllByText(id, { exact: true })[0],
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Analysis setup/ }));
  expect(screen.getByRole('button', { name: 'Choose mask…' })).toBeInTheDocument();
});
it('keeps study opening in the toolbar and prevents unsupported saved-source lens navigation', () => {
  const onSelectLens = vi.fn();
  render(
    <>
      <StudioToolbar setName="Study" dataStateLabel="Saved calculation" />
      <StudioLensSwitcher
        activeLens="population"
        populationOnly
        onSelectLens={onSelectLens}
        compareCohort={null}
        cohorts={[]}
        onSelectCompareCohort={() => {}}
      />
    </>,
  );
  // The set header has no menu of its own: opening a saved study is in the
  // lens row's one "⋯" menu (StudioHeader.test.tsx follows it there).
  expect(screen.queryByRole('button', { name: 'Open saved population…' })).toBeNull();
  expect(screen.queryByTitle('More')).toBeNull();
  // The single-subject view is opened from a subject, not offered here (B5).
  expect(screen.queryByRole('radio', { name: 'Subject' })).toBeNull();
  expect(screen.getByRole('radio', { name: 'Subject vs mean' })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Subject vs mean' }));
  expect(onSelectLens).not.toHaveBeenCalled();
  expect(screen.queryByText('Phase 2')).not.toBeInTheDocument();
});
it('describes verified saved inputs as population ready without promising legacy Compare', () => {
  const payload = preparePopulationRestore(
    {
      recordPath: '/record.json',
      recordSha256: 'a'.repeat(64),
      context: {},
      calculation: {
        contextKey: 'saved',
        members: [{ memberId: 'a', sourcePath: '/a.nii', expectedSha256: 'b'.repeat(64) }],
        workingMemberIds: ['a'],
        focusMemberId: 'a',
        crosshairMm: [0, 0, 0],
        orientation: 'axial',
        dimPx: [1, 1],
        summary: 'mean',
        zoom: 1,
      },
    },
    'workspace',
    1,
  );
  expect(deriveWorkspaceReadiness(payload.set)).toMatchObject({
    state: 'ready',
    eyebrow: 'Population ready',
  });
  expect(payload.set.ingestAudit.support.readyForCompare).toBe(false);
});
