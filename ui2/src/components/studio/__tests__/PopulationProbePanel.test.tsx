import { PopulationUnitControls } from '../PopulationUnitControls';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MARK_UNSELECTED_OPACITY } from '../subsetOpacity';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import type { SampleRequest, SampleFrame } from '@/plotting';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticV2Fit } from '@/services/studio/__tests__/relationshipFixtures';
import { populationMemberHover } from '@/services/studio/populationMemberHover';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
beforeEach(() => {
  useMouseCoordinateStore.getState().clearMousePosition();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  // Hover follows the pointer over the Population lens only.
  useSetStudioStore.getState().setActiveLens('population');
  // Most cases turn Follow hover on themselves; its default is checked below.
  usePopulationViewStore.setState({ followHover: false, lensOrder: null });
});
afterEach(cleanup);
/** The whole summary table (mean, average size, sign, n). */
const summaryText = () =>
  screen.getByLabelText('Observed response distribution').querySelector('table')!.textContent;
/** C3: Radius and the near-zero band wait in the ⋯ menu. */
async function chooseFromMore(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More values actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
function setup() {
  const sample = vi.fn(
    async (request: SampleRequest): Promise<SampleFrame> => ({
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows:
        request.locus.kind === 'set'
          ? request.locus.members.map((member, i) => ({ member: member.memberId, value: i + 1 }))
          : [],
    }),
  );
  const controller = new PopulationProbeController(sample, 0);
  const result = render(
    <StrictMode>
      <PopulationUnitControls />
      <PopulationProbePanel controller={controller} />
    </StrictMode>,
  );
  return { sample, controller, ...result };
}

describe('PopulationProbePanel', () => {
  it('pins the hover location and disposes hover tracking when closed', async () => {
    const { sample, unmount } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow hover' }));
    act(() => useMouseCoordinateStore.getState().setMousePosition([1, 2, 3], 'axial'));
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Pin preview' }));
    act(() => useMouseCoordinateStore.getState().setMousePosition([4, 5, 6], 'axial'));
    expect(useSetStudioStore.getState().population.pinnedProbe?.worldMm).toEqual([1, 2, 3]);
    expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([4, 5, 6]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sample).toHaveBeenCalledTimes(1);
    unmount();
    act(() => useMouseCoordinateStore.getState().setMousePosition([7, 8, 9], 'axial'));
    expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([4, 5, 6]);
  });

  it('pins a location, focuses from the shared plot, and selects without resampling', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    expect(screen.getByTestId('population-mean').textContent).toContain('3.500');
    const working = useSetStudioStore.getState().population.working;
    fireEvent.click(screen.getByRole('button', { name: 'sub006: 6' }));
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
    expect(useSetStudioStore.getState().population.working).toBe(working);
    // C′: the selection commands live in the Inspector; the values follow them.
    act(() => populationProbeActions.selectNone());
    expect(screen.getByTestId('population-mean').textContent).toContain('unavailable');
    act(() => populationProbeActions.selectFocused());
    expect(screen.getByTestId('population-mean').textContent).toContain('6.000');
    fireEvent.click(screen.getByRole('button', { name: 'sub001: 1' }), { shiftKey: true });
    expect(screen.getByTestId('population-mean').textContent).toContain('3.500');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sample).toHaveBeenCalledTimes(1);
    expect(useSetStudioStore.getState().population.pinnedProbe).not.toBeNull();
    // C′: no Show/Hide values (the dock minimises), no counts line.
    expect(screen.queryByRole('button', { name: 'Hide values' })).toBeNull();
    expect(screen.queryByText(/selected \/ \d+ observations/)).toBeNull();
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('updates a pinned radius; Refresh is the ⋯ menu\'s, not the tab\'s', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    // At a point with radius 0 the field waits behind one click.
    await chooseFromMore('Set radius');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Probe radius in millimetres' }), {
      target: { value: '4' },
    });
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(2));
    expect(sample.mock.calls[1][0].locus).toMatchObject({ radiusMm: 4 });
    // C′: one "Refresh images" in the ⋯ menu refreshes images and values.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  });
});

