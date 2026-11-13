import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewState } from '@/types/viewState';
import { StudioMemberLoadOverlay } from '@/components/studio/StudioMemberLoadOverlay';
import {
  MEMBER_LOAD_REVEAL_MS,
  describeMemberLoad,
  failedLoadForPath,
  pendingLoadForPath,
} from '../useStudioMemberLoad';

const retryActiveMember = vi.hoisted(() => vi.fn());
vi.mock('@/services/studio/StudioCoordinationService', () => ({
  getStudioCoordinationService: () => ({ retryActiveMember }),
}));

const PATH = '/cache/mount-a/sub-01/maps/tstat.nii.gz';
const OTHER = '/cache/mount-a/sub-02/maps/tstat.nii.gz';

const queue = () => useLoadingQueueStore.getState();
const enqueue = (path: string, start = true) => {
  const id = queue().enqueue({ type: 'volume-load', path, displayName: path.split('/').slice(-3)[0] });
  if (start) queue().startLoading(id);
  return id;
};
const item = (path: string) => pendingLoadForPath(queue(), path)!;

beforeEach(() => {
  useLoadingQueueStore.setState({ queue: [], activeLoads: new Map(), completed: [] });
  useLayerStore.setState({ layers: [], layerMetadata: new Map() });
  showInActiveView([]);
});

/** The layers the active view draws (the layer store holds every workspace's). */
function showInActiveView(layerIds: string[]): void {
  useViewStateStore.setState((state) => ({
    viewState: { ...state.viewState, layers: layerIds.map((id) => ({ id })) } as unknown as ViewState,
  }));
}

describe('pendingLoadForPath', () => {
  it('finds the queued or active load of one source path and no other', () => {
    enqueue(OTHER);
    expect(pendingLoadForPath(queue(), PATH)).toBeNull();
    const id = enqueue(PATH, false);
    expect(item(PATH).status).toBe('queued');
    queue().startLoading(id);
    expect(item(PATH).status).toBe('loading');
    expect(pendingLoadForPath(queue(), `  ${PATH} `)?.id).toBe(id);
    expect(pendingLoadForPath(queue(), null)).toBeNull();
  });

  it('keeps the item reference until the item changes, and drops finished loads', () => {
    const id = enqueue(PATH);
    const first = item(PATH);
    queue().updateTransferProgress(OTHER, 1, 2);
    expect(item(PATH)).toBe(first);
    queue().updateTransferProgress(PATH, 1048576, 4194304);
    expect(item(PATH)).not.toBe(first);
    queue().markComplete(id);
    expect(pendingLoadForPath(queue(), PATH)).toBeNull();
  });
});

describe('describeMemberLoad', () => {
  it('reports a waiting load without a fraction', () => {
    enqueue(PATH, false);
    expect(describeMemberLoad(item(PATH))).toEqual({
      name: 'sub-01',
      stage: 'Waiting to open',
      progress: null,
    });
  });

  it('reports download bytes with a fraction, then decoding without one', () => {
    const id = enqueue(PATH);
    expect(describeMemberLoad(item(PATH))).toMatchObject({ stage: 'Opening', progress: null });
    queue().updateTransferProgress(PATH, 12.3 * 1048576, 80 * 1048576);
    const downloading = describeMemberLoad(item(PATH));
    expect(downloading.stage).toBe('Downloading 12.3 / 80.0 MiB');
    expect(downloading.progress).toBeCloseTo(15.375);
    queue().updateTransferProgress(PATH, 80 * 1048576, 80 * 1048576);
    expect(describeMemberLoad(item(PATH))).toMatchObject({
      stage: 'Download complete · decoding image',
      progress: null,
    });
    queue().updateProgress(id, undefined, 'Preparing display');
    expect(describeMemberLoad(item(PATH))).toMatchObject({
      stage: 'Preparing display',
      progress: null,
    });
  });
});

