import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { PopulationProbePanel } from '../PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { CenterWithBottomDock } from '@/components/layout/CenterWithBottomDock';
import { DOCK_TAB_BAR_HEIGHT, type DockExtraTab } from '@/components/layout/bottomWorkbenchDock.constants';
import { useValuesLocus, valuesLocusOf } from '../valuesLocus';
import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import type { PopulationPartition } from '@/types/population';
import type { ResolvedPlotSpec, SampleFrame, SampleRequest } from '@/plotting';

vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample: vi.fn() } }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));

beforeEach(() => {
  useMouseCoordinateStore.getState().clearMousePosition();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  useSetStudioStore.getState().setActiveLens('population');
  usePopulationViewStore.setState({ followHover: false, lensOrder: null, valuesDockHeight: null });
});
afterEach(cleanup);

function setup(values: (i: number) => number = (i) => i + 1) {
  const sample = vi.fn(
    async (request: SampleRequest): Promise<SampleFrame> => ({
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows:
        request.locus.kind === 'set'
          ? request.locus.members.map((member, i) => ({ member: member.memberId, value: values(i) }))
          : [],
    }),
  );
  const result = render(
    <PopulationProbePanel controller={new PopulationProbeController(sample, 0)} reportsDockHeight />,
  );
  return { sample, ...result };
}
async function pinned(values?: (i: number) => number) {
  const result = setup(values);
  fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
  await screen.findByRole('button', { name: /^sub001: / });
  return result;
}

describe('C3 auto-height', () => {
  it('asks for one 28 px line when empty and about 140 px when filled; withdraws on unmount', async () => {
    const { unmount } = setup();
    expect(usePopulationViewStore.getState().valuesDockHeight).toBe(28);
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('button', { name: 'sub001: 1' });
    const filled = usePopulationViewStore.getState().valuesDockHeight!;
    // ~168 px for the whole dock with its tab bar.
    expect(filled + DOCK_TAB_BAR_HEIGHT).toBeGreaterThanOrEqual(160);
    expect(filled + DOCK_TAB_BAR_HEIGHT).toBeLessThanOrEqual(176);
    unmount();
    expect(usePopulationViewStore.getState().valuesDockHeight).toBeNull();
  });

  it('counts the rendered height of notices that wrap, not one line each', async () => {
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      // A long error wrapped onto four lines at a narrow dock width.
      if (this.dataset.testid === 'population-values-notices')
        return { height: 120, width: 300, top: 0, left: 0, bottom: 120, right: 300, x: 0, y: 0 } as DOMRect;
      return rect.call(this);
    });
    const sample = vi.fn(async (): Promise<SampleFrame> => {
      throw new Error('A long sampling failure that wraps onto several lines of the narrow dock.');
    });
    render(
      <PopulationProbePanel controller={new PopulationProbeController(sample, 0)} reportsDockHeight />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pin crosshair' }));
    await screen.findByRole('alert');
    // The controls, title and the notices' measured 120 px (plus their gap).
    await waitFor(() =>
      expect(usePopulationViewStore.getState().valuesDockHeight!).toBeGreaterThanOrEqual(120 + 4 + 28),
    );
  });

  it('asks for the rendered strip block when it is taller than the estimate (stats never clip)', async () => {
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      // The stats column wrapped below the plot at a narrow dock width.
      if (this.dataset.testid === 'population-values-strip')
        return { height: 210, width: 400, top: 0, left: 0, bottom: 210, right: 400, x: 0, y: 0 } as DOMRect;
      return rect.call(this);
    });
    await pinned();
    await waitFor(() =>
      expect(usePopulationViewStore.getState().valuesDockHeight!).toBeGreaterThanOrEqual(8 + 26 + 4 + 16 + 4 + 210),
    );
    vi.restoreAllMocks();
  });

  it('the dock sizes to the tab until the user drags a height, which wins until a double-click resets it', () => {
    useLayoutSettingsStore.setState({ bottomDockHeights: {} });
    useLayoutSettingsStore.getState().setBottomDockOpen(true, 'set-studio');
    useLayoutSettingsStore.getState().setBottomDockMinimized(false);
    let body: number | null = 28;
    const listeners = new Set<() => void>();
    const tabs: DockExtraTab[] = [
      {
        id: 'auto',
        title: 'Auto',
        leading: true,
        content: <div />,
        autoHeight: {
          subscribe: (onChange) => {
            listeners.add(onChange);
            return () => listeners.delete(onChange);
          },
          getSnapshot: () => body,
        },
      },
    ];
    render(
      <CenterWithBottomDock heightKey="set-studio" extraTabs={tabs} initialTab="auto">
        <div />
      </CenterWithBottomDock>,
    );
    const pane = () => screen.getByTestId('center-dock-pane');
    expect(pane().style.height).toBe(`${DOCK_TAB_BAR_HEIGHT + 28}px`);
    act(() => {
      body = 140;
      listeners.forEach((listener) => listener());
    });
    expect(pane().style.height).toBe(`${DOCK_TAB_BAR_HEIGHT + 140}px`);
    // A press without a drag remembers nothing.
    const resizer = screen.getByTestId('bottom-dock-resizer');
    fireEvent.pointerDown(resizer);
    fireEvent.pointerUp(window);
    expect(useLayoutSettingsStore.getState().bottomDockHeights['set-studio']).toBeUndefined();
    // A dragged height wins over the tab's.
    act(() => useLayoutSettingsStore.getState().setBottomDockHeight(250, 'set-studio'));
    expect(pane().style.height).toBe('250px');
    act(() => {
      body = 28;
      listeners.forEach((listener) => listener());
    });
    expect(pane().style.height).toBe('250px');
    // Reset: the tab's own size again.
    fireEvent.doubleClick(resizer);
    expect(useLayoutSettingsStore.getState().bottomDockHeights['set-studio']).toBeUndefined();
    expect(pane().style.height).toBe(`${DOCK_TAB_BAR_HEIGHT + 28}px`);
  });
});

