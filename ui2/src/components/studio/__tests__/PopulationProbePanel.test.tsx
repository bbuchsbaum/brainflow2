import { PopulationUnitControls } from '../PopulationUnitControls';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import type { SampleRequest, SampleFrame } from '@/plotting';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
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