describe('StudioMemberLoadOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const reveal = () => act(() => void vi.advanceTimersByTime(MEMBER_LOAD_REVEAL_MS));

  it('names the member, its stage and a determinate bar while it downloads', () => {
    enqueue(PATH);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    expect(screen.queryByTestId('studio-member-opening')).toBeNull();
    reveal();
    expect(screen.getByText('Opening sub-01')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    act(() => queue().updateTransferProgress(PATH, 20 * 1048576, 80 * 1048576));
    expect(screen.getByText('Downloading 20.0 / 80.0 MiB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('shows nothing for a load that finishes before the reveal delay', () => {
    const id = enqueue(PATH);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => void vi.advanceTimersByTime(MEMBER_LOAD_REVEAL_MS - 1));
    act(() => queue().markComplete(id));
    reveal();
    expect(screen.queryByTestId('studio-member-opening')).toBeNull();
  });

  it("leaves once the member's layer exists, and ignores other members' loads", () => {
    enqueue(PATH);
    enqueue(OTHER);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    reveal();
    expect(screen.getByTestId('studio-member-opening')).toBeInTheDocument();
    act(() => {
      useLayerStore.setState({
        layers: [{ id: 'member', name: 'member', sourcePath: PATH } as unknown as LayerInfo],
      });
    });
    // Loaded, but in another tab's view: this view still waits for its own.
    expect(screen.getByTestId('studio-member-opening')).toBeInTheDocument();
    act(() => showInActiveView(['member']));
    expect(screen.queryByTestId('studio-member-opening')).toBeNull();
  });

  it('starts the delay again for the next member', () => {
    enqueue(PATH);
    const view = render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    reveal();
    enqueue(OTHER);
    view.rerender(<StudioMemberLoadOverlay sourcePath={OTHER} />);
    expect(screen.queryByTestId('studio-member-opening')).toBeNull();
    reveal();
    expect(screen.getByText('Opening sub-02')).toBeInTheDocument();
  });
});

describe('a member that could not be opened (review item 5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    retryActiveMember.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const fail = (path: string, reason: string) => queue().markError(enqueue(path), new Error(reason));

  it("finds the path's last finished load only when it failed", () => {
    expect(failedLoadForPath(queue(), PATH)).toBeNull();
    fail(PATH, 'Not a NIfTI file');
    const failed = failedLoadForPath(queue(), PATH);
    expect(failed?.error?.message).toBe('Not a NIfTI file');
    expect(failedLoadForPath(queue(), PATH)).toBe(failed);
    expect(failedLoadForPath(queue(), OTHER)).toBeNull();
    queue().markComplete(enqueue(PATH));
    expect(failedLoadForPath(queue(), PATH)).toBeNull();
  });

  it('says which member failed and why, in place of the loading card', () => {
    const id = enqueue(PATH);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => void vi.advanceTimersByTime(MEMBER_LOAD_REVEAL_MS));
    expect(screen.getByTestId('studio-member-opening')).toBeInTheDocument();

    act(() => queue().markError(id, new Error('Mount trillium is disconnected')));

    expect(screen.queryByTestId('studio-member-opening')).toBeNull();
    const failed = screen.getByTestId('studio-member-failed');
    expect(failed).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Could not open sub-01')).toBeInTheDocument();
    expect(screen.getByText('Mount trillium is disconnected')).toBeInTheDocument();
  });

  it('retries through the coordination service and gives way to the new load', () => {
    fail(PATH, 'Mount trillium is disconnected');
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryActiveMember).toHaveBeenCalledTimes(1);

    // The retry's load: the failure is gone at once, the card after the delay.
    act(() => void enqueue(PATH));
    expect(screen.queryByTestId('studio-member-failed')).toBeNull();
    act(() => void vi.advanceTimersByTime(MEMBER_LOAD_REVEAL_MS));
    expect(screen.getByText('Opening sub-01')).toBeInTheDocument();
  });

  it('belongs to its member: another member, or a loaded one, shows none', () => {
    fail(PATH, 'Not a NIfTI file');
    const view = render(<StudioMemberLoadOverlay sourcePath={OTHER} />);
    expect(screen.queryByTestId('studio-member-failed')).toBeNull();
    view.rerender(<StudioMemberLoadOverlay sourcePath={PATH} />);
    expect(screen.getByTestId('studio-member-failed')).toBeInTheDocument();
    act(() => {
      useLayerStore.setState({
        layers: [{ id: 'member', name: 'member', sourcePath: PATH } as unknown as LayerInfo],
      });
      showInActiveView(['member']);
    });
    expect(screen.queryByTestId('studio-member-failed')).toBeNull();
  });
});

describe('the loading card leaves the view in sight (review item 6)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is a card on the canvas ground, not a cover, and fills with a control token', () => {
    enqueue(PATH);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => void vi.advanceTimersByTime(MEMBER_LOAD_REVEAL_MS));
    const overlay = screen.getByTestId('studio-member-opening');
    // The overlay itself paints nothing: the template under it stays drawn.
    expect(overlay.className).not.toMatch(/\bbg-/);
    expect(screen.getByText('Opening sub-01').parentElement?.className).toContain(
      'bg-bf-bg-canvas',
    );
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.className).toContain('bg-primary');
    expect(fill.className).not.toMatch(/bg-bf-text-/);
  });
});
