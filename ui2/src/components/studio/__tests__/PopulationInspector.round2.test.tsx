import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PopulationInspector } from '../PopulationInspector';
import {
  compareOperandsIssue,
  compareSelectionWithTheRest,
  methodNeedsB,
  sameMembers,
} from '../inferenceDraft';
import { pathListNames, valueStanding } from '../relationshipPresentation';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationProbeController } from '@/services/studio/PopulationProbeController';
import { populationRelationshipService } from '@/services/studio/PopulationRelationshipService';
import { medianPairDistance } from '@/services/studio/relationshipNeighbours';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  state().setActiveLens('population');
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => populationRelationshipService.resetScope(null));
});
const open = (name: string) => {
  const header = screen.getByRole('button', { name: new RegExp(`^${name}`) });
  if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
};

describe('pure helpers', () => {
  it('valueStanding: rank from the lowest among finite values, leave-one-out z', () => {
    const values = [1, 2, 3, null, Number.NaN, 4];
    const standing = valueStanding(3, values)!;
    expect(standing).toMatchObject({ rank: 3, of: 4 });
    // Others 1, 2, 4: mean 7/3, SD √(7/3).
    expect(standing.z).toBeCloseTo((3 - 7 / 3) / Math.sqrt(7 / 3), 12);
    expect(valueStanding(null, values)).toBeNull();
    // Ties share the lower rank; constant others give no z.
    expect(valueStanding(2, [2, 2, 2])).toEqual({ rank: 1, of: 3, z: null });
  });

  it('medianPairDistance: each unordered pair once', () => {
    expect(
      medianPairDistance([
        [0, 1, 4],
        [1, 0, 2],
        [4, 2, 0],
      ]),
    ).toBe(2);
    expect(
      medianPairDistance([
        [0, 1, 3, 5],
        [1, 0, 2, 6],
        [3, 2, 0, 4],
        [5, 6, 4, 0],
      ]),
    ).toBe(3.5);
    expect(medianPairDistance([[0]])).toBeNull();
  });

  it('pathListNames: every path of a comma-separated list, by its short name', () => {
    expect(
      pathListNames('m/same_item.nii.gz,m/same_run.nii.gz,m/temporal_dist.nii.gz')?.map(
        (item) => item.name,
      ),
    ).toEqual(['same_item', 'same_run', 'temporal_dist']);
    expect(pathListNames('site A, site B')).toBeNull();
    expect(pathListNames('m/one.nii.gz')).toBeNull();
  });

  it('compareOperandsIssue: never the set against itself; one-population tests need only A', () => {
    expect(sameMembers(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(compareOperandsIssue({ a: ['a', 'b'], b: ['b', 'a'], aIsSelection: false, needsB: true })).toBe(
      'A and B are the same 2 subjects: choose a different B.',
    );
    expect(compareOperandsIssue({ a: ['a'], b: [], aIsSelection: true, needsB: true })).toBe(
      'Choose B to compare with A.',
    );
    expect(compareOperandsIssue({ a: [], b: ['a'], aIsSelection: true, needsB: true })).toMatch(
      /A is empty/,
    );
    expect(compareOperandsIssue({ a: ['a'], b: ['a'], aIsSelection: true, needsB: false })).toBeNull();
    expect(compareOperandsIssue({ a: ['a'], b: ['b'], aIsSelection: true, needsB: true })).toBeNull();
  });
});

describe('the focused subject (A5, A9)', () => {
  it('lists every map, not only the last, and marks the one shown', () => {
    const setId = state().selection.activeSetId!;
    const roles = 'enc/maps/same_item.nii.gz,enc/maps/same_run.nii.gz,enc/maps/temporal_dist.nii.gz';
    const set = state().sets[setId];
    useSetStudioStore.setState({
      sets: {
        ...state().sets,
        [setId]: {
          ...set,
          memberSummaries: set.memberSummaries.map((member) => ({
            ...member,
            designValues: { roles },
          })),
        },
      },
      selection: { ...state().selection, activeFeatureId: 'enc/maps/same_run.nii.gz' },
    });
    render(<PopulationInspector />);
    const maps = screen.getByTestId('focused-maps');
    expect(maps.textContent).toMatch(/^same_item · same_run · temporal_dist/);
    expect(maps.getAttribute('title')).toContain('enc/maps/same_item.nii.gz\nenc/maps/same_run.nii.gz');
    expect(maps.querySelector('[data-shown]')).toHaveTextContent('same_run');
    expect(maps.previousElementSibling).toHaveTextContent('Maps');
  });

  it('shows the value at the pin with its rank and leave-one-out z', () => {
    const focused = state().selection.activeMemberId!;
    const ids = state().sets[state().selection.activeSetId!].memberIds;
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const query = { key: 'k' };
    vi.spyOn(populationProbeController, 'getSnapshot').mockReturnValue({
      arrangement: null,
      requested: query,
      displayed: {
        query,
        frame: { rows: ids.map((member, i) => ({ member, value: values[i] })) },
      },
      pending: false,
      error: null,
    } as unknown as ReturnType<typeof populationProbeController.getSnapshot>);
    render(<PopulationInspector />);
    const rank = ids.indexOf(focused) + 1;
    const standing = screen.getByTestId('focused-standing');
    expect(standing.textContent).toMatch(new RegExp(`^ · rank ${rank}/6 · z [−\\d]`));
    expect(standing.getAttribute('title')).toMatch(/leave-one-out/);
  });
});

describe('Compare and test never compares the set with itself (A10)', () => {
  it('a B identical to A reads as unchosen and Run says why it is off', () => {
    const ids = state().sets[state().selection.activeSetId!].memberIds;
    const all = state().createSavedCohort({
      memberIds: [...ids],
      label: 'All members',
      originLabel: 'context',
      description: 'every subject',
    })!;
    act(() => state().setCompareCohort(all));
    render(<PopulationInspector />);
    open('Compare and test');
    expect(screen.getByRole('combobox', { name: 'Reference B' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'All members · same as A' })).toBeDisabled();
    expect(screen.getByTestId('compare-operands-issue')).toHaveTextContent(
      'A and B are the same 6 subjects: choose a different B.',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Statistical method' }), {
      target: { value: 'welch' },
    });
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('a linear model or one-sample test takes A alone: no B is asked for and Run is not held', () => {
    expect(methodNeedsB('linearModel')).toBe(false);
    expect(methodNeedsB('oneSample')).toBe(false);
    expect(methodNeedsB('welch')).toBe(true);
    expect(methodNeedsB('paired')).toBe(true);
    expect(methodNeedsB('descriptive')).toBe(true);
    // No usable B: the only cohort is every subject, i.e. A itself.
    const ids = state().sets[state().selection.activeSetId!].memberIds;
    const all = state().createSavedCohort({
      memberIds: [...ids],
      label: 'All members',
      originLabel: 'context',
      description: 'every subject',
    })!;
    act(() => state().setCompareCohort(all));
    render(<PopulationInspector />);
    open('Compare and test');
    const method = screen.getByRole('combobox', { name: 'Statistical method' });
    fireEvent.change(method, { target: { value: 'welch' } });
    expect(screen.getByTestId('compare-operands-issue')).toHaveTextContent(/choose a different B/);
    fireEvent.change(method, { target: { value: 'linearModel' } });
    expect(screen.queryByTestId('compare-operands-issue')).toBeNull();
    fireEvent.change(method, { target: { value: 'oneSample' } });
    expect(screen.queryByTestId('compare-operands-issue')).toBeNull();
  });

  it('a new selection makes B the rest; a B chosen afterwards is kept', () => {
    render(<PopulationInspector />);
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'manual', 'Picked'));
    expect(state().population.referenceMode).toBe('complement');
    open('Compare and test');
    expect(screen.getByRole('combobox', { name: 'Reference B' })).toHaveValue('complement');
    expect(screen.getByTestId('compare-b-count')).toHaveTextContent('B: 4 observations');
    fireEvent.change(screen.getByRole('combobox', { name: 'Reference B' }), {
      target: { value: 'cases-site-b' },
    });
    expect(state().population.referenceMode).toBe('cohort');
    expect(screen.queryByTestId('compare-operands-issue')).toBeNull();
  });

  it('"Compare with the rest" fills A and B and opens Compare and test', () => {
    render(<PopulationInspector />);
    const header = screen.getByRole('button', { name: /^Compare and test/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // Nothing to compare without a selection.
    expect(compareSelectionWithTheRest()).toBe(false);
    act(() => state().selectPopulationMembers(['sub004'], 'manual', 'Picked'));
    act(() => state().setCompareCohort('cases-site-b'));
    if (header.getAttribute('aria-expanded') === 'true') fireEvent.click(header);
    act(() => {
      expect(compareSelectionWithTheRest()).toBe(true);
    });
    expect(state().population.referenceMode).toBe('complement');
    expect(state().population.presentation.arrangement).toBe('comparison');
    expect(screen.getByRole('button', { name: /^Compare and test/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(screen.getByTestId('compare-a')).getByText(/Picked · 1/)).toBeInTheDocument();
  });
});
