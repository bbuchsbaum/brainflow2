import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { selectStudioBackgroundAttention } from '@/services/studio/studioBackground';

const service = vi.hoisted(() => ({ reviewOpenedFolder: vi.fn() }));
/** A lens that puts nothing on its own row (its sources are still being fetched). */
const bare = vi.hoisted(() => ({ current: false }));
/** Renders of the lens: the Studio below the header re-rendering. */
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => service,
}));
// Each lens puts a marker where the real one puts its controls.
vi.mock('../LensCanvas', async () => {
  const slots = await import('../StudioToolbarSlot');
  const more = await import('../studioToolbarSlots');
  return {
    LensCanvas: ({ activeLens }: { activeLens: string }) => {
      renders.count += 1;
      const view = useContext(more.StudioViewSlotContext);
      const menu = useContext(more.StudioMenuSlotContext);
      return (
        <>
          {bare.current ? null : (
            <slots.StudioToolbarPortal>
              <span data-testid="lens-row">{activeLens} controls</span>
            </slots.StudioToolbarPortal>
          )}
          {activeLens === 'population' && view
            ? createPortal(<span data-testid="lens-view">Summary | Montage</span>, view)
            : null}
          {activeLens === 'population' && menu
            ? createPortal(<span data-testid="lens-menu">Save calculation</span>, menu)
            : null}
        </>
      );
    },
  };
});
vi.mock('../PopulationProbePanel', () => ({ PopulationProbePanel: () => null }));
vi.mock('../StudioStrip', () => ({ StudioStrip: () => null }));
vi.mock('../StudioTimeRow', () => ({ StudioTimeRow: () => null }));
const card = vi.hoisted(() => ({ openDatasetCard: vi.fn(), showPanel: vi.fn(() => true) }));
vi.mock('@/services/DatasetCardService', () => ({
  getDatasetCardService: () => ({ openDatasetCard: card.openDatasetCard }),
}));
vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({ showPanel: card.showPanel }),
}));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ getTemplateCatalog: async () => [] }),
}));

import { StudioCenterPane } from '../StudioCenterPane';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { STUDIO_OPEN_NOTICE_MS, StudioOpenNotice } from '../StudioOpenNotice';

