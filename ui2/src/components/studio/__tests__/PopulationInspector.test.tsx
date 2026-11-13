import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PopulationInspector } from '../PopulationInspector';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticGroupingFit } from '@/services/studio/__tests__/relationshipFixtures';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
// The explanation beside the nearest list measures itself.
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
  act(() => populationRelationshipService.resetScope(null));
});
const section = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const open = (name: string) => {
  if (section(name).getAttribute('aria-expanded') !== 'true') fireEvent.click(section(name));
};

describe('the Population Inspector (C′)', () => {
  it('reads top to bottom: focused subject, selection, Compare and test, Analysis setup, Coverage and sources', () => {
    render(<PopulationInspector />);
    const root = screen.getByRole('region', { name: 'Population inspector' });
    const order = [
      screen.getByTestId('population-focused-block'),
      screen.getByTestId('population-selection-section'),
      section('Compare and test'),
      section('Analysis setup'),
      section('Coverage and sources'),
    ];
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // The focused block carries Open in Deck and hold-to-preview.
    const focused = screen.getByTestId('population-focused-block');
    expect(within(focused).getByRole('button', { name: 'Open in Deck' })).toBeInTheDocument();
    // The hold control names what it leaves out of which summary.
    expect(
      within(focused).getByRole('button', {
        name: `Group mean without ${state().selection.activeMemberId} (hold)`,
      }),
    ).toBeInTheDocument();
    // C6: one split button: the caret chooses what is left out (a menu, the choice checked).
    const caret = within(focused).getByRole('button', { name: 'Leave out: This subject' });
    expect(caret).toHaveAttribute('aria-haspopup', 'menu');
    expect(within(focused).getByTestId('hold-to-preview').children).toHaveLength(2);
    fireEvent.click(caret);
    // The choices are radio items: the one in force is checked, for assistive tech too.
    expect(screen.getByRole('menuitemradio', { name: 'This subject' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    for (const item of screen.getAllByRole('menuitemradio'))
      if (item.textContent !== 'This subject') expect(item).toHaveAttribute('aria-checked', 'false');
    expect(root).toBeInTheDocument();
  });

  it('names the statistic the hold leaves the subject out of (C6)', () => {
    act(() => usePopulationViewStore.getState().setSummary('oneSampleT'));
    render(<PopulationInspector />);
    const id = state().selection.activeMemberId;
    expect(screen.getByRole('button', { name: `Group t without ${id} (hold)` })).toHaveTextContent(
      `Group t without ${id}`,
    );
    act(() => usePopulationViewStore.getState().setSummary('mean'));
    expect(screen.getByRole('button', { name: `Group mean without ${id} (hold)` })).toBeInTheDocument();
  });

  it('the focused block: the subject as its heading, Open in Deck beside it, no row repeating its ID', () => {
    render(<PopulationInspector />);
    const focused = screen.getByTestId('population-focused-block');
    const id = state().selection.activeMemberId!;
    expect(within(focused).getByRole('heading', { level: 3 })).toHaveTextContent(id);
    expect(focused.textContent).not.toMatch(/focused subject/);
    // The heading names the subject; a metadata value equal to the ID is not shown again.
    expect(
      [...focused.querySelectorAll('dd')].filter((dd) => dd.textContent === id),
    ).toHaveLength(0);
    // The heading and Open in Deck share a row, ahead of the nearest list.
    const deck = within(focused).getByRole('button', { name: 'Open in Deck' });
    expect(deck.parentElement).toBe(
      within(focused).getByRole('heading', { level: 3 }).parentElement!.parentElement,
    );
  });

  it('a selection never hides the focused subject: both are shown, focused first', () => {
    render(<PopulationInspector />);
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'manual', 'Picked'));
    const focused = screen.getByTestId('population-focused-block');
    expect(within(focused).getByRole('button', { name: 'Open in Deck' })).toBeInTheDocument();
    expect(
      focused.compareDocumentPosition(screen.getByTestId('population-selection-section')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('population-selection-section')).toHaveTextContent('2 of 6 · Picked');
  });

  it('owns the selection commands: Select all, Focused only, Clear and Undo selection', () => {
    render(<PopulationInspector />);
    const selection = () => screen.getByTestId('population-selection-section');
    expect(selection()).toHaveTextContent('Selection');
    // Empty: one muted line, and only the command that applies.
    expect(within(selection()).getByTestId('selection-empty')).toHaveTextContent(
      'No selection — summaries use all 6',
    );
    expect(
      within(selection())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Select all']);
    fireEvent.click(within(selection()).getByRole('button', { name: 'Select all' }));
    expect(state().population.working).toMatchObject({ kind: 'members', memberIds: [
      'sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006',
    ] });
    fireEvent.click(within(selection()).getByRole('button', { name: 'Focused only' }));
    expect(state().population.working).toMatchObject({
      kind: 'members',
      memberIds: [state().selection.activeMemberId],
    });
    fireEvent.click(within(selection()).getByRole('button', { name: 'Undo selection' }));
    expect(state().population.working).toMatchObject({ kind: 'members' });
    expect((state().population.working as { memberIds: string[] }).memberIds).toHaveLength(6);
    fireEvent.click(within(selection()).getByRole('button', { name: 'Clear' }));
    expect(state().population.working.kind).toBe('context');
    // Nothing to clear or keep: those commands go; Undo stays while there is history.
    expect(within(selection()).queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(within(selection()).queryByRole('button', { name: 'Focused only' })).toBeNull();
    expect(within(selection()).getByRole('button', { name: 'Undo selection' })).toBeEnabled();
  });

  it('labels an exploratory A with its reason, and only a selection the data chose', () => {
    render(<PopulationInspector />);
    open('Compare and test');
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'map-derived', 'Similarity map lasso'));
    // Said once, where A is named, as quiet text with its reason behind ⓘ (not a chip).
    const labels = screen.getAllByTestId('exploratory-label');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent('Exploratory selection');
    expect(labels[0].className).not.toMatch(/border/);
    expect(labels[0]).toHaveAttribute(
      'title',
      'Chosen from the data; p-values are not valid for confirming it.',
    );
    expect(within(screen.getByTestId('compare-a')).getByTestId('exploratory-label')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('population-selection-section')).queryByTestId('exploratory-label'),
    ).toBeNull();
    const why = screen.getByRole('button', { name: 'Why exploratory' });
    fireEvent.click(why);
    expect(screen.getByTestId('compare-a')).toHaveTextContent(/p-values are not valid/);
    act(() => state().selectPopulationMembers(['sub001', 'sub002'], 'metadata', 'site: X'));
    expect(screen.queryAllByTestId('exploratory-label')).toHaveLength(0);
  });

  it('runs a test only on Run; a new A afterwards waits for the next Run', () => {
    const setId = state().selection.activeSetId!;
    state().configurePopulationParticipants({
      setId,
      identity: { kind: 'observationIds' },
      reduction: 'single',
    });
    // An exploratory A may still be tested (owner decision 2); it keeps its label.
    state().selectPopulationMembers(
      ['sub001', 'sub002', 'sub003', 'sub004'],
      'map-derived',
      'Similarity map lasso',
    );
    render(<PopulationInspector />);
    open('Compare and test');
    open('Analysis setup');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statistical method' }), {
      target: { value: 'oneSample' },
    });
    // Choosing a test runs nothing, and says what is missing.
    expect(state().population.inference).toBeNull();
    expect(screen.getByTestId('test-missing')).toHaveTextContent(/Analysis setup/);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Feature value role' }), {
      target: { value: 'effect' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Effect units' }), {
      target: { value: '% signal change' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /independent participants/ }));
    expect(state().population.inference).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(state().population.inference).toMatchObject({
      method: 'oneSample',
      selectionOrigin: 'map-derived',
    });
    expect(
      screen.getAllByRole('status').some((s) => /A is an exploratory selection/.test(s.textContent ?? '')),
    ).toBe(true);
    // A new selection does not re-run the test.
    act(() => state().selectPopulationMembers(['sub001', 'sub002', 'sub003'], 'manual', 'Picked'));
    expect(screen.getByTestId('test-out-of-date')).toHaveTextContent(
      'A or B changed since the last Run',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.queryByTestId('test-out-of-date')).toBeNull();
    expect(state().population.inference?.selectionOrigin).toBe('manual');
  });

  it('shows the similarity measure read-only, the one store field, beside the editable region', () => {
    render(<PopulationInspector />);
    open('Analysis setup');
    const similarity = screen.getByRole('group', { name: 'Similarity' });
    expect(within(similarity).getByTestId('similarity-measure-readonly')).toHaveTextContent(
      'correlation',
    );
    // Read-only: the only control here is where to compare.
    expect(within(similarity).getAllByRole('combobox').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Compare within',
    ]);
    act(() => state().setPopulationSimilarityMeasure('effect'));
    expect(within(similarity).getByTestId('similarity-measure-readonly')).toHaveTextContent(
      'amplitude',
    );
    // The pinned region needs a pin with a radius; nothing pins silently.
    const within_ = within(similarity).getByRole('combobox', { name: 'Compare within' });
    expect(within(within_).getByRole('option', { name: /Pinned region/ })).toBeDisabled();
    expect(within(within_).getByRole('option', { name: /Pinned region/ })).toHaveTextContent(
      'pin a point first',
    );
    expect(state().population.pinnedProbe).toBeNull();
    act(() =>
      state().setPopulationProbe(
        { supportKey: 'k', worldMm: [1, 2, 3], radiusMm: 6, reduce: 'mean' },
        'pin',
      ),
    );
    expect(within(within_).getByRole('option', { name: /Pinned region/ })).not.toBeDisabled();
    fireEvent.change(within_, { target: { value: 'probe' } });
    expect(state().population.similarityRegion).toBe('probe');
  });

  it('lists who is outside the context, with reasons and no focus targets, under Coverage and sources', () => {
    act(() => state().setActiveScopeCohort('young-controls'));
    render(<PopulationInspector />);
    open('Coverage and sources');
    const table = screen.getByRole('table', { name: 'Observations outside the context' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(
      ['sub002', 'sub004', 'sub005', 'sub006'].map(
        (id) => `${id}Outside the scope cohort Young controls`,
      ),
    );
    expect(table.querySelectorAll('button, input, a, select, [tabindex]')).toHaveLength(0);
  });
});

