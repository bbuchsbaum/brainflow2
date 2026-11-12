import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';

/**
 * The Studio header with the real lenses behind it: each lens portals its
 * controls into the real slots (the e2e harness mounts the Population lens
 * alone, so only this exercises the "More" menu and the row-1 Background).
 */
const coordination = vi.hoisted(() => ({
  chooseBackground: vi.fn(),
  syncBackground: vi.fn(async () => ({ status: 'shown' })),
  retryBackground: vi.fn(async () => ({ status: 'shown' })),
  refreshComparePanes: vi.fn(async () => undefined),
}));
vi.mock('@/services/studio/StudioCoordinationService', () => ({
  getStudioCoordinationService: () => coordination,
}));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({
    getTemplateCatalog: async () => [
      {
        id: 'MNI152NLin2009cAsym_T1w_2mm',
        name: 'MNI152 2009c T1w 2 mm',
        config: { template_type: 'T1w' },
      },
    ],
  }),
}));
// Leaves that draw with the GPU or talk to the backend.
vi.mock('../StudioRenderAdapter', () => ({ StudioRenderAdapter: () => null }));
vi.mock('../StudioMemberLoadOverlay', () => ({ StudioMemberLoadOverlay: () => null }));
vi.mock('../PopulationProbePanel', () => ({ PopulationProbePanel: () => null }));
vi.mock('../StudioStrip', () => ({ StudioStrip: () => null }));
vi.mock('../StudioTimeRow', () => ({ StudioTimeRow: () => null }));
vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
  sliceImagePointToWorld: () => [0, 0, 0],
}));

import { StudioCenterPane } from '../StudioCenterPane';
import { resetStudioBackgroundOptions } from '@/services/studio/studioBackground';