describe('C3 one control row and one title line', () => {
  it('the row is At · Cutout · Follow hover · Pin/Unpin · Strip/Table · ⋯ (Radius and the band in ⋯)', async () => {
    await pinned();
    const row = screen.getByTestId('population-values-controls');
    expect(row).toHaveTextContent(/^At.*Cutout.*Follow hover.*Unpin.*Strip.*Table$/);
    expect(screen.queryByRole('button', { name: /Radius/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set near-zero band' })).toBeNull();
  });

  it('names the map by its short name, not the file path, and says pin or pointer', async () => {
    const featureId = useSetStudioStore.getState().selection.activeFeatureId!;
    useSetStudioStore.setState((state) => ({
      features: {
        ...state.features,
        [featureId]: { ...state.features[featureId], label: 'enc_rep/maps/same_item.nii.gz', units: 'r' },
      },
    }));
    await pinned();
    expect(screen.getByTestId('population-plot-title').textContent).toMatch(
      /^same_item at \(.+\) mm · pin · 6 (subjects|observations), ranked$/,
    );
    // The unit labels the axis.
    expect(screen.getByTestId('plot-y-title')).toHaveTextContent('value (r)');
    // Without a pin, Follow hover samples the pointer and the title says so.
    act(() => populationProbeActions.unpin());
    act(() => usePopulationViewStore.getState().setFollowHover(true));
    act(() => useMouseCoordinateStore.getState().setMousePosition([1, 2, 3], 'axial'));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(await screen.findByText(/^same_item at \(.+\) mm · pointer · /)).toBeInTheDocument();
  });
});

describe('C3 grouped', () => {
  const partition = (): PopulationPartition => ({
    setId: useSetStudioStore.getState().selection.activeSetId!,
    column: 'similarity',
    contextIds: ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'],
    groups: [
      { id: 'g1', label: 'Group 1', value: null, memberIds: ['sub001', 'sub002', 'sub003', 'sub004'] },
      { id: 'g2', label: 'Group 2', value: null, memberIds: ['sub005', 'sub006'] },
    ],
    origin: 'map-derived',
  });

  it('dots wear the group marks and the summary has All · G1 · G2 columns', async () => {
    useSetStudioStore.setState((state) => ({ population: { ...state.population, partition: partition() } }));
    await pinned();
    const marks = [...document.querySelectorAll('[data-glyph-mark][data-datum-id]')];
    expect(marks).toHaveLength(6);
    // k = 2: filled circle and open circle, in neutral ink.
    expect(document.querySelector('[data-datum-id="sub001"] path')).toHaveAttribute('fill', 'var(--bf-text-secondary)');
    expect(document.querySelector('[data-datum-id="sub006"] path')).toHaveAttribute('fill', 'none');
    const headers = [...screen.getByTestId('population-stats').querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['', 'All', 'G1', 'G2']);
    expect(screen.getByTestId('population-mean')).toHaveTextContent('3.500');
    expect(screen.getByTestId('population-mean-g1')).toHaveTextContent('2.500');
    expect(screen.getByTestId('population-mean-g2')).toHaveTextContent('5.500');
    expect(screen.getByTestId('population-finite-count-g2')).toHaveTextContent('2');
    expect(screen.getByTestId('population-plot-legend')).toHaveTextContent(/G1.*G2.*mean/);
    // The request includes the whole stats block (title, the group header and
    // every row through Sign and n): controls 26 + title 16 + stats 20 + 5 × 16, with gaps.
    expect(usePopulationViewStore.getState().valuesDockHeight!).toBeGreaterThanOrEqual(
      8 + 26 + 4 + 16 + 4 + 20 + 5 * 16,
    );
    // Stat labels stay on one line: the short label, its full name in the title.
    const size = [...screen.getByTestId('population-stats').querySelectorAll('tbody th')].find(
      (th) => th.textContent === 'Avg size',
    )!;
    expect(size).toHaveClass('whitespace-nowrap');
    expect(size.getAttribute('title')).toMatch(/^Average size: the mean of \|value\|/);
    // A selection keeps its rule: the columns describe the selected members.
    act(() => populationProbeActions.select(['sub001', 'sub005'], 'replace', 'manual'));
    expect(screen.getByTestId('population-stats-title')).toHaveTextContent('Selection · 2 of 6');
    expect(screen.getByTestId('population-mean-g1')).toHaveTextContent('1.000');
    expect(screen.getByTestId('population-finite-count-g2')).toHaveTextContent('1');
  });
});

describe('C3 direct labels', () => {
  it('keep clear of the zero and mean lines and of other dots', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ member: `s${i}`, value: i - 9.5 }));
    const frame: SampleFrame = {
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows,
    };
    const spec: ResolvedPlotSpec = {
      mark: 'point',
      encoding: { x: 'member', y: 'value' },
      transforms: [],
      params: { zeroLine: true, yRules: [{ y: 0, label: '' }], xAxis: false, directLabels: true },
    };
    render(
      <PlotEncoder
        frame={frame}
        spec={spec}
        width={400}
        height={84}
        context={{
          datumLink: {
            idColumn: 'member',
            focusedId: 's10',
            selectedIds: new Set(rows.map((row) => row.member)),
            onFocus: () => undefined,
            onToggleSelection: () => undefined,
          },
        }}
      />,
    );
    const zeroY = Number(screen.getByTestId('plot-zero-line').getAttribute('y1'));
    const labels = screen.getAllByTestId('plot-direct-label');
    expect(labels.map((label) => label.getAttribute('data-label-role')).sort()).toEqual(['focus', 'max', 'min']);
    for (const label of labels) {
      const baseline = Number(label.getAttribute('y'));
      // The label spans its cap height above the baseline.
      expect(zeroY <= baseline - 8 - 1 || zeroY >= baseline + 2).toBe(true);
    }
    // Labels never overlap one another.
    const boxes = labels.map((label) => {
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      return { left: x, right: x + (label.textContent ?? '').length * 6, top: y - 8, bottom: y };
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).toBe(false);
      }
  });
});

