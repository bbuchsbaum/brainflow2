import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PopulationLens } from '../PopulationLens';
import { populationLensMemory } from '../populationLensMemory';
import {
  PopulationSliceService,
  type PopulationSliceRequest,
} from '@/services/studio/PopulationSliceService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { limitDisplay } from '../montageModel';
import {
  groupStatisticTitle,
  planeValueAt,
  neighbouringSubject,
  subjectDifference,
  unitCountText,
} from '../summaryPaneModel';

vi.mock('@/components/views/sliceViewer', () => ({
  ReusableSliceViewport: () => null,
  SliceViewerImageSurface: () => null,
  clientPointToWorld: vi.fn(),
}));

// The plane both panes are sampled on: four pixels, the group mean and the
// focused subject's own values, with one pixel the subject has no value at.
const GROUP = [1, 2, 3, 4];
const SUBJECT = [2, 0, null, 8];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  populationLensMemory.reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const evaluate = vi.fn(async (request: PopulationSliceRequest) => ({
    plane: {
      origin_mm: [0, 0, 0] as [number, number, number],
      u_mm: [1, 0, 0] as [number, number, number],
      v_mm: [0, 1, 0] as [number, number, number],
      dim_px: [4, 1] as [number, number],
    },
    centerWorld: [10, 20, 30] as [number, number, number],
    contextRange: [-2, 8] as [number, number],
    summary: GROUP,
    focused: SUBJECT,
    validCounts: Array(4).fill(request.workingMemberIds.length),
    eligibleCount: request.workingMemberIds.length,
    unitCount: request.workingMemberIds.length,
    sources: request.members.map((member) => ({
      memberId: member.memberId,
      revision: { sha256: 'hash', sourceBytes: 400 },
    })),
    cutouts: null,
    sourceCacheHit: true,
    cachedBytes: 120,
    sampling: 'nearest' as const,
  }));
  const service = new PopulationSliceService(
    {
      evaluate,
      release: vi.fn().mockResolvedValue(undefined),
      bitmap: async () => ({ width: 4, height: 1, close: vi.fn() }) as unknown as ImageBitmap,
    },
    0,
  );
  render(
    <StrictMode>
      <PopulationLens service={service} />
    </StrictMode>,
  );
  return { service, evaluate };
}