it('updates inclusive observed sign shares from cached selected responses without resampling', async () => {
  const { sample } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  await screen.findByRole('button', { name: 'sub001: 1' });
  // The counts are shown; the shares are the value's accessible name and tooltip.
  const signs = () => screen.getByTestId('population-sign-counts');
  const shares = () => signs().getAttribute('aria-label') ?? '';
  expect(signs()).toHaveTextContent('0 − / 6 +');
  expect(shares()).toContain('Positive 6 (100.0%)');
  expect(signs().getAttribute('title')).toContain('Positive 6 (100.0%)');
  expect(screen.getByTestId('population-mean-absolute')).toHaveTextContent('3.500');
  await chooseFromMore('Set near-zero band');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Near-zero response limit' }), {
    target: { value: '3' },
  });
  expect(signs()).toHaveTextContent('0 − / 3 ≈ 0 / 3 +');
  expect(shares()).toContain('Near zero 3 (50.0%)');
  expect(shares()).toContain('Positive 3 (50.0%)');
  fireEvent.click(screen.getByRole('button', { name: 'sub006: 6' }), { shiftKey: true });
  expect(shares()).toContain('Near zero 3 (60.0%)');
  expect(shares()).toContain('Positive 2 (40.0%)');
  act(() => populationProbeActions.selectNone());
  expect(shares()).toContain('Positive 0 (unavailable)');
  expect(screen.getByTestId('population-mean-absolute')).toHaveTextContent('unavailable');
  expect(sample).toHaveBeenCalledTimes(1);
});

it('configures participant weighting from metadata without resampling or hiding original rows', async () => {
  const initial = useSetStudioStore.getState();
  const set = initial.sets[initial.selection.activeSetId!];
  const people = ['A', 'A', 'A', 'B', 'C', 'C'];
  useSetStudioStore.setState({
    sets: {
      ...initial.sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['participant'],
          rows: set.memberIds.map((id, i) => ({ id, cells: [people[i]] })),
        },
      },
    },
  });
  const { sample } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  await screen.findByRole('button', { name: 'sub001: 1' });
  fireEvent.click(screen.getByText(/Analysis unit:/));
  fireEvent.change(screen.getByRole('combobox', { name: 'Participant identity' }), {
    target: { value: 'column:participant' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Population analysis unit' }), {
    target: { value: 'mean' },
  });
  // Person means 2, 4, 5.5: (2 + 4 + 5.5) / 3, versus row mean 3.5.
  expect(screen.getByTestId('population-mean')).toHaveTextContent('3.833');
  expect(screen.getByTestId('population-finite-count')).toHaveTextContent(/^3$/);
  expect(screen.getByRole('rowheader', { name: 'n' })).toHaveAttribute('title', expect.stringMatching(/^Finite participants/));
  expect(screen.getByText(/Analysis unit:/)).toHaveTextContent('6 observations / 3 participants');
  for (let i = 1; i <= 6; i++)
    expect(screen.getByRole('button', { name: `sub00${i}: ${i}` })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Population analysis unit' }), {
    target: { value: 'single' },
  });
  expect(
    screen
      .getAllByRole('alert')
      .some((alert) => /one selected observation/.test(alert.textContent ?? '')),
  ).toBe(true);
  expect(screen.getByTestId('population-mean')).toHaveTextContent('unavailable');
  act(() => useSetStudioStore.getState().selectPopulationMembers(['sub001', 'sub004', 'sub005']));
  expect(screen.queryByRole('alert')).toBeNull(); // repeated context rows are allowed outside the selection
  expect(screen.getByTestId('population-mean')).toHaveTextContent('3.333');
  expect(screen.getByTestId('population-finite-count')).toHaveTextContent(/^3$/);
  expect(screen.getByRole('rowheader', { name: 'n' })).toHaveAttribute('title', expect.stringMatching(/^Finite participants/));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(sample).toHaveBeenCalledTimes(1);
});

