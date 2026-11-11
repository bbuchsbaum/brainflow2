/**
 * Compare: the current member (A) and the group mean (B) are the same
 * quantity and share one colour scale; the residual (C) and z-score (D) are
 * other quantities and keep their own.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../StudioRenderAdapter', () => ({
  StudioRenderAdapter: () => <div data-testid="pane-a" />,
}));
const derivedProps = vi.hoisted(() => ({ seen: new Map<string, Record<string, unknown>>() }));
vi.mock('../StudioDerivedPaneCanvas', () => ({
  StudioDerivedPaneCanvas: (props: { paneId: string }) => {
    derivedProps.seen.set(props.paneId, props as never);
    return <div data-testid={`derived-${props.paneId}`} />;
  },
}));

import { CompareLens } from '../CompareLens';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const member = (intensity: [number, number], colormap = 'fmri') => ({
  id: 'member',
  name: 'member',
  volumeId: 'member',
  visible: true,
  opacity: 1,
  colormap,
  intensity,
  threshold: [intensity[0] / 10, intensity[1] / 10] as [number, number],
});

function showMember(layer: ReturnType<typeof member>) {
  const state = useViewStateStore.getState();
  act(() =>
    useViewStateStore.setState({
      viewState: { ...state.viewState, layers: [layer] as never },
      workspaceViewStates: new Map([
        ...state.workspaceViewStates,
        ['studio-ws', { ...state.viewState, layers: [layer] as never }],
      ]),
    } as never),
  );
}

let studioMap: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  derivedProps.seen.clear();
  useLayerStore.setState({
    layers: [{ id: 'member', name: 'member', volumeId: 'member', visible: true, order: 0, sourcePath: '/m/s01.nii' }],
  } as never);
  useWorkspaceStore.setState({
    workspaces: new Map([['studio-ws', { id: 'studio-ws', type: 'set-studio' } as never]]),
  } as never);
  studioMap = vi.spyOn(getStudioDisplayService(), 'isStudioMap').mockReturnValue(true);
  showMember(member([-0.0145, 0.0145]));
});
afterEach(() => {
  cleanup();
  studioMap.mockRestore();
});

const ready = (id: string) => ({
  id,
  title: id,
  status: 'ready',
  binding: { kind: 'derived_field', ready: true, cacheStatus: 'hit', sourcePath: `/c/${id}.nii.gz` },
});
const lens = () => (
  <CompareLens
    activeSet={{ supportKind: 'volume', supportLabel: 'MNI152NLin2009cAsym (2mm)', memberIds: ['s01'] } as never}
    activeFeature={null}
    activeArtifact={null}
    activeMemberId="s01"
    activeMember={{ id: 's01', sourcePath: '/m/s01.nii' } as never}
    compareCohort={null}
    cohorts={[]}
    activeExpression={null}
    paneSpecs={[ready('cohort-mean'), ready('residual'), ready('zscore')] as never}
    loading={false}
    refreshingPaneIds={[]}
    onSelectCohort={vi.fn()}
    onDrillToCohort={vi.fn()}
    onOpenPane={vi.fn()}
    onInspectPane={vi.fn()}
    onInspectCurrent={vi.fn()}
    onOpenCurrentSource={vi.fn()}
    onOpenCompareView={vi.fn()}
    onRecomputePane={vi.fn()}
  />
);
const paneB = () => screen.getByRole('article', { name: /^B / });

it('B is drawn with the member’s display; C and D keep their own', () => {
  render(lens());
  expect(derivedProps.seen.get('cohort-mean')).toMatchObject({
    shareMemberScale: true,
    sharedDisplay: {
      colormap: 'fmri',
      intensity: [-0.0145, 0.0145],
      threshold: member([-0.0145, 0.0145]).threshold,
    },
  });
  for (const id of ['residual', 'zscore'])
    expect(derivedProps.seen.get(id)).toMatchObject({ shareMemberScale: false, sharedDisplay: null });
});

it('says so once, under B, with the window in full and tabular numerals', () => {
  render(lens());
  const notes = screen.getAllByTestId('studio-pane-scale-note');
  expect(notes).toHaveLength(1);
  expect(within(paneB()).getByTestId('studio-pane-scale-note')).toHaveTextContent('A and B share ±0.0145');
  expect(notes[0].className).toContain('tabular-nums');
});

it('follows a window the user sets for the member', () => {
  render(lens());
  showMember(member([-0.005, 0.02], 'viridis'));
  expect(derivedProps.seen.get('cohort-mean')).toMatchObject({
    sharedDisplay: { colormap: 'viridis', intensity: [-0.005, 0.02] },
  });
  expect(screen.getByTestId('studio-pane-scale-note')).toHaveTextContent('A and B share −0.005 to 0.02');
});

it('the pane’s menu gives the mean its own scale, and shares it again', () => {
  render(lens());
  fireEvent.click(within(paneB()).getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Use its own scale' }));
  expect(derivedProps.seen.get('cohort-mean')).toMatchObject({ shareMemberScale: false });
  expect(screen.queryByTestId('studio-pane-scale-note')).toBeNull();
  fireEvent.click(within(paneB()).getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share the scale of A' }));
  expect(derivedProps.seen.get('cohort-mean')).toMatchObject({ shareMemberScale: true });
  expect(screen.getByTestId('studio-pane-scale-note')).toBeInTheDocument();
  // No such entry on the panes that never share.
  fireEvent.click(within(screen.getByRole('article', { name: /^C / })).getByRole('button', { name: 'More actions' }));
  expect(screen.queryByRole('menuitem', { name: /scale/i })).toBeNull();
});

it('a member the Studio does not draw by its rule shares nothing: B keeps its own scale', () => {
  studioMap.mockReturnValue(false);
  render(lens());
  expect(derivedProps.seen.get('cohort-mean')).toMatchObject({ sharedDisplay: null });
  expect(screen.queryByTestId('studio-pane-scale-note')).toBeNull();
  fireEvent.click(within(paneB()).getByRole('button', { name: 'More actions' }));
  expect(screen.queryByRole('menuitem', { name: /scale/i })).toBeNull();
});
