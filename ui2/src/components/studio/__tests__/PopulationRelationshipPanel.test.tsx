import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PopulationRelationshipPanel } from '../PopulationRelationshipPanel';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  populationRelationshipService,
  relationshipUsable,
  type RelationshipFit,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import { syntheticFit, syntheticV2Fit } from '@/services/studio/__tests__/relationshipFixtures';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));

class NoResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', NoResizeObserver);

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

/** Fit the demo context (sub001…sub006) through the shared service. */
async function fitWith(make: (request: RelationshipRequest) => RelationshipFit) {
  invoke.mockImplementation(async (command: string, args: { request: RelationshipRequest }) =>
    command === 'fit_population_relationship' ? make(args.request) : undefined,
  );
  await act(async () => {
    await populationRelationshipService.fit('effect');
  });
  expect(populationRelationshipService.getSnapshot().fit).not.toBeNull();
}
function markStale() {
  const fit = populationRelationshipService.getSnapshot().fit!;
  act(() =>
    populationRelationshipService.observeSources(
      fit.request.members.map((m) => ({
        memberId: m.memberId,
        revision: { sha256: 'd'.repeat(64) },
      })),
    ),
  );
}
const neighbourTable = () => screen.getByRole('table', { name: /Observations nearest to/ });
const rows = () => within(neighbourTable()).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('relationship fit line', () => {
  it('reports k = 3 neighbour preservation beside stress', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel />);
    const line = screen.getByTestId('relationship-fit-line');
    expect(line.textContent).toMatch(/normalized stress 0\.000/);
    // Points on a line keep every true neighbourhood.
    expect(screen.getByTestId('neighbour-preservation').textContent).toBe(
      'nearest neighbours kept on screen 100% (k = 3)',
    );
  });

  it('says not informative when n ≤ 4', async () => {
    await fitWith((request) => syntheticV2Fit(request, [4, 5]));
    render(<PopulationRelationshipPanel />);
    expect(screen.getByTestId('neighbour-preservation').textContent).toBe(
      'neighbour preservation not informative (n ≤ 4)',
    );
    expect(screen.getByText(/4 of 6 observations placed/)).toBeInTheDocument();
  });
});

describe('neighbour table', () => {
  it('ranks the focused observation’s neighbours by declared distance with screen ranks', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel />);
    expect(state().selection.activeMemberId).toBe('sub003');
    expect(
      within(neighbourTable()).getByRole('columnheader', { name: /Distance/ }).textContent,
    ).toMatch(/RMS difference, map units/);
    expect(rows().map(cells)).toEqual([
      ['1', 'sub002', '1.00', '1st', 'Compare'],
      ['1', 'sub004', '1.00', '1st', 'Compare'],
      ['3', 'sub001', '2.00', '3rd', 'Compare'],
      ['3', 'sub005', '2.00', '3rd', 'Compare'],
      ['5', 'sub006', '3.00', '5th', 'Compare'],
    ]);
    expect(screen.queryByTestId('neighbour-screen-note')).toBeNull();
    // The plot joins the focus to its true nearest three (ties included) and numbers them.
    const lines = [...document.querySelectorAll('[data-neighbour-line]')].map((l) =>
      l.getAttribute('data-neighbour-line'),
    );
    expect(lines).toEqual(['sub002', 'sub004', 'sub001', 'sub005']);
    expect(
      [...document.querySelectorAll('[data-neighbour-rank]')].map((t) => t.textContent),
    ).toEqual(['1', '1', '3', '3']);
  });

  it('notes when the nearest point on screen is not a true neighbour', async () => {
    await fitWith((request) => {
      const fit = syntheticFit(request);
      // sub006 is the farthest by distance but drawn next to sub003.
      fit.geometry.coordinates[5] = [2, 0.05];
      return fit;
    });
    render(<PopulationRelationshipPanel />);
    expect(screen.getByTestId('neighbour-screen-note').textContent).toBe(
      'sub006 is nearest on screen but 5th by distance. The 2D layout misplaces it.',
    );
    const sub001 = rows().find((r) => cells(r)[1] === 'sub001')!;
    expect(within(sub001).getAllByRole('cell')[3]).toHaveAttribute('data-flagged', 'true');
  });

  it('hands the pair to the explanation in pair mode on Compare', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel />);
    const explanation = screen.getByLabelText(
      'Explain spatial relationships',
    ) as HTMLDetailsElement;
    expect(explanation.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Compare sub003 with sub004' }));
    expect(explanation.open).toBe(true);
    expect(
      within(explanation).getByRole('combobox', { name: 'Relationship explanation' }),
    ).toHaveValue('pair');
    expect(within(explanation).getByRole('combobox', { name: 'First comparison map' })).toHaveValue(
      'sub003',
    );
    expect(
      within(explanation).getByRole('combobox', { name: 'Second comparison map' }),
    ).toHaveValue('sub004');
    expect(document.activeElement).toBe(
      within(explanation).getByRole('button', { name: 'Show current slice' }),
    );
    // Compare does not evaluate anything by itself.
    expect(invoke).toHaveBeenCalledTimes(1);
    // A second Compare re-applies even after the user changed the pair.
    fireEvent.change(within(explanation).getByRole('combobox', { name: 'Second comparison map' }), {
      target: { value: 'sub006' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Compare sub003 with sub004' }));
    expect(
      within(explanation).getByRole('combobox', { name: 'Second comparison map' }),
    ).toHaveValue('sub004');
  });

  it('ignores a Compare request after a refit', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare sub003 with sub004' }));
    expect((screen.getByLabelText('Explain spatial relationships') as HTMLDetailsElement).open).toBe(
      true,
    );
    const outside = screen.getByRole('button', { name: 'Fit on current support' });
    outside.focus();
    await fitWith((request) => ({ ...syntheticFit(request), fitId: 'e'.repeat(64) }));
    const explanation = screen.getByLabelText('Explain spatial relationships') as HTMLDetailsElement;
    expect(explanation.open).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('focuses a neighbour from its ID', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus sub006' }));
    expect(state().selection.activeMemberId).toBe('sub006');
    expect(rows().map((r) => cells(r)[1])[0]).toBe('sub005');
  });
});