it('keeps an old probe usable without treating its rows as a complete expanded participant population', async () => {
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  const people = ['A', 'A', 'A', 'B', 'C', 'C'];
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['participant'],
          rows: set.memberIds.map((id, i) => ({ id, cells: [people[i]] })),
        },
      },
    },
    activeDesignFilters: [{ column: 'participant', value: 'A' }],
  });
  useSetStudioStore
    .getState()
    .configurePopulationParticipants({
      setId: set.id,
      identity: { kind: 'column', column: 'participant' },
      reduction: 'mean',
    });
  const { sample } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  await screen.findByRole('button', { name: 'sub001: 1' });
  expect(screen.getByTestId('population-mean')).toHaveTextContent('2.000');
  let finish!: (frame: SampleFrame) => void;
  sample.mockImplementationOnce(
    () =>
      new Promise<SampleFrame>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => useSetStudioStore.setState({ activeDesignFilters: [] }));
  await waitFor(() => expect(sample).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('alert')).toHaveTextContent('Missing sampled observation sub004');
  expect(screen.getByTestId('population-mean')).toHaveTextContent('unavailable');
  expect(screen.getByRole('button', { name: 'sub001: 1' })).toBeVisible();
  await act(async () =>
    finish({
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows: set.memberIds.map((member, i) => ({ member, value: i + 1 })),
    }),
  );
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByTestId('population-mean')).toHaveTextContent('3.833');

});

describe('PopulationProbePanel region locus', () => {
  it('Region pins a region probe from the legend; the status names it (E2)', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({
      layers: [
        {
          id: 'atlas',
          name: 'atlas',
          volumeId: 'atlas',
          type: 'label',
          visible: true,
          order: 0,
          atlasPaletteLegend: [
            { label_id: 1, roi: 'L_sensorimotor', color: [255, 0, 0] },
            { label_id: 2, roi: 'R_occipitotemporal', color: [0, 255, 0] },
          ],
        },
      ],
    } as never);
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    // No region under the crosshair (no sampling backend here): pick one.
    fireEvent.change(await screen.findByLabelText('Probe region'), { target: { value: '2' } });
    await waitFor(() =>
      expect(useSetStudioStore.getState().population.pinnedProbe?.region?.locus).toEqual({
        labelSource: { type: 'layer', layerId: 'atlas' },
        labelIds: [2],
      }),
    );
    await waitFor(() => expect((sample.mock.calls.at(-1)![0] as SampleRequest).locus).toMatchObject({ region: { labelIds: [2] } }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/region .*occipitotemporal/));
    fireEvent.click(screen.getByRole('radio', { name: 'Point' }));
    await waitFor(() => expect(useSetStudioStore.getState().population.pinnedProbe?.region ?? null).toBeNull());
  });

  it('a failed Cluster keeps the control on the locus of the shown data and offers Open Clusters (v1 function 1)', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({
      layers: [
        {
          id: 'atlas',
          name: 'atlas',
          volumeId: 'atlas',
          type: 'label',
          visible: true,
          order: 0,
          atlasPaletteLegend: [{ label_id: 2, roi: 'R_occipitotemporal', color: [0, 255, 0] }],
        },
      ],
    } as never);
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    // No region at the crosshair: the control stays on Point / sphere and the
    // alert carries the picker.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No region: .*Kept the previous locus/);
    expect(screen.getByRole('radio', { name: 'Point' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Probe region'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Region' })).toBeChecked());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/region .*occipitotemporal/));
    // No cluster table: Cluster fails, the control and the data stay on the region.
    fireEvent.click(screen.getByRole('radio', { name: 'Cluster' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No cluster: .*Kept the previous locus/));
    expect(screen.getByRole('radio', { name: 'Region' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cluster' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Open Clusters' })).toBeInTheDocument();
    // Focus lands on the alert's action, not <body> (v4 function).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Clusters' })));
    expect(screen.getByRole('status')).toHaveTextContent(/region .*occipitotemporal/);
  });

  it('a point pin after a region pin puts the control back on Point / sphere (REVIEW m3)', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({
      layers: [
        {
          id: 'atlas',
          name: 'atlas',
          volumeId: 'atlas',
          type: 'label',
          visible: true,
          order: 0,
          atlasPaletteLegend: [{ label_id: 2, roi: 'R_occipitotemporal', color: [0, 255, 0] }],
        },
      ],
    } as never);
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    fireEvent.change(await screen.findByLabelText('Probe region'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Region' })).toBeChecked());
    // A point pin from elsewhere (the viewer) replaces the region probe.
    act(() => populationProbeActions.pin(0, false));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Point' })).toBeChecked());
  });

  it('a failed Region with no atlas offers Load atlas…', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({ layers: [] } as never);
    setup();
    // Nothing pinned: one quiet line; a region is pinned from its ⋯ menu.
    fireEvent.click(screen.getByRole('button', { name: 'More values actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin region at crosshair' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No region/));
    expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
    expect(screen.getByRole('button', { name: 'Load atlas…' })).toBeInTheDocument();
  });

  it('a failed Region issue belongs to the probe it kept: a new pin or Dismiss retires it', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({ layers: [] } as never);
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No region/));
    expect(screen.getByRole('radio', { name: 'Point' })).toBeChecked();
    // Re-pinning on Point / sphere is a new probe: the Region failure no longer applies.
    act(() => populationProbeActions.pin(2, false));
    await waitFor(() => expect(screen.queryByText(/No region/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Load atlas…' })).toBeNull();
    // The alert can also be dismissed in place.
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No region/));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/No region/)).toBeNull();
  });

  it('a failed Region issue stays while Follow hover moves the hover probe (it belongs to the pin)', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({ layers: [] } as never);
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow hover' }));
    act(() => useMouseCoordinateStore.getState().setMousePosition([1, 2, 3], 'axial'));
    expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No region/));
    // The pointer moves on: a new hover probe, the same (absent) pin.
    act(() => useMouseCoordinateStore.getState().setMousePosition([4, 5, 6], 'axial'));
    act(() => useMouseCoordinateStore.getState().setMousePosition([7, 8, 9], 'axial'));
    // Hover writes are coalesced to one per animation frame: the last move lands.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(useSetStudioStore.getState().population.hoverProbe?.worldMm).toEqual([7, 8, 9]);
    expect(screen.getByRole('alert')).toHaveTextContent(/No region/);
    // A pin is a new locus: it retires the issue.
    act(() => populationProbeActions.pin(0, false));
    await waitFor(() => expect(screen.queryByText(/No region/)).toBeNull());
  });

  it('the radius rejects negative values visibly and says what 0 means (v1 function 8)', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(1));
    await chooseFromMore('Set radius');
    const field = screen.getByRole('spinbutton', { name: 'Probe radius in millimetres' });
    expect(screen.getByText('voxel only')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '-2' } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Radius must be ≥ 0 mm \(0 = the voxel only\)/)).toBeInTheDocument();
    expect(useSetStudioStore.getState().population.pinnedProbe?.radiusMm ?? 0).toBe(0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sample).toHaveBeenCalledTimes(1);
  });
});