beforeEach(() => {
  bare.current = false;
  service.reviewOpenedFolder.mockClear();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setId = () => useSetStudioStore.getState().selection.activeSetId!;
const rows = () => ({
  toolbar: screen.getByLabelText('Set studio toolbar'),
  row1: screen.getByTestId('studio-toolbar-row-1'),
  row2: screen.getByTestId('studio-toolbar-row-2'),
  menu: screen.queryByTitle('More')?.closest('details') as HTMLDetailsElement,
  info: screen.queryByTitle('Dataset details')?.closest('details') as HTMLDetailsElement,
});

describe('Set studio header', () => {
  it('is two rows on one edge: the lens and its view switch, one menu, then the lens controls', () => {
    act(() => useSetStudioStore.getState().setActiveLens('population'));
    render(<StudioCenterPane />);
    const { toolbar, row1, row2, menu } = rows();
    // Row 1: the lens switch with no "Lens" word, then the view switch, then the one menu.
    const lens = within(row1).getByRole('radiogroup', { name: 'Set studio lens' });
    expect(row1).not.toHaveTextContent(/^Lens/);
    expect(within(row1).queryByText('Lens')).toBeNull();
    const view = within(row1).getByTestId('lens-view');
    expect(lens.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One menu ("Sources moved?" inside it is a disclosure, not a menu).
    expect(toolbar.querySelectorAll('details > summary[title="More"]')).toHaveLength(1);
    // Background is in sight on row 1, just before the menu, not inside it.
    const background = within(row1).getByRole('combobox', { name: 'Background' });
    expect(menu.contains(background)).toBe(false);
    expect(view.compareDocumentPosition(background) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(background.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Row 2: the lens's own controls, and nothing of the menu's.
    expect(row2).not.toHaveAttribute('hidden');
    expect(within(row2).getByTestId('lens-row')).toHaveTextContent('population controls');
    expect(within(row2).queryByLabelText('Background')).toBeNull();
    // No boxes: one hairline under the rows.
    expect(toolbar.className).toContain('border-b');
    expect(toolbar.className).not.toMatch(/rounded|bg-card|\bborder\b(?!-)/);
    expect(row1.className).not.toMatch(/justify-end|\bpx-/);
    expect(row2.className).not.toMatch(/justify-end|\bpx-/);
  });

  it('is one header row: the set name, the lens, its view, then Background, ⓘ and ⋯', () => {
    act(() => useSetStudioStore.getState().setActiveLens('population'));
    render(<StudioCenterPane />);
    const { row1, menu, info } = rows();
    const name = within(row1).getByTestId('studio-set-name');
    const lens = within(row1).getByRole('radiogroup', { name: 'Set studio lens' });
    const view = within(row1).getByTestId('lens-view');
    const background = within(row1).getByRole('combobox', { name: 'Background' });
    const order = [name, lens, view, background, info, menu];
    for (let i = 1; i < order.length; i += 1)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    expect(name).toHaveTextContent(useSetStudioStore.getState().sets[setId()].name);
    // The image count and grid are facts behind ⓘ, not chips on the row.
    const panel = within(row1).getByTestId('studio-set-info');
    expect(panel).toHaveTextContent(/\d+ images?/);
    for (const chip of within(row1).queryAllByText(/^\d+ images?$/)) expect(panel.contains(chip)).toBe(true);
    expect(screen.queryByRole('region', { name: 'Set studio audit summary' })).toBeNull();
    // Deck and Compare keep the same row: name, status, ⓘ.
    for (const lens of ['deck', 'compare'] as const) {
      act(() => useSetStudioStore.getState().setActiveLens(lens));
      expect(within(rows().row1).getByTestId('studio-set-name')).toBeInTheDocument();
      expect(within(rows().row1).getByTestId('studio-set-info')).toHaveTextContent(/\d+ images?/);
    }
  });

  it('says the background\'s note in the set\'s ⓘ facts and the control\'s tooltip, and keeps Review… in the menu', () => {
    act(() => {
      const state = useSetStudioStore.getState();
      state.setActiveLens('population');
      state.setStudioBackground('template:MNI152NLin2009cAsym_T1w_2mm');
      state.setStudioOpenNotice({ setId: setId(), root: '/data/enc_rep_rsa', message: 'Opened.' });
    });
    render(<StudioCenterPane />);
    const { menu, toolbar, row1, info } = rows();
    // A note that only reports is not a line on the page: it is the select's
    // tooltip and one of the set's facts behind ⓘ (after the select, before ⋯).
    const note = 'Assumed to match these images; not checked.';
    const background = within(row1).getByRole('combobox', { name: 'Background' });
    // C5: the tooltip names the template in full (the closed select reads short), then the note.
    expect(background.getAttribute('title')).toMatch(/^Background: .+\n/);
    expect(background.getAttribute('title')!.split('\n').at(-1)).toBe(note);
    expect(screen.queryByTestId('studio-background-mark')).toBeNull();
    expect(within(row1).getByTestId('studio-set-info')).toHaveTextContent(note);
    expect(info.contains(background)).toBe(false);
    expect(background.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(info.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Visible only while ⓘ is open: closed, the row does not read the note.
    expect(info.open).toBe(false);
    expect(within(toolbar).queryByTestId('studio-background-note')).toBeNull();
    expect(screen.queryByTestId('studio-background-attention')).toBeNull();
    expect(within(menu).getByTestId('lens-menu')).toHaveTextContent('Save calculation');
    fireEvent.click(within(menu).getByRole('button', { name: 'Review…' }));
    expect(service.reviewOpenedFolder).toHaveBeenCalledTimes(1);
  });

  it('renders no second row with nothing on it; the one menu always holds the set\'s items', () => {
    act(() => useSetStudioStore.getState().setActiveLens('deck'));
    bare.current = true;
    render(<StudioCenterPane />);
    // Deck has no extras: the menu holds the set's items (the set header's
    // own menu is merged here), and nothing of a lens.
    const items = () =>
      within(rows().menu)
        .getAllByRole('button')
        .map((button) => button.textContent);
    expect(screen.getAllByTitle('More')).toHaveLength(1);
    // About this dataset is with the set's facts behind ⓘ, not in ⋯.
    const provenance = ['Copy recipe', 'Copy path', 'Copy provenance path', 'Copy JSON', 'Save recipe'];
    expect(items()).toEqual(['Open saved population…', ...provenance, 'Locate directory and open…']);
    expect(screen.queryByTestId('lens-menu')).toBeNull();
    // The lens put nothing on its row: the row is not there to leave a gap.
    expect(rows().row2).toHaveAttribute('hidden');
    // Background stays in sight.
    expect(within(rows().row1).getByRole('combobox', { name: 'Background' })).toBeInTheDocument();
    // A folder that can be reviewed adds Review… to the same menu.
    act(() =>
      useSetStudioStore
        .getState()
        .setStudioOpenNotice({ setId: setId(), root: '/data/x', message: 'Opened.' }),
    );
    expect(items()).toEqual([
      'Review…',
      'Open saved population…',
      ...provenance,
      'Locate directory and open…',
    ]);
    // A set that is not a volume has no background to choose; the menu stays.
    act(() => {
      const state = useSetStudioStore.getState();
      const set = state.sets[setId()];
      useSetStudioStore.setState({
        sets: { ...state.sets, [set.id]: { ...set, supportKind: 'surface' } as typeof set },
        studioOpenNotice: null,
      });
    });
    expect(within(rows().row1).queryByRole('combobox', { name: 'Background' })).toBeNull();
    expect(screen.getAllByTitle('More')).toHaveLength(1);
  });

  it('About this dataset (behind ⓘ) opens the card of a folder set the Files panel browses, for every lens', () => {
    const root = '/mnt/data';
    const folder = `${root}/enc_rep_rsa`;
    act(() => {
      const state = useSetStudioStore.getState();
      const set = state.sets[setId()];
      useSetStudioStore.setState({
        sets: { ...state.sets, [set.id]: { ...set, discoveryRequest: { root: folder } } as typeof set },
      });
      useFileBrowserStore.setState({ entries: [{ path: root }] } as never);
    });
    for (const lens of ['population', 'deck', 'compare'] as const) {
      card.openDatasetCard.mockClear();
      act(() => useSetStudioStore.getState().setActiveLens(lens));
      const view = render(<StudioCenterPane />);
      const about = within(rows().info).getByRole('button', { name: 'About this dataset' });
      expect(about).toBeEnabled();
      fireEvent.click(about);
      expect(card.showPanel).toHaveBeenCalledWith('FileBrowser');
      expect(card.openDatasetCard).toHaveBeenCalledWith({
        rootPath: root,
        path: folder,
        returnFocus: about,
      });
      view.unmount();
    }
    // The mount goes: the item stays, off, with the reason.
    act(() => useFileBrowserStore.setState({ entries: [] } as never));
    render(<StudioCenterPane />);
    const about = within(rows().info).getByRole('button', { name: 'About this dataset' });
    expect(about).toBeDisabled();
    expect(within(rows().info).getByText(/not open in the Files panel/)).toBeInTheDocument();
  });

  it('does not re-render the Studio when the Files tree changes without changing the card', () => {
    act(() => useFileBrowserStore.setState({ entries: [{ path: '/mnt/a' }] } as never));
    render(<StudioCenterPane />);
    const before = renders.count;
    // Expanding folders makes new entry arrays; the set's card is unchanged.
    act(() => useFileBrowserStore.setState({ entries: [{ path: '/mnt/a' }, { path: '/mnt/b' }] } as never));
    act(() => useFileBrowserStore.setState({ entries: [{ path: '/mnt/a' }] } as never));
    expect(renders.count).toBe(before);
  });

  it('Deck and Compare keep their controls on row 2; Compare\'s group select moves there', () => {
    act(() => useSetStudioStore.getState().setActiveLens('deck'));
    render(<StudioCenterPane />);
    expect(within(rows().row2).getByTestId('lens-row')).toHaveTextContent('deck controls');
    expect(within(rows().row1).queryByTestId('lens-view')).toBeNull();
    expect(screen.queryByTestId('lens-menu')).toBeNull();
    expect(within(rows().row1).getByRole('combobox', { name: 'Background' })).toBeInTheDocument();
    act(() => useSetStudioStore.getState().setActiveLens('compare'));
    const { row1, row2 } = rows();
    expect(within(row2).getByTestId('lens-row')).toHaveTextContent('compare controls');
    expect(within(row2).getByRole('combobox', { name: 'Compare with' })).toBeInTheDocument();
    expect(within(row1).queryByRole('combobox', { name: 'Compare with' })).toBeNull();
  });

  it('says a background problem on the page only when there is something to do about it', () => {
    act(() => {
      const state = useSetStudioStore.getState();
      state.setActiveLens('population');
      state.setStudioBackground('template:MNI152NLin2009cAsym_T1w_2mm');
    });
    render(<StudioCenterPane />);
    expect(screen.queryByTestId('studio-background-attention')).toBeNull();
    // A template that failed to open.
    act(() =>
      useSetStudioStore.getState().setStudioBackgroundIssue({
        sourcePath: 'template:MNI152NLin2009cAsym_T1w_2mm',
        message: 'The template could not be opened.',
      }),
    );
    expect(screen.getByTestId('studio-background-attention')).toHaveTextContent(
      'The template could not be opened.',
    );
    // Read and put away.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss background note' }));
    expect(screen.queryByTestId('studio-background-attention')).toBeNull();
  });

  it('lets a reader who wants no background clear a header\'s suggestion', () => {
    act(() => {
      const state = useSetStudioStore.getState();
      state.setActiveLens('deck');
      const set = state.sets[setId()];
      useSetStudioStore.setState({
        sets: {
          ...state.sets,
          [set.id]: { ...set, supportLabel: null, memberSummaries: [] } as typeof set,
        },
        studioBackground: null,
        studioGridEvidence: {
          setId: set.id,
          memberId: 'm1',
          dims: [91, 109, 91],
          voxelMm: [2, 2, 2],
          space: null,
          headerSpace: 'MNI152',
        },
      });
    });
    render(<StudioCenterPane />);
    // The select already reads "No background", so choosing it again changes nothing…
    expect(within(rows().row1).getByRole('combobox', { name: 'Background' })).toHaveValue('');
    const notice = screen.getByTestId('studio-background-attention');
    expect(notice).toHaveTextContent("This image's header says MNI152 space; choose a template.");
    // …and the note has its own way out.
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss background note' }));
    expect(screen.queryByTestId('studio-background-attention')).toBeNull();
    // It stays put away for this set and wording.
    act(() => useSetStudioStore.getState().setActiveLens('compare'));
    expect(screen.queryByTestId('studio-background-attention')).toBeNull();
  });
});

describe('which Background notes ask something of the reader', () => {
  const GRID = {
    setId: 's',
    memberId: 'm1',
    dims: [91, 109, 91] as [number, number, number],
    voxelMm: [2, 2, 2] as [number, number, number],
    space: 'MNI152NLin6Asym',
    headerSpace: null,
  };
  const attention = (overrides: Record<string, unknown>) =>
    selectStudioBackgroundAttention({
      selection: { activeSetId: 's', activeLens: 'deck' },
      sets: { s: { supportLabel: null, memberSummaries: [], alignmentClass: 'same-grid' } },
      studioBackground: null,
      studioGridEvidence: null,
      ...overrides,
    } as unknown as Parameters<typeof selectStudioBackgroundAttention>[0]);
  it('says nothing for a note that only reports, and speaks up when there is a choice to make', () => {
    // A header that names a space without a template for it: the reader must choose.
    expect(attention({ studioGridEvidence: { ...GRID, space: null, headerSpace: 'MNI152' } })).toBe(
      "This image's header says MNI152 space; choose a template.",
    );
    expect(
      attention({ studioGridEvidence: { ...GRID, space: null, headerSpace: 'Talairach' } }),
    ).toMatch(/there is no template for it/);
    // One image matched and the others unchecked (grids that may be mixed).
    expect(attention({ studioGridEvidence: GRID })).toMatch(
      /matched from this image .*the other images were not checked/,
    );
    // A template the user chose, with no declared space to contradict it: a caption only.
    expect(
      attention({ studioBackground: { setId: 's', sourcePath: 'template:MNI152NLin6Asym_T1w_1mm' } }),
    ).toBeNull();
    // Nothing known and nothing chosen: nothing to say.
    expect(attention({})).toBeNull();
  });
});

describe('the "Opened …" notice', () => {
  const open = (requiresAction?: boolean) =>
    act(() =>
      useSetStudioStore.getState().setStudioOpenNotice({
        setId: setId(),
        root: '/data/enc_rep_rsa',
        message: 'Opened 35 members × 3 images from enc_rep_rsa.',
        ...(requiresAction ? { requiresAction } : {}),
      }),
    );
  it('goes away by itself after about six seconds, leaving Review… reachable', () => {
    vi.useFakeTimers();
    render(<StudioOpenNotice />);
    open();
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS - 100);
    });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
    // The store still knows the folder: the menu's Review… works.
    expect(useSetStudioStore.getState().studioOpenNotice?.root).toBe('/data/enc_rep_rsa');
  });
  it('goes away when the studio is used with the pointer or typed into, not when the notice is', () => {
    render(
      <>
        <StudioOpenNotice />
        <button type="button">Elsewhere in the studio</button>
        <input aria-label="Search subjects" />
      </>,
    );
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Review…' }));
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review…' }));
    expect(service.reviewOpenedFolder).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere in the studio' }));
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
    // Typing into a field is use too.
    open();
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search subjects' }), { key: 'a' });
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
  });
  it('can be reached with the keyboard: Tab and the arrows do not hide it, and its time waits', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">Elsewhere in the studio</button>
        <StudioOpenNotice />
      </>,
    );
    open();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere in the studio' });
    for (const key of ['Tab', 'ArrowDown', 'Shift', 'Enter'])
      fireEvent.keyDown(elsewhere, { key });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    // Focus arrives on Review…: the six seconds do not run out under the reader.
    act(() => screen.getByRole('button', { name: 'Review…' }).focus());
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS * 3);
    });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Review…' }), { key: 'Tab' });
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus());
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    // Focus leaves: the time starts again from the top.
    act(() => elsewhere.focus());
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS - 1);
    });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
  });
  it('waits while the pointer is over it', () => {
    vi.useFakeTimers();
    render(<StudioOpenNotice />);
    open();
    fireEvent.mouseEnter(screen.getByTestId('studio-open-notice').parentElement!);
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS * 3);
    });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('studio-open-notice').parentElement!);
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS);
    });
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
  });
  it('is shown again when the same folder is opened again', () => {
    render(<StudioOpenNotice />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
    // The same set, folder and words: a new opening all the same.
    open();
    expect(screen.getByTestId('studio-open-notice')).toHaveTextContent(
      'Opened 35 members × 3 images from enc_rep_rsa.',
    );
  });
  it('stays when it asks the reader to act, until dismissed', () => {
    vi.useFakeTimers();
    render(
      <>
        <StudioOpenNotice />
        <button type="button">Elsewhere in the studio</button>
      </>,
    );
    open(true);
    act(() => {
      vi.advanceTimersByTime(STUDIO_OPEN_NOTICE_MS * 5);
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere in the studio' }));
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.getByTestId('studio-open-notice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('studio-open-notice')).toBeNull();
  });
});
