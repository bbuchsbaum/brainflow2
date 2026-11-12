import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// `loadFile` stands for the viewer-tab open (StudioDisplayService.openInViewerTab,
// tested on its own); the Studio's own display must not be asked for anything.
const { loadFile, ensureSourcePathDisplayed } = vi.hoisted(() => ({
  loadFile: vi.fn<(path: string) => Promise<string>>(async () => 'orthogonal-locked-1'),
  ensureSourcePathDisplayed: vi.fn(async () => {}),
}));
vi.mock('@/services/studio/StudioDisplayService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/studio/StudioDisplayService')>()),
  getStudioDisplayService: () => ({ ensureSourcePathDisplayed, openInViewerTab: loadFile }),
}));
vi.mock('../StudioRenderAdapter', () => ({
  StudioRenderAdapter: () => <div data-testid="pane-a" />,
}));
vi.mock('../StudioDerivedPaneCanvas', () => ({
  StudioDerivedPaneCanvas: ({ paneId }: { paneId: string }) => (
    <div data-testid={`derived-${paneId}`} />
  ),
}));

import { DeckLens } from '../DeckLens';
import { CompareLens } from '../CompareLens';
import { StudioComparePane } from '../StudioComparePane';
import {
  OPEN_IN_VIEWER_NOT_READY,
  OPEN_IN_VIEWER_NO_SOURCE,
} from '@/services/studio/studioOpenInViewer';
import type { SpatialFieldSetSummary, StudioComparePaneSpec } from '@/types/studio';

class NoResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
  loadFile.mockClear();
  ensureSourcePathDisplayed.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MEMBER_PATH = '/data/fir3d/sub-01_faces_beta.nii.gz';
const volumeSet = {
  id: 'fir3d',
  supportKind: 'volume',
  supportLabel: 'MNI 4 mm',
  memberIds: ['s01', 's02'],
  memberSummaries: [],
} as unknown as SpatialFieldSetSummary;