describe('C3 location contract', () => {
  it('useValuesLocus names the pin, else the pointer while Follow hover samples it', () => {
    const { result } = renderHook(() => useValuesLocus());
    expect(result.current).toBeNull();
    act(() => populationProbeActions.pin(0, false));
    expect(result.current).toMatchObject({ kind: 'pin', radiusMm: 0, region: null });
    const first = result.current;
    act(() => useSetStudioStore.getState().setActiveLens('population'));
    expect(result.current).toBe(first);
    act(() => populationProbeActions.unpin());
    expect(result.current).toBeNull();
    const probe = { supportKey: 'k', worldMm: [1, 2, 3] as const, radiusMm: 0, reduce: 'mean' as const };
    expect(valuesLocusOf({ pinnedProbe: null, hoverProbe: probe })).toEqual({
      kind: 'pointer',
      worldMm: [1, 2, 3],
      radiusMm: 0,
      region: null,
    });
    expect(valuesLocusOf({ pinnedProbe: probe, hoverProbe: probe })?.kind).toBe('pin');
  });

  it('names the probe the controller samples: a hover probe in force is the pointer, whatever the lens', () => {
    const { result } = renderHook(() => useValuesLocus());
    const probe = { supportKey: 'k', worldMm: [1, 2, 3] as const, radiusMm: 0, reduce: 'mean' as const };
    act(() => useSetStudioStore.getState().setPopulationProbe(probe, 'hover'));
    // Follow hover is off in this fixture, yet the controller samples
    // pinnedProbe ?? hoverProbe: the locus must say so, not claim nothing.
    expect(result.current?.kind).toBe('pointer');
    const state = useSetStudioStore.getState();
    expect(state.population.pinnedProbe ?? state.population.hoverProbe).not.toBeNull();
  });

  it('retires the hover probe when Follow hover turns off or the lens leaves Population', () => {
    const { result } = renderHook(() => useValuesLocus());
    const probe = { supportKey: 'k', worldMm: [1, 2, 3] as const, radiusMm: 0, reduce: 'mean' as const };
    act(() => populationProbeActions.setFollowHover(true));
    act(() => useSetStudioStore.getState().setPopulationProbe(probe, 'hover'));
    expect(result.current?.kind).toBe('pointer');
    act(() => populationProbeActions.setFollowHover(false));
    expect(useSetStudioStore.getState().population.hoverProbe).toBeNull();
    expect(result.current).toBeNull();

    act(() => populationProbeActions.setFollowHover(true));
    act(() => useSetStudioStore.getState().setPopulationProbe(probe, 'hover'));
    act(() => useSetStudioStore.getState().setActiveLens('deck'));
    expect(useSetStudioStore.getState().population.hoverProbe).toBeNull();
    expect(result.current).toBeNull();
  });

  it('the Follow hover checkbox retires the hover probe when unticked', () => {
    setup();
    const probe = { supportKey: 'k', worldMm: [1, 2, 3] as const, radiusMm: 0, reduce: 'mean' as const };
    act(() => usePopulationViewStore.getState().setFollowHover(true));
    act(() => useSetStudioStore.getState().setPopulationProbe(probe, 'hover'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Follow hover/ }));
    expect(usePopulationViewStore.getState().followHover).toBe(false);
    expect(useSetStudioStore.getState().population.hoverProbe).toBeNull();
  });
});
