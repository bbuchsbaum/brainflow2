/**
 * ActivityPanel — replaces the bottom dock's activity placeholder with a
 * read-only view of `useLoadingQueueStore` (active / queued / recent).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { ActivityPanel } from '../ActivityPanel';
import {
  useLoadingQueueStore,
  type LoadingQueueItem,
} from '@/stores/loadingQueueStore';

function resetQueue() {
  act(() => {
    useLoadingQueueStore.setState({
      queue: [],
      activeLoads: new Map(),
      completed: [],
    });
  });
}

function seedQueue(state: {
  queue?: LoadingQueueItem[];
  active?: LoadingQueueItem[];
  completed?: LoadingQueueItem[];
}) {
  act(() => {
    useLoadingQueueStore.setState({
      queue: state.queue ?? [],
      activeLoads: new Map((state.active ?? []).map((item) => [item.id, item])),
      completed: state.completed ?? [],
    });
  });
}

function makeItem(over: Partial<LoadingQueueItem>): LoadingQueueItem {
  return {
    id: over.id ?? 'qid-1',
    type: over.type ?? 'volume-load',
    path: over.path ?? '/data/sub-01/sub-01.nii.gz',
    displayName: over.displayName ?? 'sub-01.nii.gz',
    status: over.status ?? 'queued',
    progress: over.progress,
    startTime: over.startTime,
    endTime: over.endTime,
    error: over.error,
    result: over.result,
    retry: over.retry,
  };
}

describe('ActivityPanel', () => {
  beforeEach(() => {
    resetQueue();
  });

  it('renders the empty state when nothing is queued, active, or completed', () => {
    render(<ActivityPanel />);

    expect(screen.getByTestId('activity-panel')).toBeInTheDocument();
    expect(screen.getByTestId('activity-panel-empty')).toBeInTheDocument();
  });

  it('lists active loads with progress and queued items separately', () => {
    seedQueue({
      active: [
        makeItem({
          id: 'load-1',
          status: 'loading',
          progress: 42,
          displayName: 'BOLD run-01',
          startTime: Date.now() - 250,
        }),
      ],
      queue: [
        makeItem({
          id: 'load-2',
          status: 'queued',
          displayName: 'BOLD run-02',
        }),
      ],
    });

    render(<ActivityPanel />);

    const active = screen.getByTestId('activity-active-section');
    expect(active.textContent).toContain('BOLD run-01');
    expect(active.textContent).toContain('42%');
    expect(screen.getByTestId('activity-active-item-load-1-progress')).toBeInTheDocument();

    const queued = screen.getByTestId('activity-queued-section');
    expect(queued.textContent).toContain('BOLD run-02');
  });

  it('shows recent completions and errors with newest first', () => {
    seedQueue({
      completed: [
        makeItem({
          id: 'load-1',
          status: 'complete',
          displayName: 'older.nii.gz',
          startTime: 100,
          endTime: 1100,
        }),
        makeItem({
          id: 'load-2',
          status: 'error',
          displayName: 'broken.nii.gz',
          startTime: 200,
          endTime: 1200,
          error: new Error('boom'),
        }),
      ],
    });

    render(<ActivityPanel />);

    const recent = screen.getByTestId('activity-recent-section');
    // Newest first — load-2 (error) should appear before load-1 in the DOM.
    const items = recent.querySelectorAll('[data-testid^="activity-recent-item-"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('data-status')).toBe('error');
    expect(items[1].getAttribute('data-status')).toBe('complete');
    expect(recent.textContent).toContain('boom');
  });

  it('clears completed items when the user clicks Clear', () => {
    seedQueue({
      completed: [
        makeItem({
          id: 'load-1',
          status: 'complete',
          displayName: 'done.nii.gz',
          endTime: Date.now(),
        }),
      ],
    });

    render(<ActivityPanel />);

    expect(screen.getByTestId('activity-recent-section').textContent).toContain('done.nii.gz');

    const clear = screen.getByTestId('activity-panel-clear');
    expect(clear).not.toBeDisabled();

    act(() => {
      fireEvent.click(clear);
    });

    // Now the panel should fall back to the empty state.
    expect(screen.queryByTestId('activity-recent-section')).toBeNull();
    expect(screen.getByTestId('activity-panel-empty')).toBeInTheDocument();
  });

  it('disables Clear when there is nothing to clear', () => {
    seedQueue({
      active: [
        makeItem({ id: 'load-1', status: 'loading', progress: 10 }),
      ],
    });

    render(<ActivityPanel />);

    expect(screen.getByTestId('activity-panel-clear')).toBeDisabled();
  });
});