describe('summary pane model', () => {
  it('subtracts the group statistic pixel by pixel, with no value where either has none', () => {
    // Hand computed: 2 − 1, 0 − 2, (none), 8 − 4; NaN in the group is none too.
    expect(subjectDifference(SUBJECT, GROUP)).toEqual([1, -2, null, 4]);
    expect(subjectDifference([1, 2], [Number.NaN, null])).toEqual([null, null]);
    // The value under a world point: the pixel it falls in, none off the raster.
    const plane = { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [4, 1] };
    const difference = subjectDifference(SUBJECT, GROUP);
    expect(planeValueAt(difference, plane, [3.2, 0, 0])).toBe(4);
    expect(planeValueAt(difference, plane, [1, 0.1, 0])).toBe(-2);
    expect(planeValueAt(difference, plane, [2, 0, 0])).toBeNull();
    expect(planeValueAt(difference, plane, [9, 0, 0])).toBeNull();
    expect(planeValueAt(difference, plane, [0, 0, 5])).toBeNull();
  });
  it('names the statistic and the units', () => {
    expect(groupStatisticTitle('Mean')).toBe('Group mean');
    expect(groupStatisticTitle('Median')).toBe('Group median');
    // Averaged per participant.
    expect(unitCountText(3, { aggregated: true, participants: null })).toBe('3 participants');
    // No identity declared: nothing says who is who.
    expect(unitCountText(80, { aggregated: false, participants: null })).toBe('80 observations');
    // One observation per declared participant.
    expect(unitCountText(35, { aggregated: false, participants: 35 })).toBe('35 subjects');
    expect(unitCountText(1, { aggregated: false, participants: 1 })).toBe('1 subject');
    // Runs or sessions: several observations of some participants.
    expect(unitCountText(80, { aggregated: false, participants: 41 })).toBe(
      '80 observations from 41 participants',
    );
    expect(neighbouringSubject(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(neighbouringSubject(['a', 'b', 'c'], 'a', -1)).toBeNull();
  });
});

describe('Summary view', () => {
  it('titles the group statistic with what it was computed over, and the right pane with the subject ID', async () => {
    const { service } = setup();
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const n = service.getSnapshot().displayed!.data.unitCount;
    // No participant identity declared: observations.
    expect(screen.getByText(`Group mean · ${n} observations`)).toBeInTheDocument();
    // Each row declared its own participant: subjects.
    const setId = useSetStudioStore.getState().selection.activeSetId!;
    act(() =>
      useSetStudioStore.setState((state) => ({
        population: {
          ...state.population,
          participants: { setId, identity: { kind: 'observationIds' }, reduction: 'observations' },
        },
      })),
    );
    await waitFor(() => expect(screen.getByText(`Group mean · ${n} subjects`)).toBeInTheDocument());
    // Two rows of one person: observations from participants.
    const ids = useSetStudioStore.getState().sets[setId].memberIds;
    act(() =>
      useSetStudioStore.setState((state) => ({
        population: {
          ...state.population,
          participants: {
            setId,
            identity: {
              kind: 'saved',
              groups: [
                { participantId: 'P1', memberIds: ids.slice(0, 2) },
                ...ids.slice(2).map((id, i) => ({ participantId: `P${i + 2}`, memberIds: [id] })),
              ],
            },
            reduction: 'observations',
          },
        },
      })),
    );
    await waitFor(() =>
      expect(
        screen.getByText(`Group mean · ${n} observations from ${n - 1} participants`),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Actual observation/)).toBeNull();
    const id = useSetStudioStore.getState().selection.activeMemberId!;
    const subject = screen.getByTestId('population-focused-subject');
    expect(subject).toHaveTextContent(new RegExp(`^${id}$`));
    expect(subject.className).toContain('font-mono');
  });

  it('steps to the previous and next subject with the focus actions', async () => {
    const { service } = setup();
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const before = useSetStudioStore.getState().selection.activeMemberId!;
    fireEvent.click(screen.getByRole('button', { name: 'Next subject' }));
    const after = useSetStudioStore.getState().selection.activeMemberId!;
    expect(after).not.toBe(before);
    await waitFor(() =>
      expect(service.getSnapshot().displayed?.query.request.focusMemberId).toBe(after),
    );
    expect(screen.getByTestId('population-focused-subject')).toHaveTextContent(after);
    fireEvent.click(screen.getByRole('button', { name: 'Previous subject' }));
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe(before);
  });

  it('shows the difference from the mean on the shared value scale, stated by the one bar below', async () => {
    const { service, evaluate } = setup();
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const view = screen.getByRole('combobox', { name: 'Subject view' });
    expect([...view.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Map',
      'Difference from mean',
    ]);
    const calls = evaluate.mock.calls.length;
    act(() => {
      fireEvent.change(view, { target: { value: 'difference' } });
    });
    // The shared limit, the one the subject's own map uses: stated once, by
    // the bar below the maps, not in the pane header nor in a bar of its own.
    const limit = service.getSnapshot().displayed!.effectLimit;
    expect(screen.getByTestId('population-scale-focused')).not.toHaveTextContent(/ to /);
    expect(screen.queryAllByTestId('population-colorbar')).toHaveLength(0);
    expect(screen.getByTestId('montage-scale-bar')).toHaveAccessibleName(
      new RegExp(`^Colour scale, ${limitDisplay(-limit)} to ${limitDisplay(limit)}:`),
    );
    // Made from the planes already there: nothing is requested.
    expect(evaluate.mock.calls.length).toBe(calls);
    act(() => {
      fireEvent.change(view, { target: { value: 'map' } });
    });
    expect(screen.getByTestId('population-scale-focused')).not.toHaveTextContent('subject − mean');
  });

  it('does not offer the difference while participants are averaged', async () => {
    const setId = useSetStudioStore.getState().selection.activeSetId!;
    useSetStudioStore.setState((state) => ({
      population: {
        ...state.population,
        participants: { setId, identity: { kind: 'observationIds' }, reduction: 'mean' },
      },
    }));
    const { service } = setup();
    await waitFor(() =>
      expect(service.getSnapshot().displayed?.query.request.aggregation).toBeTruthy(),
    );
    const view = screen.getByRole('combobox', { name: 'Subject view' });
    expect(within(view).getByRole('option', { name: 'Difference from mean' })).toBeDisabled();
    expect(view).toHaveAttribute('title', expect.stringMatching(/participants are averaged/));
  });

  it('quick clicks while an image is fetched each move one subject', async () => {
    const { service } = setup();
    await waitFor(() => expect(service.getSnapshot().displayed).not.toBeNull());
    const ids = useSetStudioStore.getState().sets[
      useSetStudioStore.getState().selection.activeSetId!
    ].memberIds;
    act(() => useSetStudioStore.getState().setActiveMember(ids[0]));
    await waitFor(() =>
      expect(service.getSnapshot().displayed?.query.request.focusMemberId).toBe(ids[0]),
    );
    const next = screen.getByRole('button', { name: 'Next subject' });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(useSetStudioStore.getState().selection.activeMemberId).toBe(ids[3]);
  });
});