describe('nearest the selection centroid', () => {
  const list = () =>
    screen.getByRole('listbox', { name: 'Observations nearest the selection centroid' });
  const ids = () =>
    within(list())
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('ranks fitted members by distance to the selection centroid on the common support', async () => {
    await fitWith(syntheticFit);
    act(() => state().selectPopulationMembers(['sub001', 'sub002', 'sub006']));
    render(<PopulationRelationshipPanel summaryKind="mean" />);
    // Equal weights: centroid at 2 on the line.
    expect(ids()[0]).toBe('1sub0030');
    const section = screen.getByRole('region', { name: 'Nearest the selection centroid' });
    expect(section.textContent).toMatch(/common support \(90 voxels\)/);
    expect(section.textContent).toMatch(/from 3 observations selected and placed/);
    fireEvent.click(within(list()).getAllByRole('option')[1]);
    expect(state().selection.activeMemberId).toBe(
      within(list()).getAllByRole('option')[1].textContent!.slice(1, 7),
    );
  });

  it('weights participants equally when participants are averaged', async () => {
    await fitWith(syntheticFit);
    const setId = state().selection.activeSetId!;
    act(() => {
      state().configurePopulationParticipants({
        setId,
        identity: {
          kind: 'saved',
          groups: [
            { participantId: 'A', memberIds: ['sub001', 'sub002'] },
            { participantId: 'B', memberIds: ['sub003'] },
            { participantId: 'C', memberIds: ['sub004'] },
            { participantId: 'D', memberIds: ['sub005'] },
            { participantId: 'E', memberIds: ['sub006'] },
          ],
        },
        reduction: 'mean',
      });
      state().selectPopulationMembers(['sub001', 'sub002', 'sub006']);
    });
    render(<PopulationRelationshipPanel summaryKind="mean" />);
    // A (sub001, sub002) and E (sub006) weigh ½ each: centroid at 2.75.
    expect(ids()[0]).toBe('1sub0040.250');
    expect(
      screen.getByRole('region', { name: 'Nearest the selection centroid' }).textContent,
    ).toMatch(/each participant weighted equally/);
  });

  it('is disabled with its reason when the summary is not a mean', async () => {
    await fitWith(syntheticFit);
    render(<PopulationRelationshipPanel summaryKind="median" />);
    const section = screen.getByRole('region', { name: 'Nearest the selection centroid' });
    expect(within(section).queryByRole('listbox')).toBeNull();
    expect(section.textContent).toMatch(/available only when the summary is the mean/);
  });

  it('reports selected unassigned members and disables when none is placed', async () => {
    await fitWith((request) => syntheticV2Fit(request, [1, 4]));
    act(() => state().selectPopulationMembers(['sub002', 'sub005']));
    render(<PopulationRelationshipPanel />);
    const section = screen.getByRole('region', { name: 'Nearest the selection centroid' });
    expect(section.textContent).toMatch(/No selected observation has a position in this fit/);
    expect(section.textContent).toMatch(/2 selected observations, sub002, sub005, are unassigned/);
  });

  it('computes for the previewed selection while hold-to-preview applies', async () => {
    await fitWith(syntheticFit);
    act(() => state().selectPopulationMembers(['sub001', 'sub002', 'sub003']));
    render(<PopulationRelationshipPanel />);
    expect(ids()[0]).toBe('1sub0020');
    // Hold without the focused observation (sub003): centroid of sub001, sub002.
    act(() => state().setPopulationPreviewHolding(true));
    const section = screen.getByRole('region', { name: 'Nearest the selection centroid' });
    expect(section).toHaveAttribute('data-preview', 'without');
    expect(section.textContent).toMatch(/Previewing without focused observation/);
    expect(ids().slice(0, 2)).toEqual(['1sub0010.500', '1sub0020.500']);
    act(() => state().setPopulationPreviewHolding(false));
    expect(section).not.toHaveAttribute('data-preview');
  });
});