beforeEach(() => {
  coordination.chooseBackground.mockClear();
  resetStudioBackgroundOptions();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row1 = () => screen.getByTestId('studio-toolbar-row-1');
const row2 = () => screen.getByTestId('studio-toolbar-row-2');
const menu = () => screen.queryByTitle('More')?.closest('details') ?? null;
/** The set's facts behind ⓘ, with the way to its dataset card. */
const info = () => screen.queryByTitle('Dataset details')?.closest('details') ?? null;
/** What the set header's own menu held, in the lens row's one menu (the card is behind ⓘ). */
const SET_ITEMS = ['Open saved population…', 'Locate directory and open…'];
/** The ⋯ menu's Provenance… disclosure: the Inspector's former Actions (B5). */
const PROVENANCE_ITEMS = [
  'Copy recipe',
  'Copy path',
  'Copy provenance path',
  'Copy JSON',
  'Save recipe',
];
/** Every button of the set's own items, in menu order (Data part). */
const DATA_ITEMS = ['Open saved population…', ...PROVENANCE_ITEMS, 'Locate directory and open…'];
const menuButtons = () =>
  within(menu()!)
    .getAllByRole('button')
    .map((button) => button.textContent);
const lens = (name: 'population' | 'deck' | 'compare') =>
  act(() => useSetStudioStore.getState().setActiveLens(name));

it('Population: the view switch on row 1, Background in sight and changeable, the extras in one scrolling menu', async () => {
  lens('population');
  render(<StudioCenterPane />);
  // Row 1: lens, view switch, Background, menu.
  expect(
    within(within(row1()).getByRole('radiogroup', { name: 'Set studio lens' }))
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Population', 'Subject vs mean']);
  const view = await within(row1()).findByRole('tablist', { name: 'Population view' });
  expect(within(view).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Summary',
    'Montage',
  ]);
  const background = within(row1()).getByRole('combobox', { name: 'Background' });
  // C5: short on the row, the full name as the option's tooltip.
  const template = await within(background).findByRole('option', { name: 'MNI152 · 2 mm' });
  expect(template).toHaveAttribute('title', 'MNI152 2009c T1w 2 mm');
  fireEvent.change(background, { target: { value: 'template:MNI152NLin2009cAsym_T1w_2mm' } });
  expect(coordination.chooseBackground).toHaveBeenCalledWith('template:MNI152NLin2009cAsym_T1w_2mm');
  fireEvent.change(background, { target: { value: '' } });
  expect(coordination.chooseBackground).toHaveBeenLastCalledWith(null);

  // The one menu: Save calculation and everything that was under More.
  const more = menu()!;
  expect(screen.getByLabelText('Set studio toolbar').querySelectorAll('details > summary[title="More"]')).toHaveLength(1);
  expect(within(more).getByText('Save calculation')).toBeInTheDocument();
  // In two parts: View (the lens's view controls), then Data (save, open, provenance).
  const viewPart = within(more).getByRole('region', { name: 'View' });
  const dataPart = within(more).getByRole('region', { name: 'Data' });
  expect(viewPart.compareDocumentPosition(dataPart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(dataPart).getByText('Save calculation')).toBeInTheDocument();
  for (const name of ['Center brain']) expect(within(viewPart).getByRole('button', { name })).toBeInTheDocument();
  expect(within(viewPart).getByRole('combobox', { name: 'Playback speed' })).toBeInTheDocument();
  // Refresh images is plumbing: inside Provenance…, with Sources moved?.
  const provenance = within(dataPart).getByTestId('studio-provenance');
  expect(within(provenance).getByRole('button', { name: 'Refresh images' })).toBeInTheDocument();
  expect(within(provenance).getByText('Sources moved?')).toBeInTheDocument();
  // …and what the set header's own menu held.
  for (const name of SET_ITEMS) expect(within(more).getByRole('button', { name })).toBeInTheDocument();
  // The dataset card is with the set's facts behind ⓘ; it says why it is off
  // for a set with no source folder.
  expect(within(more).queryByRole('button', { name: 'About this dataset' })).toBeNull();
  expect(within(info()!).getByRole('button', { name: 'About this dataset' })).toBeDisabled();
  expect(within(info()!).getByRole('button', { name: 'About this dataset' })).toHaveAttribute(
    'title',
    'This set was not opened from a folder.',
  );
  // C′: ±1 mm is gone (the slice stepper does it); Zoom (round 3) and
  // playback speed are here.
  for (const name of ['Center brain', 'Refresh images'])
    expect(within(more).getByRole('button', { name })).toBeInTheDocument();
  expect(within(more).queryByRole('button', { name: 'Previous population slice' })).toBeNull();
  expect(within(more).getByRole('combobox', { name: 'Playback speed' })).toBeInTheDocument();
  expect(within(more).getByRole('combobox', { name: 'Zoom' })).toBeInTheDocument();
  expect(within(row2()).queryByRole('combobox', { name: 'Zoom' })).toBeNull();
  // Its panel is bounded by the window and scrolls inside, so an opened
  // Save calculation form stays reachable in a short window.
  const panel = within(more).getByTestId('studio-toolbar-menu-panel');
  expect(panel.className).toMatch(/max-h-\[70vh\]/);
  expect(panel.className).toContain('overflow-y-auto');
  expect(panel.contains(within(more).getByText('Save calculation'))).toBe(true);

  // Row 2 belongs to the lens: Summary's Show, then the montage toolbar's Sort.
  expect(within(row2()).getByRole('combobox', { name: 'Show' })).toBeInTheDocument();
  fireEvent.click(within(view).getByRole('tab', { name: 'Montage' }));
  expect(within(view).getByRole('tab', { name: 'Montage' })).toHaveAttribute('aria-selected', 'true');
  expect(within(row2()).getByRole('group', { name: 'Montage' })).toBeInTheDocument();
  expect(within(row2()).queryByRole('combobox', { name: 'Show' })).toBeNull();
  expect(row2().querySelectorAll('details')).toHaveLength(0);
  // The tiles' extent left the row for the one menu: Whole slice or the pinned region.
  expect(within(row2()).queryByRole('combobox', { name: 'Tiles' })).toBeNull();
  const tiles = within(menu()!).getByRole('combobox', { name: 'Tiles' });
  expect([...tiles.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'Whole slice',
    expect.stringMatching(/^Pinned region/),
  ]);
  expect(tiles).toHaveValue('plane');
});

it('Deck and Compare: their controls on row 2, Background on row 1, and the one menu with the set\'s items', async () => {
  lens('deck');
  render(<StudioCenterPane />);
  await waitFor(() =>
    expect(within(row2()).getByRole('radiogroup', { name: 'Studio view plane' })).toBeInTheDocument(),
  );
  expect(row2()).not.toHaveAttribute('hidden');
  expect(within(row1()).getByRole('combobox', { name: 'Background' })).toBeInTheDocument();
  expect(within(row1()).queryByRole('tablist', { name: 'Population view' })).toBeNull();
  // The set header's own menu is gone: its items are here, for every lens.
  expect(menuButtons()).toEqual(DATA_ITEMS);

  lens('compare');
  await waitFor(() =>
    expect(within(row2()).getByRole('combobox', { name: 'Compare with' })).toBeInTheDocument(),
  );
  expect(within(row2()).getByRole('radiogroup', { name: 'Studio view plane' })).toBeInTheDocument();
  expect(within(row1()).getByRole('combobox', { name: 'Background' })).toBeInTheDocument();
  expect(menuButtons()).toEqual(DATA_ITEMS);
  expect(screen.getAllByTitle('More')).toHaveLength(1);

  // A folder that can be reviewed adds Review… first.
  act(() => {
    const state = useSetStudioStore.getState();
    state.setStudioOpenNotice({
      setId: state.selection.activeSetId!,
      root: '/data/enc_rep_rsa',
      message: 'Opened.',
    });
  });
  expect(menuButtons()).toEqual(['Review…', ...DATA_ITEMS]);
  // Back in Population the lens's extras join it.
  lens('population');
  await waitFor(() => expect(within(menu()!).getByText('Save calculation')).toBeInTheDocument());
  expect(within(menu()!).getByRole('button', { name: 'Review…' })).toBeInTheDocument();
});
