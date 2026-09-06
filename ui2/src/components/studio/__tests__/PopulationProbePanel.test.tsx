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