describe('observation status rows', () => {
  async function pinnedValues() {
    const result = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: /^sub001: / });
    return result;
  }

  it('lists observations outside the context in the Inspector, not in the Values tab', async () => {
    act(() => useSetStudioStore.getState().setActiveScopeCohort('young-controls'));
    await pinnedValues();
    const summary = summaryText();
    // C′: the list moved to Inspector › Coverage and sources (PopulationInspector.test).
    expect(screen.queryByRole('button', { name: /Outside the context/ })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Observations outside the context' })).toBeNull();
    // Excluded observations never enter the summaries.
    expect(summaryText()).toBe(summary);
  });

  it('reports a whole-context issue once instead of an outside group', async () => {
    useSetStudioStore.getState().toggleDesignFilter({ column: 'site', value: 'A' });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/metadata/i);
    expect(screen.queryByRole('button', { name: /Outside the context/ })).toBeNull();
  });

  it('marks previewed-out rows while a hold-to-preview is active, without changing summaries', async () => {
    await pinnedValues();
    const summary = summaryText();
    const signs = screen.getByTestId('population-sign-counts').getAttribute('aria-label');
    // C′: the observation table is the Values tab's Table view.
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    act(() => {
      populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'cases-site-b' });
    });
    expect(document.querySelectorAll('tr[data-preview]')).toHaveLength(0);
    act(() => populationProbeActions.holdPreview());
    const marked = [...document.querySelectorAll('tr[data-preview="without"]')];
    expect(marked.map((row) => row.querySelector('button')?.textContent)).toEqual([
      'sub004',
      'sub005',
      'sub006',
    ]);
    expect(marked[0]).toHaveClass('text-bf-text-faint');
    expect(marked[0].textContent).toContain('Previewing without');
    // Preview differs in form from selection: the rows stay selected.
    expect(screen.getByRole('checkbox', { name: 'Select sub004' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Strip' }));
    expect(summaryText()).toBe(summary);
    expect(screen.getByTestId('population-sign-counts').getAttribute('aria-label')).toBe(signs);
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    act(() => populationProbeActions.releasePreview());
    expect(document.querySelectorAll('tr[data-preview]')).toHaveLength(0);
  });
});