describe('the nearest list describes the montage\'s fit', () => {
  it('ranks by the grouping\'s correlation fit after an amplitude fit replaces the plot', async () => {
    invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) => ({
      ...syntheticGroupingFit(args.request),
      fitId: (args.request.distance === 'pattern-shape' ? 'c' : 'a').repeat(64),
    }));
    await act(async () => {
      await populationRelationshipService.fit('pattern-shape', false, { reuse: true, grouping: true });
    });
    act(() => populationRelationshipService.group(3));
    await act(async () => {
      await populationRelationshipService.fit('effect', false, { reuse: true, grouping: true });
    });
    const ids = populationRelationshipService.getSnapshot().fit!.request.members.map((m) => m.memberId);
    act(() => state().setActiveMember(ids[0]));
    render(<PopulationInspector />);
    const header = screen.getByTestId('neighbour-distance-header');
    // One short header with the unit in sight; the definition is its title (and read to screen readers).
    expect(header.querySelector('.sr-only')).not.toBeNull();
    expect(header.textContent!.replace(header.querySelector('.sr-only')!.textContent!, '')).toBe(
      'Distance (correlation)',
    );
    expect(header.getAttribute('title')).toMatch(/^Distance: correlation \(√\(2−2r\)\)/);
    expect(header.textContent).not.toMatch(/RMS/);
  });

  it('ranks nothing under groups whose fit is gone, and says why', async () => {
    invoke.mockImplementation(async (_c: string, args: { request: RelationshipRequest }) => ({
      ...syntheticGroupingFit(args.request),
      fitId: (args.request.distance === 'pattern-shape' ? 'c' : 'a').repeat(64),
    }));
    await act(async () => {
      await populationRelationshipService.fit('pattern-shape', false, { reuse: true, grouping: true });
    });
    act(() => populationRelationshipService.group(3));
    // The groups now name a fit this session does not hold.
    act(() =>
      state().setPopulationPartition({ ...state().population.partition!, fitId: 'f'.repeat(64) }),
    );
    const ids = populationRelationshipService.getSnapshot().fit!.request.members.map((m) => m.memberId);
    act(() => state().setActiveMember(ids[0]));
    render(<PopulationInspector />);
    expect(screen.queryByTestId('neighbour-distance-header')).toBeNull();
    expect(
      within(screen.getByRole('group', { name: 'Nearest subjects' })).queryByRole('table'),
    ).toBeNull();
    expect(screen.getByTestId('nearest-missing-fit')).toHaveTextContent(
      /Not ranked: the groups on screen came from an earlier similarity fit/,
    );
  });
});
