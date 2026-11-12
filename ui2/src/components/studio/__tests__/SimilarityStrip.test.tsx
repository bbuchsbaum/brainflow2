import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SimilarityStrip, type SimilarityStripProps } from '../SimilarityStrip';
import { PopulationRelationshipScatter } from '../PopulationRelationshipScatter';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticGroupingFit } from '@/services/studio/__tests__/relationshipFixtures';
import { populationMemberHover } from '@/services/studio/populationMemberHover';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
/** The demo set has 6 subjects; a test that needs a robust core says so. */
const layout = vi.hoisted(() => ({ manyPoints: false }));
vi.mock('../similarityStripLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../similarityStripLayout')>();
  return {
    ...actual,
    robustFramingAvailable: (coordinates: readonly (readonly [number, number])[]) =>
      layout.manyPoints || actual.robustFramingAvailable(coordinates),
  };
});

const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  act(() => populationRelationshipService.resetScope(null));
});

async function fit(options: Parameters<typeof syntheticGroupingFit>[1] = {}) {
  invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) =>
    syntheticGroupingFit(args.request, options),
  );
  await act(async () => {
    await populationRelationshipService.fit('pattern-shape', false, { grouping: true });
  });
}
const props = (over: Partial<SimilarityStripProps> = {}): SimilarityStripProps => ({
  mode: 'inline',
  collapsed: false,
  onCollapsedChange: vi.fn(),
  measure: 'pattern-shape',
  selected: new Set(),
  focusedId: null,
  linkedId: null,
  onHoverMember: vi.fn(),
  busy: null,
  error: null,
  onUseAmplitude: null,
  onRefit: vi.fn(),
  showing: null,
  ...over,
});

describe('the similarity map is square, with one scale on both axes', () => {
  it('draws the same distance the same length across and up, in a square frame', () => {
    render(
      // A non-square container: the map keeps its square frame inside it.
      <div style={{ width: 300, height: 520 }}>
        <PopulationRelationshipScatter
          square
          fitId={'f'.repeat(64)}
          fitted={['a', 'b', 'c']}
          coordinates={[
            [2, 0],
            [0, 2],
            [-1, -1],
          ]}
          selected={new Set()}
          activeMemberId={null}
          neighbourMarks={[]}
          bounds={null}
          onToggle={() => {}}
        />
      </div>,
    );
    const svg = screen.getByRole('group', { name: 'Spatial MDS observations' });
    expect(svg.getAttribute('viewBox')).toBe('0 0 300 300');
    expect(svg.getAttribute('class')).toContain('aspect-square');
    const point = (id: string) => {
      const circle = svg.querySelector(`circle[data-datum-id="${id}"]`)!;
      return [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))];
    };
    const [ax, ay] = point('a');
    const [bx, by] = point('b');
    const [cx, cy] = point('c');
    // One scale: from a to b is 2 left and 2 up, the same length across and up.
    expect(ax - bx).toBeGreaterThan(0);
    expect(ax - bx).toBeCloseTo(ay - by);
    // c is 1 left and 1 down of the origin, a 2 right of it: the ratios hold both ways.
    expect((ax - bx) / 2).toBeCloseTo(bx - cx);
    expect((ay - by) / 2).toBeCloseTo(cy - ay);
    // Nothing is clamped: all three lie inside the padded robust box.
    expect(svg.querySelectorAll('[data-clamped]')).toHaveLength(0);
  });
});