describe('unassigned observations', () => {
  it('lists each with reason, finite count and support loss, and rows focus', async () => {
    await fitWith((request) => syntheticV2Fit(request, [1, 4]));
    render(<PopulationRelationshipPanel />);
    expect(screen.queryByLabelText('Unassigned observations', { selector: 'p' })).toBeNull();
    const list = screen.getByRole('listbox', { name: 'Unassigned observations' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      'sub002, No finite values, 0 finite voxels, would remove all 90 common voxels',
      'sub005, Low coverage · 42% of the median, 40 finite voxels, would remove 50 common voxels',
    ]);
    expect(screen.getByRole('heading', { name: 'Unassigned (2)' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Rule for this fit: no finite values, or fewer than 0\.9 × the median finite voxels \(95\)/,
      ),
    ).toBeInTheDocument();
    // Unassigned members have no point on the scatter.
    expect(document.querySelector('circle[data-datum-id="sub002"]')).toBeNull();
    expect(document.querySelectorAll('circle[data-datum-id]')).toHaveLength(4);
    // Rows are focusable: one tab stop, arrows move, Enter focuses the observation.
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1]);
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: 'Enter' });
    expect(state().selection.activeMemberId).toBe('sub005');
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(list).getAllByRole('option')[0]);
    expect(state().selection.activeMemberId).toBe('sub002');
  });

  it('explains why a focused unassigned observation has no neighbours', async () => {
    await fitWith((request) => syntheticV2Fit(request, [1, 4]));
    act(() => state().setActiveMember('sub005'));
    render(<PopulationRelationshipPanel />);
    expect(screen.queryByRole('table', { name: /Observations nearest to/ })).toBeNull();
    const area = screen.getByRole('region', { name: 'Nearest to sub005' });
    expect(area.textContent).toMatch(
      /sub005 is not placed in this fit, so it has no distances to rank\. Reason: low coverage · 42% of the median\. Including it would remove 50 voxels/,
    );
    expect(area.textContent).toMatch(/Rule threshold85\.5 \(0\.9 × 95\)/);
    expect(area.textContent).toMatch(/still in the population/);
    expect(document.querySelectorAll('[data-neighbour-line]')).toHaveLength(0);
  });
});

describe('stale fit', () => {
  it('freezes the layout, shows a stale badge and disables ranking actions', async () => {
    await fitWith((request) => syntheticV2Fit(request, [1]));
    render(<PopulationRelationshipPanel />);
    const before = [...document.querySelectorAll('circle[data-datum-id]')].map((c) => [
      c.getAttribute('data-datum-id'),
      c.getAttribute('cx'),
      c.getAttribute('cy'),
    ]);
    expect(relationshipUsable()).toBe(true);
    markStale();
    expect(relationshipUsable()).toBe(false);
    expect(screen.getByText('Out of date')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/layout stays frozen/);
    // Same points, same positions.
    expect(
      [...document.querySelectorAll('circle[data-datum-id]')].map((c) => [
        c.getAttribute('data-datum-id'),
        c.getAttribute('cx'),
        c.getAttribute('cy'),
      ]),
    ).toEqual(before);
    // IDs stay; distances and screen ranks are hidden; Compare is off.
    expect(rows().map((r) => cells(r).slice(1, 4))[0]).toEqual(['sub001', '—', '—']);
    for (const button of within(neighbourTable()).getAllByRole('button', { name: /^Compare/ }))
      expect(button).toBeDisabled();
    expect(screen.getByText('Refit to rank')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-neighbour-line]')).toHaveLength(0);
    expect(
      screen.getByRole('region', { name: 'Nearest the selection centroid' }).textContent,
    ).toMatch(/Unavailable until refit/);
    expect(screen.getByText('As of fit time')).toBeInTheDocument();
    // Unassigned rows remain focusable: these members are in the context.
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Unassigned observations' })).getByRole('option'),
    );
    expect(state().selection.activeMemberId).toBe('sub002');
    expect(screen.getByRole('button', { name: 'Order movie by MDS axis 1' })).toBeDisabled();
  });
});
