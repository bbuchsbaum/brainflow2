import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePopulationProbeDriver } from '../usePopulationProbeDriver';
import {
  PopulationProbeController,
  populationProbeController,
} from '@/services/studio/PopulationProbeController';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { PopulationInspector } from '../PopulationInspector';
import { CenterWithBottomDock } from '@/components/layout/CenterWithBottomDock';
import { POPULATION_VALUES_TAB } from '../populationDock';
import { openDockTab } from '@/components/layout/openDockTab';
import type { SampleFrame, SampleRequest } from '@/plotting';

const sampler = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock('@/services/SampleProvider', () => ({ sampleProvider: sampler }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));

const state = () => useSetStudioStore.getState();
const frame = (request: SampleRequest, value: number): SampleFrame => ({
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows:
    request.locus.kind === 'set'
      ? request.locus.members.map((member) => ({ member: member.memberId, value }))
      : [],
});
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  state().setActiveLens('population');
  sampler.sample.mockReset();
});
afterEach(() => {
  cleanup();
  populationProbeController.stop();
});

function Driver({
  controller,
  onRender,
  populationOnly = false,
}: {
  controller: PopulationProbeController;
  onRender?: () => void;
  populationOnly?: boolean;
}) {
  onRender?.();
  usePopulationProbeDriver(controller, true, { populationOnly });
  return null;
}

describe('the probe driver', () => {
  it('follows hover and focus writes without re-rendering its host', () => {
    const controller = new PopulationProbeController(vi.fn(() => new Promise<never>(() => {})), 0);
    const request = vi.spyOn(controller, 'request');
    let renders = 0;
    render(<Driver controller={controller} onRender={() => (renders += 1)} />);
    const before = renders;
    act(() => populationProbeActions.pin(0, false));
    act(() => state().setActiveMember('sub004'));
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'manual', 'Two'));
    expect(renders).toBe(before);
    // The pin changed the query (it was asked for); focus and selection did not.
    const queries = request.mock.calls.map(([query]) => query?.key ?? null);
    expect(queries.filter((key) => key !== null)).toHaveLength(1);
  });

  it('keeps sampling while any holder remains, and drives only in the Population lens', () => {
    const controller = new PopulationProbeController(vi.fn(() => new Promise<never>(() => {})), 0);
    const first = render(<Driver controller={controller} populationOnly />);
    const second = render(<Driver controller={controller} populationOnly />, {
      container: document.body.appendChild(document.createElement('div')),
    });
    expect(controller.isActive()).toBe(true);
    first.unmount();
    // The survivor still drives it.
    expect(controller.isActive()).toBe(true);
    // Deck in front: nothing is sampled.
    act(() => state().setActiveLens('deck'));
    expect(controller.isActive()).toBe(false);
    act(() => state().setActiveLens('population'));
    expect(controller.isActive()).toBe(true);
    second.unmount();
    expect(controller.isActive()).toBe(false);
  });
});

describe('the Inspector reads current values only', () => {
  it('shows "sampling…" while a new pin is read, never the previous pin\'s value', async () => {
    let release: (() => void) | null = null;
    sampler.sample.mockImplementation(async (request: SampleRequest) => {
      if (sampler.sample.mock.calls.length === 1) return frame(request, 7);
      await new Promise<void>((resolve) => (release = resolve));
      return frame(request, 9);
    });
    render(
      <>
        <Driver controller={populationProbeController} />
        <PopulationInspector />
      </>,
    );
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
    act(() => populationProbeActions.pin(0, false));
    await settle();
    const block = () => screen.getByTestId('population-focused-block');
    await vi.waitFor(() => expect(block()).toHaveTextContent('7.000'));
    // C6: the value is named after where Values samples: the pin.
    expect(screen.getByTestId('focused-value')).toHaveTextContent(/^Value at the pin/);
    act(() => populationProbeActions.pin(4, false));
    await settle();
    await vi.waitFor(() => expect(screen.getByTestId('focused-value-pending')).toBeInTheDocument());
    expect(block()).not.toHaveTextContent('7.000');
    await act(async () => {
      release?.();
    });
    await settle();
    await vi.waitFor(() => expect(block()).toHaveTextContent('9.000'));
  });
});

describe('the Set studio dock opens on Values', () => {
  it('whatever tab another tool showed, and then follows the user and commands', () => {
    useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
    useLayoutSettingsStore.getState().setBottomDockOpen(true, 'set-studio');
    useLayoutSettingsStore.getState().setBottomDockMinimized(false);
    const extraTabs = [
      { id: POPULATION_VALUES_TAB, title: 'Values', leading: true, content: <div>values body</div> },
    ];
    render(
      <CenterWithBottomDock heightKey="set-studio" extraTabs={extraTabs} initialTab={POPULATION_VALUES_TAB}>
        <div />
      </CenterWithBottomDock>,
    );
    const dock = () => screen.getByTestId('bottom-workbench-dock');
    expect(dock().dataset.activeTab).toBe(POPULATION_VALUES_TAB);
    // The shared default for other tools is untouched.
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('plot');
    fireEvent.click(within(dock()).getByTestId('bottom-dock-tab-plot'));
    expect(dock().dataset.activeTab).toBe('plot');
    act(() => openDockTab(POPULATION_VALUES_TAB));
    expect(dock().dataset.activeTab).toBe(POPULATION_VALUES_TAB);
  });
});