it('resolves unavailable-at-probe and unassigned facets from the sampled values and the current fit', async () => {
  invoke.mockImplementation(async (command: string, args: { request: RelationshipRequest }) =>
    command === 'fit_population_relationship' ? syntheticV2Fit(args.request, [1]) : undefined,
  );
  await populationRelationshipService.fit('effect');
  expect(populationRelationshipService.currentUnassigned()?.map((u) => u.memberId)).toEqual([
    'sub002',
  ]);
  const sample = vi.fn(
    async (request: SampleRequest): Promise<SampleFrame> => ({
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows:
        request.locus.kind === 'set'
          ? request.locus.members.map((member, i) => ({
              member: member.memberId,
              value: i === 2 ? null : i + 1,
            }))
          : [],
    }),
  );
  render(<PopulationProbePanel controller={new PopulationProbeController(sample, 0)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  // C′: the observation table is the Values tab's Table view.
  fireEvent.click(await screen.findByRole('radio', { name: 'Table' }));
  await screen.findByRole('button', { name: 'sub001' });
  const row = (id: string) => screen.getByRole('button', { name: id }).closest('tr')!;
  expect(row('sub003')).toHaveAttribute('data-unavailable');
  expect(row('sub001')).not.toHaveAttribute('data-unavailable');
  expect(row('sub002')).toHaveAttribute('data-unassigned', 'allMissing');
  expect(row('sub001')).not.toHaveAttribute('data-unassigned');
  // A stale fit is not usable: the unassigned facet disappears.
  act(() => populationRelationshipService.resetScope(null));
  expect(row('sub002')).not.toHaveAttribute('data-unassigned');
});

describe('Values dock, calm layout (R1-D)', () => {
  async function pinned() {
    const result = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    return result;
  }

  it('C3: Radius waits in ⋯ at a point with radius 0 (one click away); a non-zero radius keeps it shown', async () => {
    await pinned();
    expect(screen.queryByRole('spinbutton', { name: 'Probe radius in millimetres' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Radius' })).toBeNull();
    await chooseFromMore('Set radius');
    expect(screen.getByRole('spinbutton', { name: 'Probe radius in millimetres' })).toBeInTheDocument();
    expect(screen.getByText('voxel only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More values actions' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).not.toContain('Set radius');
    // A probe pinned with a radius shows the field without asking.
    cleanup();
    act(() => populationProbeActions.pin(3, false));
    setup();
    expect(await screen.findByRole('spinbutton', { name: 'Probe radius in millimetres' })).toHaveValue(3);
  });

  it('one Pin / Unpin toggle, and a ⋯ menu holding Compose in Plot; the strip brushes by dragging', async () => {
    await pinned();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin crosshair' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compose in Plot' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Brush response plot' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More values actions' }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(['Compose in Plot', 'Pin crosshair here', 'Set radius', 'Set near-zero band']);
    // No brushing mode: the strip itself is the brush surface.
    expect(screen.getByTestId('population-brush-direct')).toBeInTheDocument();
    expect(screen.queryByLabelText('Population brush surface')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  });

  it('has no sign-share bar; the sign is a row of the key–value summary; Cancellation is behind ⓘ', async () => {
    const { container } = await pinned();
    expect(container.querySelector('.bg-blue-500, .bg-red-500, .bg-gray-500')).toBeNull();
    const list = screen.getByLabelText('Observed response distribution').querySelector('table')!;
    const keys = () => [...list.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(keys()).toEqual(['Mean', 'Avg size', 'Sign', 'n']);
    const about = screen.getByRole('button', { name: 'About these numbers' });
    expect(about).toHaveAttribute(
      'title',
      expect.stringMatching(/how much positive and negative values cancel: \|mean\| vs average size/i),
    );
    fireEvent.click(about);
    expect(about).toHaveAttribute('aria-expanded', 'true');
    expect(keys()).toEqual(['Mean', 'Avg size', 'Sign', 'n', 'Cancellation']);
    expect(screen.getByTestId('population-cancellation')).toHaveTextContent('0.000');
    const sign = [...list.querySelectorAll('tbody th')].find((th) => th.textContent === 'Sign')!;
    expect(sign.nextElementSibling).toBe(screen.getByTestId('population-sign-counts'));
    // No near-zero count while the band is 0 and no response is exactly 0.
    expect(screen.getByTestId('population-sign-counts')).toHaveTextContent(/^0 − \/ 6 \+$/);
    expect(screen.getByTestId('population-mean')).toHaveClass('font-mono', 'text-right');
  });

  it('keeps the near-zero band one click away while it is 0', async () => {
    await pinned();
    expect(screen.queryByRole('spinbutton', { name: 'Near-zero response limit' })).toBeNull();
    await chooseFromMore('Set near-zero band');
    const field = screen.getByRole('spinbutton', { name: 'Near-zero response limit' });
    expect(field).toHaveValue(0);
  });

  it('draws neutral ranked dots with a zero rule and labels the lowest, highest and focused IDs', async () => {
    await pinned();
    expect(screen.getByTestId('population-plot-title')).toHaveTextContent(/· 6 observations, ranked$/);
    const dots = [...document.querySelectorAll('circle[data-datum-id]')];
    expect(new Set(dots.map((dot) => dot.getAttribute('fill')))).toEqual(
      new Set(['var(--bf-text-secondary)']),
    );
    // Ranked: x rises with the value.
    const xs = dots.map((dot) => Number(dot.getAttribute('cx')));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(document.querySelector('.visx-axis-bottom')).toBeNull();
    act(() => populationProbeActions.focus('sub003'));
    const labels = () =>
      Object.fromEntries(
        [...document.querySelectorAll('[data-testid="plot-direct-label"]')].map((label) => [
          label.getAttribute('data-label-role'),
          label.textContent,
        ]),
      );
    expect(labels()).toEqual({ min: 'sub001', max: 'sub006', focus: 'sub003' });
  });

  it('sizes the strip to its column even when the strip mounts after the panel', async () => {
    // The strip mounts only with a result and in Strip view (a hover result
    // arrives after the panel; Table → Strip remounts it). Its width must still
    // follow the column, or the plot overflows it and the right-most label is cut.
    const observed: { target: Element; callback: ResizeObserverCallback }[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observed.push({ target, callback: this.callback });
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      await pinned();
      fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Strip' }));
      const plot = document.querySelector('svg[data-testid="plot-mark-point"]')!;
      const column = observed.find(({ target }) => target.contains(plot));
      expect(column).toBeDefined();
      act(() =>
        column!.callback(
          [{ target: column!.target, contentRect: { width: 432 } } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
      expect(document.querySelector('svg[data-testid="plot-mark-point"]')).toHaveAttribute('width', '432');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('shares dot hover: a dot publishes the Values dock\'s hover; another view\'s hover rings its dot', async () => {
    const { unmount } = await pinned();
    const dot = (id: string) => document.querySelector(`circle[data-datum-id="${id}"]`)!;
    fireEvent.pointerEnter(dot('sub002'));
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: 'sub002', source: 'values' });
    // Its own hover is not echoed as a ring.
    expect(document.querySelector('[data-mark="linked"]')).toBeNull();
    fireEvent.pointerLeave(dot('sub002'));
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: null, source: null });
    // A tile or a map point under the pointer rings its dot, lighter than focus.
    act(() => populationMemberHover.set('sub004', 'montage'));
    const ring = document.querySelector('[data-mark="linked"]')!;
    expect(ring).toHaveAttribute('data-linked-id', 'sub004');
    expect(ring.getAttribute('cx')).toBe(dot('sub004').getAttribute('cx'));
    expect(ring.getAttribute('stroke-width')).toBe('1');
    act(() => populationMemberHover.set(null, 'montage'));
    expect(document.querySelector('[data-mark="linked"]')).toBeNull();
    // Unmounting withdraws a hover the dock published.
    fireEvent.pointerEnter(dot('sub003'));
    unmount();
    expect(populationMemberHover.getSnapshot().memberId).toBeNull();
  });

  it('ranks the strip by value, not by source order', async () => {
    const sample = vi.fn(
      async (request: SampleRequest): Promise<SampleFrame> => ({
        columns: [
          { name: 'member', role: 'nominal' },
          { name: 'value', role: 'quantitative' },
        ],
        rows:
          request.locus.kind === 'set'
            ? request.locus.members.map((member, i) => ({
                member: member.memberId,
                value: i === 1 ? null : -(i + 1),
              }))
            : [],
      }),
    );
    render(<PopulationProbePanel controller={new PopulationProbeController(sample, 0)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: -1' });
    const order = [...document.querySelectorAll('circle[data-datum-id]')]
      .sort((a, b) => Number(a.getAttribute('cx')) - Number(b.getAttribute('cx')))
      .map((dot) => dot.getAttribute('data-datum-id'));
    expect(order).toEqual(['sub006', 'sub005', 'sub004', 'sub003', 'sub001']);
    expect(screen.getByTestId('population-plot-title')).toHaveTextContent(/· 5 observations, ranked$/);
    expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('5 − / 0 +');
    expect(screen.getByTestId('population-unavailable-count')).toHaveTextContent('1');
  });
});

describe('Values dock, round 2 (A3, A4, A8, A11, B3)', () => {
  async function pinned() {
    const result = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    return result;
  }

  it('A8: nothing pinned and Follow hover off is one 28 px line, not a centred empty state', () => {
    setup();
    const line = screen.getByTestId('population-values-empty');
    expect(line).toHaveClass('h-7');
    expect(line).toHaveTextContent(/^Nothing pinned ·/);
    expect(screen.queryByText(/Pin a point on a map/)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Region' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    expect(useSetStudioStore.getState().population.pinnedProbe).not.toBeNull();
  });

  it('B3: Follow hover is on for a new session, and a choice to turn it off is remembered', async () => {
    const { reloadPopulationViewMemory } = await import('@/stores/populationViewStore');
    localStorage.removeItem('brainflow.population.values.followHover');
    reloadPopulationViewMemory();
    setup();
    const toggle = screen.getByRole('checkbox', { name: 'Follow hover' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(usePopulationViewStore.getState().followHover).toBe(false);
    usePopulationViewStore.setState({ followHover: true });
    reloadPopulationViewMemory();
    expect(usePopulationViewStore.getState().followHover).toBe(false);
    localStorage.removeItem('brainflow.population.values.followHover');
  });

  it('A11: a pin made in Population shows in Deck, with Unpin only while it exists', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    act(() => useSetStudioStore.getState().setActiveLens('deck'));
    expect(screen.getByRole('status')).toHaveTextContent(/ · pin · /);
    expect(screen.queryByText('Nothing pinned')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    // Hover never moves the probe outside the Population lens.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow hover' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    act(() => useMouseCoordinateStore.getState().setMousePosition([1, 2, 3], 'axial'));
    expect(useSetStudioStore.getState().population.hoverProbe).toBeNull();
    expect(screen.getByTestId('population-values-empty')).toHaveTextContent(/^Nothing pinned ·/);
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('A11: a pin already set when Deck is in front is sampled and named there', async () => {
    useSetStudioStore.getState().setActiveLens('deck');
    act(() => populationProbeActions.pin(0, false));
    setup();
    await screen.findByRole('button', { name: 'sub001: 1' });
    expect(screen.getByRole('status')).toHaveTextContent(/^Stat Map at \(.*\) mm · pin · 6 (subjects|observations), ranked$/);
  });

  it('C3: one title line names the map, the location, pin or pointer and what is ranked; the mean is in the legend', async () => {
    await pinned();
    const title = screen.getByTestId('population-plot-title');
    expect(title.textContent).toMatch(/^Stat Map at \(.+\) mm · pin · 6 (subjects|observations), ranked$/);
    // Never truncated: it wraps.
    expect(title).not.toHaveClass('truncate');
    expect(title).toHaveClass('break-words');
    // One statement of where: no separate "Showing …" line, no caption.
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(screen.queryByTestId('population-plot-caption')).toBeNull();
    expect(screen.getByTestId('plot-y-title')).toHaveTextContent(/^value$/);
    const zero = screen.queryByTestId('plot-zero-line');
    if (zero) expect(zero).toHaveAttribute('stroke', 'var(--bf-text-muted)');
    const mean = screen.getByTestId('plot-y-rule');
    expect(mean.textContent).toBe('');
    expect(mean.querySelector('line')).toHaveAttribute('stroke-dasharray', '4 3');
    expect(screen.getByTestId('population-legend-mean')).toHaveTextContent('mean');
    expect(screen.getByTestId('population-stats-title')).toHaveTextContent('All · 6');
    act(() => populationProbeActions.focus('sub003'));
    expect(screen.getByTestId('population-plot-legend')).toHaveTextContent('current');
    expect(screen.getByTestId('population-plot-legend')).not.toHaveTextContent('others');
  });

  it('A3: one subset rule — unselected dots dim, the stats say which subset', async () => {
    await pinned();
    act(() => populationProbeActions.select(['sub002', 'sub005'], 'replace', 'manual'));
    expect(screen.queryByTestId('population-plot-caption')).toBeNull();
    expect(screen.getByTestId('population-stats-title')).toHaveTextContent('Selection · 2 of 6');
    expect(screen.getByTestId('population-mean')).toHaveTextContent('3.500');
    const opacity = (id: string) =>
      document.querySelector(`circle[data-datum-id="${id}"]`)!.getAttribute('fill-opacity');
    expect(opacity('sub002')).toBe('1');
    expect(opacity('sub001')).toBe('0.4');
    expect(screen.getByTestId('population-plot-legend')).toHaveTextContent(/selected.*others/);
    // The legend's "others" swatch dims by the same constant as the dots.
    expect(screen.getByTestId('population-legend-others-swatch').style.opacity).toBe(
      String(MARK_UNSELECTED_OPACITY),
    );
  });

  it('B3: when the montage is sorted by the value at the pin, the dots take its order', async () => {
    await pinned();
    act(() =>
      usePopulationViewStore.getState().setLensOrder({
        ids: ['sub006', 'sub005', 'sub004', 'sub003', 'sub002', 'sub001'],
        label: 'Ordered by value at pin, reversed',
      }),
    );
    const order = [...document.querySelectorAll('circle[data-datum-id]')]
      .sort((a, b) => Number(a.getAttribute('cx')) - Number(b.getAttribute('cx')))
      .map((dot) => dot.getAttribute('data-datum-id'));
    expect(order).toEqual(['sub006', 'sub005', 'sub004', 'sub003', 'sub002', 'sub001']);
    expect(screen.getByTestId('population-plot-title')).toHaveTextContent(/in montage order \(by value, highest first\)/);
    // Another order (similarity) does not reorder the strip.
    act(() =>
      usePopulationViewStore.getState().setLensOrder({ ids: ['sub003', 'sub001'], label: 'Similarity order' }),
    );
    const ranked = [...document.querySelectorAll('circle[data-datum-id]')]
      .sort((a, b) => Number(a.getAttribute('cx')) - Number(b.getAttribute('cx')))
      .map((dot) => dot.getAttribute('data-datum-id'));
    expect(ranked).toEqual(['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006']);
  });

  it('B3: the saved (non-reversed) pin order and the single-page pointer order also align the strip', async () => {
    await pinned();
    const dotOrder = () =>
      [...document.querySelectorAll('circle[data-datum-id]')]
        .sort((a, b) => Number(a.getAttribute('cx')) - Number(b.getAttribute('cx')))
        .map((dot) => dot.getAttribute('data-datum-id'));
    const ids = ['sub002', 'sub001', 'sub004', 'sub003', 'sub006', 'sub005'];
    act(() =>
      usePopulationViewStore.getState().setLensOrder({
        ids,
        label: 'Response order at (1.0, 2.0, 3.0) mm · point · ties in source order · 0 unavailable last',
      }),
    );
    expect(dotOrder()).toEqual(ids);
    act(() => usePopulationViewStore.getState().setLensOrder({ ids, label: 'Value at the pointer' }));
    expect(dotOrder()).toEqual(ids);
    // A within-page order does not match the whole-set rank: the strip ranks by value.
    act(() =>
      usePopulationViewStore.getState().setLensOrder({ ids, label: 'Value at the pointer, within each page' }),
    );
    expect(dotOrder()).toEqual(['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006']);
  });

  it('Table: Group, Rank and z replace the Status column; status stays as the row tooltip', async () => {
    await pinned();
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Observation values' });
    const headers = [...table.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['Select', 'Observation', 'Group', 'Value', 'Rank', 'z']);
    const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('sub006'))!;
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells.slice(3)).toEqual(['6.000', '6', (2.5 / Math.sqrt(3.5)).toFixed(2)]);
    expect(row.getAttribute('title')).toMatch(/Snapshot recorded|Source identity unavailable/);
  });
});