describe('the map, legible: robust extent, labels that never overprint, one code per channel', () => {
  const ids = Array.from({ length: 36 }, (_, i) => `sub-${1002 + i}`);
  /** 29 in a tight cloud, a dispersed group of 6 far out (the native capture's shape), and one lone outlier. */
  const coordinates: [number, number][] = [
    ...Array.from({ length: 29 }, (_, i): [number, number] => [
      0.05 * Math.cos(i * 2.4) * (1 + (i % 5) / 5),
      0.05 * Math.sin(i * 2.4) * (1 + (i % 3) / 3),
    ]),
    [1.2, 0.9],
    [-0.4, 1.1],
    [1.6, -0.2],
    [-1.1, -0.9],
    [0.9, -1.4],
    [2.0, 0.3],
    [6, -5],
  ];
  const marks = new Map(
    ids.map((id, i) => [
      id,
      i < 29 ? ('circle' as const) : i < 35 ? ('circle-open' as const) : ('diamond-hollow' as const),
    ]),
  );
  const draw = (selected: string[] = [], activeMemberId: string | null = ids[0]) =>
    render(
      <PopulationRelationshipScatter
        square
        fitId={'f'.repeat(64)}
        fitted={ids}
        coordinates={coordinates}
        selected={new Set(selected)}
        activeMemberId={activeMemberId}
        neighbourMarks={[]}
        bounds={null}
        onToggle={() => {}}
        marks={marks}
        groupLabels={[
          { id: 'g1', text: 'G1 · 29', memberIds: ids.slice(0, 29) },
          { id: 'g2', text: 'G2 · 6', memberIds: ids.slice(29, 35) },
        ]}
      />,
    );
  const svg = () => screen.getByRole('group', { name: 'Spatial MDS observations' });

  it('keeps a whole group in frame; only the lone outlier is off-scale, a muted tick and one note', () => {
    draw();
    const clamped = [...svg().querySelectorAll('circle[data-clamped]')];
    expect(clamped.map((c) => c.getAttribute('data-datum-id'))).toEqual(['sub-1037']);
    const circle = clamped[0];
    // One tick, no group glyph, no chevron, no ID label.
    const tick = svg().querySelector('[data-edge-mark="sub-1037"]')!;
    expect(tick.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
    expect(tick.getAttribute('stroke')).toBe('var(--bf-text-muted)');
    expect(svg().querySelectorAll('g[data-member="sub-1037"] path')).toHaveLength(1);
    expect(svg().querySelector('[data-point-label="sub-1037"]')).toBeNull();
    expect(svg().querySelectorAll('[data-edge-mark]')).toHaveLength(1);
    // The point keeps its name, tooltip and description.
    expect(circle.getAttribute('aria-description')).toMatch(/^Outside the frame.*true position \(6\.000, -5\.000\)/);
    expect(circle.querySelector('title')!.textContent).toMatch(/^sub-1037 · outside the frame at \(/);
    expect(circle).toHaveAccessibleName('Focus relationship sub-1037');
    // One note, with the IDs and true positions in its tooltip and accessible text.
    const note = screen.getByTestId('scatter-off-scale');
    expect(note.title).toBe('sub-1037 at (6.000, -5.000)');
    expect(note).toHaveTextContent(/^1 off-scale.*sub-1037 at \(6\.000, -5\.000\)/);
    // The group of six is drawn where it lies, each with its own mark.
    for (const id of ids.slice(29, 35))
      expect(svg().querySelector(`circle[data-datum-id="${id}"]`)).not.toHaveAttribute('data-clamped');
    // Point marks stay the only circles.
    expect(svg().querySelectorAll('circle:not([data-datum-id])')).toHaveLength(0);
  });

  it('names each group at the centroid of its members in the frame', () => {
    draw();
    const label = svg().querySelector('[data-group-label="g2"]')!;
    const at = (id: string) => {
      const c = svg().querySelector(`circle[data-datum-id="${id}"]`)!;
      return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
    };
    const members = ids.slice(29, 35).map(at);
    const cx = members.reduce((s, p) => s + p[0], 0) / 6,
      cy = members.reduce((s, p) => s + p[1], 0) / 6;
    // The dispersed group's centroid is empty: its label sits on it.
    expect(Number(label.getAttribute('x'))).toBeCloseTo(cx);
    expect(Math.abs(Number(label.getAttribute('y')) - cy)).toBeLessThan(6);
  });

  it('labels the focus, the groups and the extreme points without overprinting', () => {
    draw();
    const focus = svg().querySelector('[data-focus-label]')!;
    expect(focus.textContent).toBe('sub-1002');
    expect([...svg().querySelectorAll('[data-group-label]')].map((t) => t.textContent)).toEqual([
      'G1 · 29',
      'G2 · 6',
    ]);
    // Extreme points carry short IDs (the shared "sub-" dropped).
    const extremes = [...svg().querySelectorAll('[data-point-label]')].map((t) => t.textContent);
    expect(extremes.length).toBeGreaterThan(0);
    for (const text of extremes) expect(text).toMatch(/^\d{4}$/);
  });

  it('Fit core: a group mostly off-scale is ticks at the edge and named in the note, not on the map', () => {
    render(
      <PopulationRelationshipScatter
        square
        extent="core"
        fitId={'f'.repeat(64)}
        fitted={ids}
        coordinates={coordinates}
        selected={new Set()}
        activeMemberId={ids[0]}
        neighbourMarks={[]}
        bounds={null}
        onToggle={() => {}}
        marks={marks}
        groupLabels={[
          { id: 'g1', text: 'G1 · 29', memberIds: ids.slice(0, 29) },
          { id: 'g2', text: 'G2 · 6', memberIds: ids.slice(29, 35) },
        ]}
      />,
    );
    const clamped = [...svg().querySelectorAll('circle[data-clamped]')].map((c) =>
      c.getAttribute('data-datum-id'),
    );
    expect(clamped).toEqual(ids.slice(29));
    expect([...svg().querySelectorAll('[data-group-label]')].map((t) => t.textContent)).toEqual([
      'G1 · 29',
    ]);
    const note = screen.getByTestId('scatter-off-scale');
    expect(note).toHaveTextContent(/^7 off-scale: 1031, 1032, 1033, 1034, 1035, 1036, 1037/);
    expect(note.querySelector('[data-off-scale-group="g2"]')).toHaveTextContent('G2 · 6 · 6 off-scale');
  });

  it('Fit all: every point is in the frame and there is no off-scale note', () => {
    render(
      <PopulationRelationshipScatter
        square
        extent="all"
        fitId={'f'.repeat(64)}
        fitted={ids}
        coordinates={coordinates}
        selected={new Set()}
        activeMemberId={ids[0]}
        neighbourMarks={[]}
        bounds={null}
        onToggle={() => {}}
        marks={marks}
        groupLabels={[
          { id: 'g1', text: 'G1 · 29', memberIds: ids.slice(0, 29) },
          { id: 'g2', text: 'G2 · 6', memberIds: ids.slice(29, 35) },
        ]}
      />,
    );
    expect(svg().querySelectorAll('[data-clamped]')).toHaveLength(0);
    expect(screen.queryByTestId('scatter-off-scale')).toBeNull();
    expect([...svg().querySelectorAll('[data-group-label]')].map((t) => t.textContent)).toEqual([
      'G1 · 29',
      'G2 · 6',
    ]);
  });

  it('selection is contrast alone: unselected points fall to 40 %, every point wears one ink', () => {
    draw(['sub-1003', 'sub-1004']);
    const group = (id: string) => svg().querySelector(`g[data-member="${id}"]`)!;
    expect(group('sub-1003')).not.toHaveAttribute('opacity');
    expect(group('sub-1005')).toHaveAttribute('opacity', '0.4');
    expect(group('sub-1005')).toHaveAttribute('data-dim', 'true');
    const fill = (id: string) => group(id).querySelector('path[data-glyph]')!.getAttribute('fill');
    expect(fill('sub-1003')).toBe(fill('sub-1005'));
    // No selection: nothing is dimmed.
    cleanup();
    draw([]);
    expect(svg().querySelectorAll('[data-dim]')).toHaveLength(0);
  });
});

describe('the strip\'s states', () => {
  it('names the classes, the suggestion and the method; "No clear grouping" when there is none', async () => {
    await fit({ clearGrouping: false });
    act(() => populationRelationshipService.group(3));
    render(<SimilarityStrip {...props({ showing: 3 })} />);
    expect(screen.getByTestId('similarity-suggestion')).toHaveTextContent(
      'No clear grouping · showing 3. Outliers join no group.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'About this map' }));
    expect(screen.getByTestId('similarity-method')).toHaveTextContent(/Ward linkage clustering/);
    expect(screen.getByTestId('similarity-method')).toHaveTextContent(/exploratory/);
    // Points wear their group's mark.
    expect(
      document.querySelector('path[data-glyph="diamond-hollow"]'),
    ).not.toBeNull();
  });

  it('busy: says what is computed, dims the map and offers Cancel', async () => {
    await fit();
    const onCancel = vi.fn();
    render(
      <SimilarityStrip
        {...props({ busy: { text: 'Computing similarity for 6 subjects…', onCancel } })}
      />,
    );
    expect(screen.getByRole('complementary', { name: 'Similarity map' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByTestId('similarity-busy')).toHaveTextContent(
      'Computing similarity for 6 subjects…',
    );
    expect(document.querySelector('[data-dimmed]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('refused: says why plainly and offers amplitude', () => {
    const onUseAmplitude = vi.fn();
    render(
      <SimilarityStrip
        {...props({
          error: 'Correlation cannot be computed: at least one map is constant on the voxels every subject shares. Amplitude can still be compared.',
          onUseAmplitude,
        })}
      />,
    );
    expect(screen.getByTestId('similarity-refused')).toHaveTextContent(/constant/);
    fireEvent.click(screen.getByRole('button', { name: 'Use amplitude instead' }));
    expect(onUseAmplitude).toHaveBeenCalledTimes(1);
  });

  it('Fit core | Fit all: core by default, the choice kept for the session', async () => {
    layout.manyPoints = true;
    onTestFinished(() => {
      layout.manyPoints = false;
    });
    usePopulationViewStore.setState({ similarityFit: 'core' });
    await fit();
    render(<SimilarityStrip {...props({ showing: 3 })} />);
    const extent = screen.getByRole('radiogroup', { name: 'Map extent' });
    expect(within(extent).getByRole('radio', { name: 'Fit core' })).toBeChecked();
    fireEvent.click(within(extent).getByRole('radio', { name: 'Fit all' }));
    expect(usePopulationViewStore.getState().similarityFit).toBe('all');
    expect(within(extent).getByRole('radio', { name: 'Fit all' })).toBeChecked();
    expect(screen.queryByTestId('scatter-off-scale')).toBeNull();
    cleanup();
    render(<SimilarityStrip {...props({ showing: 3 })} />);
    expect(screen.getByRole('radio', { name: 'Fit all' })).toBeChecked();
    act(() => usePopulationViewStore.getState().setSimilarityFit('core'));
  });

  it('Fit core is disabled below the robust minimum, with a title saying why (it would frame every point)', async () => {
    usePopulationViewStore.setState({ similarityFit: 'core' });
    await fit();
    render(<SimilarityStrip {...props({ showing: 3 })} />);
    const extent = screen.getByRole('radiogroup', { name: 'Map extent' });
    const core = within(extent).getByRole('radio', { name: 'Fit core' });
    expect(core).toBeDisabled();
    expect(core).toHaveAttribute('title', expect.stringMatching(/needs at least 20 points/));
    expect(extent).toHaveAttribute('title', expect.stringMatching(/needs at least 20 points/));
    // What is drawn is every point: the control says Fit all…
    expect(within(extent).getByRole('radio', { name: 'Fit all' })).toBeChecked();
    // …without overwriting the session's choice for a larger fit.
    expect(usePopulationViewStore.getState().similarityFit).toBe('core');
  });

  it('collapsed: a rail that re-opens the map', () => {
    const onCollapsedChange = vi.fn();
    render(<SimilarityStrip {...props({ collapsed: true, onCollapsedChange })} />);
    const rail = screen.getByRole('complementary', { name: 'Similarity map' });
    expect(within(rail).queryByRole('group', { name: 'Spatial MDS observations' })).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: 'Show the similarity map' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('out of date: says so and offers Refit', async () => {
    await fit();
    const onRefit = vi.fn();
    render(<SimilarityStrip {...props({ onRefit })} />);
    const fitted = populationRelationshipService.getSnapshot().fit!;
    act(() =>
      populationRelationshipService.observeSources(
        fitted.request.members.map((m) => ({ memberId: m.memberId, revision: { sha256: 'd'.repeat(64) } })),
      ),
    );
    expect(screen.getByText('Out of date')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refit' }));
    expect(onRefit).toHaveBeenCalledTimes(1);
  });
});

describe('one fit per view', () => {
  async function fitBy(distance: 'effect' | 'pattern-shape') {
    invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) => ({
      ...syntheticGroupingFit(args.request),
      fitId: (args.request.distance === 'pattern-shape' ? 'c' : 'a').repeat(64),
    }));
    await act(async () => {
      await populationRelationshipService.fit(distance, false, { reuse: true, grouping: true });
    });
  }

  it('grouped by correlation, then sorted by amplitude: the map is the grouping\'s fit, and says so', async () => {
    await fitBy('pattern-shape');
    act(() => populationRelationshipService.group(3));
    await fitBy('effect');
    act(() => populationRelationshipService.order());
    // The store's measure now follows the newest fit (amplitude).
    render(<SimilarityStrip {...props({ measure: 'effect', showing: 3 })} />);
    // The measure is stated once, in the caption; the title does not repeat it.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/^Similarity$/);
    expect(screen.getByTestId('similarity-caption')).toHaveTextContent(/^Distance: correlation \(√\(2−2r\)\)/);
    expect(screen.getByRole('list', { name: 'Similarity groups' })).toBeInTheDocument();
    expect(screen.getByTestId('similarity-other-order')).toHaveTextContent(
      'The montage is sorted by amplitude, from another fit; this map and its groups are by correlation.',
    );
  });

  it('Shift-click toggles against the drawn fit, and the selection names that fit', async () => {
    await fitBy('pattern-shape');
    act(() => populationRelationshipService.group(3));
    await fitBy('effect');
    act(() => populationRelationshipService.order());
    expect(populationRelationshipService.getSnapshot().fit!.fitId).toBe('a'.repeat(64));
    act(() => state().selectPopulationMembers(['sub001']));
    render(<SimilarityStrip {...props({ measure: 'effect', showing: 3 })} />);
    const point = screen
      .getByRole('group', { name: 'Spatial MDS observations' })
      .querySelector('circle[data-datum-id="sub002"]')!;
    fireEvent.click(point, { shiftKey: true });
    expect(state().population.working).toMatchObject({
      kind: 'members',
      memberIds: ['sub001', 'sub002'],
      origin: 'map-derived',
      label: `Spatial relationship ${'c'.repeat(64)}`,
    });
  });

  it('while the asked-for measure is computed, a fit by the other measure is not shown', async () => {
    await fitBy('pattern-shape');
    act(() => populationRelationshipService.group(3));
    render(
      <SimilarityStrip
        {...props({ measure: 'effect', busy: { text: 'Computing similarity for 6 subjects…', onCancel: vi.fn() } })}
      />,
    );
    expect(screen.getByTestId('similarity-caption')).toHaveTextContent('Distance: amplitude (RMS)');
    expect(screen.getByTestId('similarity-busy')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Spatial MDS observations' })).toBeNull();
    expect(screen.queryByTestId('similarity-fit-quality')).toBeNull();
  });
});

describe('the map, calm: caption, spokes, direct lasso and shared hover', () => {
  afterEach(() => populationMemberHover.reset());

  /** The strip with its selection read live from the store, as the lens passes it. */
  function Live(over: Partial<SimilarityStripProps>) {
    const working = useSetStudioStore((s) => s.population.working);
    return (
      <SimilarityStrip
        {...props(over)}
        selected={new Set(working.kind === 'members' ? working.memberIds : [])}
      />
    );
  }
  const map = () => screen.getByRole('group', { name: 'Spatial MDS observations' });
  const at = (id: string) => {
    const circle = map().querySelector(`circle[data-datum-id="${id}"]`)!;
    return [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))] as const;
  };
  /** A small closed drag around one point (jsdom lays nothing out: client units are the frame's). */
  const lassoAround = (
    id: string,
    modifiers: boolean | { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = false,
  ) => {
    const [x, y] = at(id);
    const keys = typeof modifiers === 'boolean' ? { shiftKey: modifiers } : modifiers;
    fireEvent.pointerDown(map(), { button: 0, clientX: x - 3, clientY: y - 3, ...keys });
    for (const [dx, dy] of [
      [3, -3],
      [3, 3],
      [-3, 3],
    ])
      fireEvent.pointerMove(map(), { clientX: x + dx, clientY: y + dy });
    fireEvent.pointerUp(map(), { clientX: x - 3, clientY: y - 3 });
  };

  it('states the measure once, with the share of variance and, when low, that distances are approximate', async () => {
    invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) => {
      const made = syntheticGroupingFit(args.request);
      // The backend's own share (62.5 %), stated once; never recomputed from
      // the eigenvalues (which here would give 100 %).
      made.geometry.explainedFraction = 0.625;
      made.geometry.eigenvalues = [3, 2, 0, 0, 0, 0];
      return made;
    });
    await act(async () => {
      await populationRelationshipService.fit('pattern-shape', false, { grouping: true });
    });
    render(<SimilarityStrip {...props()} />);
    expect(screen.getByTestId('similarity-caption')).toHaveTextContent(
      'Distance: correlation (√(2−2r)) · 2-D keeps 63% — distances approximate',
    );
    // Stated once: not in the title, not again on the fit-quality line.
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Similarity');
    expect(screen.getByTestId('similarity-fit-quality').textContent).not.toMatch(/variance|variation/);
    // The method stays behind ⓘ.
    expect(screen.queryByTestId('similarity-method')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About this map' }));
    expect(screen.getByTestId('similarity-method')).toHaveTextContent(/classical MDS/);
  });

  it('draws no axes; groups wear their marks and are named at their centroids', async () => {
    await fit();
    act(() => populationRelationshipService.group(3));
    render(<SimilarityStrip {...props({ showing: 3 })} />);
    expect(map().textContent).not.toMatch(/MDS axis/);
    expect(map().querySelectorAll('line:not([data-neighbour-line])')).toHaveLength(0);
    expect(
      [...map().querySelectorAll('[data-group-label]')].map((label) => label.textContent),
    ).toEqual(['G1 · 2', 'G2 · 3']);
    expect(map().querySelector('circle[data-datum-id="sub001"]')).toHaveAttribute('data-mark', 'circle');
    expect(map().querySelector('circle[data-datum-id="sub003"]')).toHaveAttribute(
      'data-mark',
      'circle-open',
    );
    // The outlier keeps its own mark and gets no centroid label.
    expect(map().querySelector('circle[data-datum-id="sub006"]')).toHaveAttribute(
      'data-mark',
      'diamond-hollow',
    );
  });

  it('spokes join the focused subject to its five nearest by the fit\'s distances, not the plot', async () => {
    invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) => {
      const made = syntheticGroupingFit(args.request);
      // sub006 is the farthest by distance but drawn beside sub003.
      made.geometry.coordinates[5] = [2.05, 0.05];
      return made;
    });
    await act(async () => {
      await populationRelationshipService.fit('pattern-shape', false, { grouping: true });
    });
    render(<SimilarityStrip {...props({ focusedId: 'sub003' })} />);
    // Not permanent: only while the pointer (or keyboard) is on the map.
    expect(map().querySelectorAll('[data-neighbour-line], [data-neighbour-rank]')).toHaveLength(0);
    fireEvent.pointerEnter(map());
    const spokes = [...map().querySelectorAll('[data-neighbour-line]')].map((l) =>
      l.getAttribute('data-neighbour-line'),
    );
    expect(spokes).toEqual(['sub002', 'sub004', 'sub001', 'sub005', 'sub006']);
    // Numbered as the Nearest list numbers them: sub006, nearest on screen, is 5th.
    const ranks = Object.fromEntries(
      [...map().querySelectorAll('[data-neighbour-rank]')].map((t, i) => [spokes[i], t.textContent]),
    );
    expect(ranks).toEqual({ sub002: '1', sub004: '1', sub001: '3', sub005: '3', sub006: '5' });
    // The numerals never overprint the focused label.
    const box = (el: Element) => {
      const x = Number(el.getAttribute('x')),
        y = Number(el.getAttribute('y'));
      const w = (el.textContent ?? '').length * 6;
      const anchor = el.getAttribute('text-anchor');
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return { x0, x1: x0 + w, y0: y - 8, y1: y + 2.5 };
    };
    const focusBox = box(map().querySelector('[data-focus-label]')!);
    for (const rank of map().querySelectorAll('[data-neighbour-rank]')) {
      const b = box(rank);
      expect(
        Math.min(b.x1, focusBox.x1) > Math.max(b.x0, focusBox.x0) &&
          Math.min(b.y1, focusBox.y1) > Math.max(b.y0, focusBox.y0),
      ).toBe(false);
    }
    fireEvent.pointerLeave(map());
    expect(map().querySelectorAll('[data-neighbour-line], [data-neighbour-rank]')).toHaveLength(0);
    // The keyboard on the map shows them too.
    act(() => (map().querySelector('circle[data-datum-id="sub003"]') as SVGElement).focus());
    expect(map().querySelectorAll('[data-neighbour-line]')).toHaveLength(5);
    act(() => (map().querySelector('circle[data-datum-id="sub003"]') as SVGElement).blur());
    expect(map().querySelectorAll('[data-neighbour-line]')).toHaveLength(0);
    // Pointing at the focused subject elsewhere (its tile) shows them.
    cleanup();
    render(<SimilarityStrip {...props({ focusedId: 'sub003', linkedId: 'sub003' })} />);
    expect(map().querySelectorAll('[data-neighbour-line]')).toHaveLength(5);
    // No spokes without a focused subject.
    cleanup();
    render(<SimilarityStrip {...props({ focusedId: null })} />);
    fireEvent.pointerEnter(map());
    expect(map().querySelectorAll('[data-neighbour-line], [data-neighbour-rank]')).toHaveLength(0);
  });

  it('lassos by dragging on empty space; Shift adds; a click focuses; Escape clears, then folds', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    await fit();
    const onCollapsedChange = vi.fn();
    render(<Live onCollapsedChange={onCollapsedChange} />);
    expect(screen.queryByRole('button', { name: /Lasso/ })).toBeNull();
    lassoAround('sub001');
    expect(state().population.working).toMatchObject({
      kind: 'members',
      memberIds: ['sub001'],
      origin: 'map-derived',
      label: 'Similarity map lasso',
    });
    lassoAround('sub002', true);
    expect((state().population.working as { memberIds: string[] }).memberIds).toEqual([
      'sub001',
      'sub002',
    ]);
    // A click on empty space (no drag) changes nothing.
    fireEvent.pointerDown(map(), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(map(), { clientX: 5, clientY: 5 });
    expect((state().population.working as { memberIds: string[] }).memberIds).toHaveLength(2);
    // A click on a point focuses it and draws no lasso.
    const point = map().querySelector('circle[data-datum-id="sub004"]')!;
    fireEvent.pointerDown(point, { button: 0 });
    fireEvent.click(point);
    expect(map()).not.toHaveAttribute('data-lasso');
    expect(state().selection.activeMemberId).toBe('sub004');
    // Escape clears the selection first, keeping the map open…
    fireEvent.keyDown(map(), { key: 'Escape' });
    expect(state().population.working.kind).toBe('context');
    expect(onCollapsedChange).not.toHaveBeenCalled();
    // …then, with nothing to clear, folds it.
    fireEvent.keyDown(map(), { key: 'Escape' });
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('⌘ (Ctrl off a Mac) is the additive key for point clicks and the lasso, like Shift', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const setPlatform = (value: string) =>
      Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
    try {
      setPlatform('MacIntel');
      await fit();
      const view = render(<Live />);
      lassoAround('sub001');
      lassoAround('sub002', { metaKey: true });
      expect((state().population.working as { memberIds: string[] }).memberIds).toEqual(['sub001', 'sub002']);
      fireEvent.click(map().querySelector('circle[data-datum-id="sub004"]')!, { metaKey: true });
      expect((state().population.working as { memberIds: string[] }).memberIds).toEqual([
        'sub001',
        'sub002',
        'sub004',
      ]);
      expect(map().querySelector('circle[data-datum-id="sub004"] title')!.textContent).toMatch(
        /Shift- or ⌘-click to select/,
      );
      view.unmount();
      // Elsewhere Ctrl adds; ⌘ (the Windows key) does not.
      setPlatform('Win32');
      render(<Live />);
      fireEvent.click(map().querySelector('circle[data-datum-id="sub004"]')!, { ctrlKey: true });
      expect((state().population.working as { memberIds: string[] }).memberIds).toEqual(['sub001', 'sub002']);
      lassoAround('sub004', { metaKey: true });
      expect((state().population.working as { memberIds: string[] }).memberIds).toEqual(['sub004']);
      lassoAround('sub001', { ctrlKey: true });
      expect((state().population.working as { memberIds: string[] }).memberIds).toEqual(['sub001', 'sub004']);
      expect(map().querySelector('circle[data-datum-id="sub004"] title')!.textContent).toMatch(
        /Shift- or Ctrl-click to select/,
      );
    } finally {
      delete (window.navigator as { platform?: string }).platform;
    }
  });

  it('draws the lasso at most once per animation frame, however many pointer moves arrive', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    try {
      await fit();
      render(<Live />);
      const [x, y] = at('sub001');
      fireEvent.pointerDown(map(), { button: 0, clientX: x - 3, clientY: y - 3 });
      for (let i = 0; i < 12; i++) fireEvent.pointerMove(map(), { clientX: x + i, clientY: y - 3 });
      // Twelve moves, one frame asked for, nothing drawn until it runs.
      expect(frames).toHaveLength(1);
      expect(map().querySelector('[data-mark="lasso"]')).toBeNull();
      act(() => frames.shift()!(0));
      const drawn = map().querySelector('[data-mark="lasso"]')!;
      expect(drawn.getAttribute('points')!.split(' ')).toHaveLength(13);
      // The release still selects from the whole path.
      fireEvent.pointerMove(map(), { clientX: x + 3, clientY: y + 3 });
      fireEvent.pointerMove(map(), { clientX: x - 3, clientY: y + 3 });
      fireEvent.pointerUp(map(), { clientX: x - 3, clientY: y - 3 });
      expect(state().population.working).toMatchObject({ memberIds: ['sub001'] });
      expect(map()).not.toHaveAttribute('data-lasso');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Escape mid-drag cancels the lasso without selecting', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    await fit();
    render(<Live />);
    const [x, y] = at('sub001');
    fireEvent.pointerDown(map(), { button: 0, clientX: x - 3, clientY: y - 3 });
    fireEvent.pointerMove(map(), { clientX: x + 3, clientY: y - 3 });
    expect(map()).toHaveAttribute('data-lasso', 'drawing');
    fireEvent.keyDown(map(), { key: 'Escape' });
    expect(map()).not.toHaveAttribute('data-lasso');
    fireEvent.pointerUp(map(), { clientX: x - 3, clientY: y + 3 });
    expect(state().population.working.kind).toBe('context');
  });

  it('hover is shared: another view\'s hover rings the point and reaches the tiles; a point publishes its own', async () => {
    await fit();
    const onHoverMember = vi.fn();
    render(<SimilarityStrip {...props({ onHoverMember })} />);
    act(() => populationMemberHover.set('sub004', 'inspector'));
    expect(onHoverMember).toHaveBeenLastCalledWith('sub004');
    const ring = map().querySelector('[data-mark="linked"]')!;
    expect(ring.getAttribute('cx')).toBe(at('sub004')[0].toString());
    act(() => populationMemberHover.set(null, 'inspector'));
    expect(onHoverMember).toHaveBeenLastCalledWith(null);
    expect(map().querySelector('[data-mark="linked"]')).toBeNull();
    fireEvent.pointerEnter(map().querySelector('circle[data-datum-id="sub002"]')!);
    expect(populationMemberHover.getSnapshot()).toEqual({ memberId: 'sub002', source: 'map' });
    expect(onHoverMember).toHaveBeenLastCalledWith('sub002');
  });

  it('does not send the montage\'s own hover back to the montage (a tile never rings itself)', async () => {
    await fit();
    const onHoverMember = vi.fn();
    render(<SimilarityStrip {...props({ onHoverMember })} />);
    act(() => populationMemberHover.set('sub004', 'montage'));
    expect(onHoverMember).not.toHaveBeenCalled();
    act(() => populationMemberHover.set(null, 'montage'));
    expect(onHoverMember).not.toHaveBeenCalled();
    // The Values dock's hover is forwarded, as the Inspector's is.
    act(() => populationMemberHover.set('sub003', 'values'));
    expect(onHoverMember).toHaveBeenLastCalledWith('sub003');
  });
});
