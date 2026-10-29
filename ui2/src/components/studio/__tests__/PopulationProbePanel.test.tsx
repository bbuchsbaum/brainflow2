import { PopulationUnitControls } from '../PopulationUnitControls';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import type { SampleRequest, SampleFrame } from '@/plotting';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticV2Fit } from '@/services/studio/__tests__/relationshipFixtures';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
beforeEach(() => {
  useMouseCoordinateStore.getState().clearMousePosition();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(cleanup);
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Preview hover' }));
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
    expect(screen.getByText(/Selected mean:/).textContent).toContain('3.500');
    const working = useSetStudioStore.getState().population.working;
    fireEvent.click(screen.getByRole('button', { name: 'sub006: 6' }));
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe('sub006');
    expect(useSetStudioStore.getState().population.working).toBe(working);
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByText(/Selected mean:/).textContent).toContain('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Focused only' }));
    expect(screen.getByText(/Selected mean:/).textContent).toContain('6.000');
    fireEvent.click(screen.getByRole('button', { name: 'sub001: 1' }), { shiftKey: true });
    expect(screen.getByText(/Selected mean:/).textContent).toContain('3.500');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sample).toHaveBeenCalledTimes(1);
    expect(useSetStudioStore.getState().population.pinnedProbe).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(screen.queryByRole('button', { name: 'sub001: 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }));
    expect(screen.getByText(/Selected mean:/).textContent).toContain('3.500');
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('updates a pinned radius and exposes explicit refresh', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Probe radius in millimetres' }), {
      target: { value: '4' },
    });
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(2));
    expect(sample.mock.calls[1][0].locus).toMatchObject({ radiusMm: 4 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  });
});

it('updates inclusive observed sign shares from cached selected responses without resampling', async () => {
  const { sample } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  await screen.findByRole('button', { name: 'sub001: 1' });
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('Positive 6 (100.0%)');
  expect(screen.getByText(/Mean absolute response:/)).toHaveTextContent('3.500');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Near-zero response limit' }), {
    target: { value: '3' },
  });
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('Near zero 3 (50.0%)');
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('Positive 3 (50.0%)');
  fireEvent.click(screen.getByRole('button', { name: 'sub006: 6' }), { shiftKey: true });
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('Near zero 3 (60.0%)');
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent('Positive 2 (40.0%)');
  fireEvent.click(screen.getByRole('button', { name: 'None', exact: true }));
  expect(screen.getByTestId('population-sign-counts')).toHaveTextContent(
    'Positive 0 (unavailable)',
  );
  expect(screen.getByText(/Mean absolute response:/)).toHaveTextContent('unavailable');
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
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('3.833');
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('3 finite participants');
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
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('unavailable');
  act(() => useSetStudioStore.getState().selectPopulationMembers(['sub001', 'sub004', 'sub005']));
  expect(screen.queryByRole('alert')).toBeNull(); // repeated context rows are allowed outside the selection
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('3.333');
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('3 finite participants');
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
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('2.000');
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
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('unavailable');
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
  expect(screen.getByText(/Selected mean:/)).toHaveTextContent('3.833');

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
    fireEvent.click(screen.getByRole('radio', { name: 'Point / sphere' }));
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
    expect(screen.getByRole('radio', { name: 'Point / sphere' })).toBeChecked();
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
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Point / sphere' })).toBeChecked());
  });

  it('a failed Region with no atlas offers Load atlas…', async () => {
    const { useLayerStore } = await import('@/stores/layerStore');
    useLayerStore.setState({ layers: [] } as never);
    setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No region/));
    expect(screen.getByRole('radio', { name: 'Point / sphere' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Load atlas…' })).toBeInTheDocument();
  });

  it('the radius rejects negative values visibly and says what 0 means (v1 function 8)', async () => {
    const { sample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await waitFor(() => expect(sample).toHaveBeenCalledTimes(1));
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

  it('lists observations outside the context, collapsed, with reasons and no focus targets', async () => {
    act(() => useSetStudioStore.getState().setActiveScopeCohort('young-controls'));
    await pinnedValues();
    const summary = screen.getByText(/Selected mean:/).textContent;
    const header = screen.getByRole('button', { name: 'Outside the context (4)' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Outside the scope cohort Young controls')).toBeNull();
    fireEvent.click(header);
    const table = screen.getByRole('table', { name: 'Observations outside the context' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(
      ['sub002', 'sub004', 'sub005', 'sub006'].map(
        (id) => `${id}Outside the scope cohort Young controls`,
      ),
    );
    // Not focusable: no controls, links or tab stops in the outside rows.
    expect(table.querySelectorAll('button, input, a, select, [tabindex]')).toHaveLength(0);
    // Excluded observations never enter the summaries.
    expect(screen.getByText(/Selected mean:/).textContent).toBe(summary);
    expect(screen.getByText(/2 selected \/ 2 observations/)).toBeInTheDocument();
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
    const summary = screen.getByText(/Selected mean:/).textContent;
    const signs = screen.getByTestId('population-sign-counts').textContent;
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
    expect(screen.getByText(/Selected mean:/).textContent).toBe(summary);
    expect(screen.getByTestId('population-sign-counts').textContent).toBe(signs);
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