describe('Deck header', () => {
  const deck = (sourcePath: string | null) =>
    render(
      <DeckLens
        activeSet={volumeSet}
        activeFeature={null}
        activeMemberId="s01"
        activeMemberSourcePath={sourcePath}
        onSelectMember={vi.fn()}
      />,
    );

  it('offers no Inspect, and opens the member file in a new viewer tab', () => {
    deck(MEMBER_PATH);
    const header = screen.getByLabelText('Deck');
    expect(within(header).queryByRole('button', { name: 'Inspect' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Open source' })).toBeNull();
    const open = within(header).getByRole('button', { name: 'Open in viewer' });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(loadFile).toHaveBeenCalledWith(MEMBER_PATH);
    // The Studio's own view is not asked to show anything.
    expect(ensureSourcePathDisplayed).not.toHaveBeenCalled();
  });

  it('is disabled with its reason when the member has no file', () => {
    deck(null);
    const open = screen.getByRole('button', { name: 'Open in viewer' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', OPEN_IN_VIEWER_NO_SOURCE);
    fireEvent.click(open);
    expect(loadFile).not.toHaveBeenCalled();
  });
});

const pane = (
  id: StudioComparePaneSpec['id'],
  binding: Partial<NonNullable<StudioComparePaneSpec['binding']>> | null,
) =>
  ({
    id,
    title: id,
    subtitle: '',
    status: binding?.ready ? 'ready' : 'pending',
    binding: binding
      ? { kind: 'derived_field', ready: false, cacheStatus: 'hit', sourcePath: null, ...binding }
      : null,
  }) as unknown as StudioComparePaneSpec;

/** The entries of a pane's "More actions" menu, opened. */
function paneMenu(root: HTMLElement) {
  fireEvent.click(within(root).getByRole('button', { name: 'More actions' }));
  return within(within(root).getByRole('menu'));
}

describe('Compare pane menu', () => {
  const lens = (
    paneSpecs: StudioComparePaneSpec[],
    memberPath: string | null = MEMBER_PATH,
    onSelectPane?: (pane: StudioComparePaneSpec) => void,
  ) =>
    render(
      <CompareLens
        activeSet={volumeSet}
        activeFeature={null}
        activeArtifact={null}
        onSelectPane={onSelectPane}
        activeMemberId="s01"
        activeMember={{ id: 's01', sourcePath: memberPath } as never}
        compareCohort={null}
        cohorts={[]}
        activeExpression={null}
        paneSpecs={paneSpecs}
        loading={false}
        refreshingPaneIds={[]}
        onSelectCohort={vi.fn()}
        onDrillToCohort={vi.fn()}
        onOpenCompareView={vi.fn()}
        onRecomputePane={vi.fn()}
      />,
    );
  const paneRoot = (name: string | RegExp) => screen.getByRole('article', { name });

  it('opens the source (A) and a derived output (B) in a new viewer tab, with no Inspect', () => {
    lens([
      pane('current', { kind: 'member' as never, ready: true, sourcePath: MEMBER_PATH }),
      pane('cohort-mean', { ready: true, sourcePath: '/c/cohort-mean.nii.gz' }),
      pane('residual', { ready: false }),
      pane('zscore', { ready: true, sourcePath: '/c/zscore.nii.gz' }),
    ]);
    const a = paneMenu(paneRoot(/^A /));
    expect(a.queryByRole('menuitem', { name: 'Inspect' })).toBeNull();
    fireEvent.click(a.getByRole('menuitem', { name: 'Open in viewer' }));
    expect(loadFile).toHaveBeenLastCalledWith(MEMBER_PATH);

    const b = paneMenu(paneRoot(/cohort-mean/));
    expect(b.queryByRole('menuitem', { name: 'Inspect' })).toBeNull();
    expect(b.queryByRole('menuitem', { name: 'Open derived output' })).toBeNull();
    const openB = b.getByRole('menuitem', { name: 'Open in viewer' });
    expect(openB).toHaveAttribute('title', 'Open the derived map in a new viewer tab');
    fireEvent.click(openB);
    expect(loadFile).toHaveBeenLastCalledWith('/c/cohort-mean.nii.gz');
    expect(loadFile).toHaveBeenCalledTimes(2);
    expect(ensureSourcePathDisplayed).not.toHaveBeenCalled();
  });

  it('disables Open in viewer with its reason for a map not made yet', () => {
    lens([pane('cohort-mean', { ready: false })], null);
    const b = paneMenu(paneRoot(/cohort-mean/));
    const open = b.getByRole('menuitem', { name: 'Open in viewer' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', OPEN_IN_VIEWER_NOT_READY);
    fireEvent.click(open);
    expect(loadFile).not.toHaveBeenCalled();
  });
});

describe('Compare pane as the Inspector\'s artifact', () => {
  it('a click on a pane or its menu chooses that pane (no Inspect link)', () => {
    const onSelectPane = vi.fn();
    const mean = pane('cohort-mean', { ready: true, sourcePath: '/c/cohort-mean.nii.gz' });
    const zscore = pane('zscore', { ready: true, sourcePath: '/c/zscore.nii.gz' });
    render(
      <CompareLens
        activeSet={volumeSet}
        activeFeature={null}
        activeArtifact={null}
        onSelectPane={onSelectPane}
        activeMemberId="s01"
        activeMember={{ id: 's01', sourcePath: MEMBER_PATH } as never}
        compareCohort={null}
        cohorts={[]}
        activeExpression={null}
        paneSpecs={[mean, zscore]}
        loading={false}
        refreshingPaneIds={[]}
        onSelectCohort={vi.fn()}
        onDrillToCohort={vi.fn()}
        onOpenCompareView={vi.fn()}
        onRecomputePane={vi.fn()}
      />,
    );
    const b = screen.getByRole('article', { name: /cohort-mean/ });
    fireEvent.click(within(b).getByRole('button', { name: 'More actions' }));
    expect(onSelectPane).toHaveBeenLastCalledWith(mean);
    fireEvent.click(screen.getByRole('article', { name: /zscore/ }));
    expect(onSelectPane).toHaveBeenLastCalledWith(zscore);
    expect(screen.queryByRole('menuitem', { name: 'Inspect' })).toBeNull();
  });
});

describe('StudioComparePane menu', () => {
  it('names a source pane plainly and never offers Inspect', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <StudioComparePane
        letter="A"
        accent={'a' as never}
        pane={pane('current', { kind: 'member' as never, ready: true, sourcePath: MEMBER_PATH })}
        fallbackTitle="s01"
        fallbackSubtitle="Current member"
        selected
        isRefreshing={false}
        isAnyLoading={false}
        cohortMemberCount={null}
        cohortLabel={null}
        cohortId={null}
        activeMemberId="s01"
        activeSet={volumeSet}
        onOpen={onOpen}
        openUnavailable={null}
      >
        <div />
      </StudioComparePane>,
    );
    const menu = paneMenu(container);
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open in viewer',
    ]);
    expect(menu.getByRole('menuitem', { name: 'Open in viewer' })).toHaveAttribute(
      'title',
      'Open the source file in a new viewer tab',
    );
    fireEvent.click(menu.getByRole('menuitem', { name: 'Open in viewer' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
