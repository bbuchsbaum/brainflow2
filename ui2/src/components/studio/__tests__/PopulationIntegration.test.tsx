import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
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
  expect(screen.getByText(id, { exact: true })).toBeInTheDocument();
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
  expect(screen.getByRole('banner')).toContainElement(
    screen.getByRole('button', { name: 'Open saved population…' }),
  );
  expect(screen.getByRole('tab', { name: 'Deck' })).toBeDisabled();
  expect(screen.getByRole('tab', { name: 'Compare' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Deck' }));
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
