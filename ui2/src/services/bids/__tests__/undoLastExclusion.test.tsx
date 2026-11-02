import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidsUndoStrip } from '@/components/bids/BidsUndoStrip';
import { getEventBus } from '@/events/EventBus';
import { undoBidsExclusion } from '@/hooks/useBidsShortcuts';
import { useBidsStore } from '@/stores/bidsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const entry = { id: 1, added: [{ entity: 'sub-01' }] } as never;

describe('a failed undo', () => {
  const undoExclusion = vi.fn();
  const notified = vi.fn();
  let stop: () => void;

  beforeEach(() => {
    undoExclusion.mockReset().mockRejectedValue(new Error('disk full'));
    notified.mockClear();
    stop = getEventBus().on('ui.notification', notified);
    useBidsStore.setState({ undoExclusion, undoStack: [entry] });
  });

  afterEach(() => {
    stop();
    useBidsStore.getState().reset();
  });

  const told = () =>
    vi.waitFor(() =>
      expect(notified).toHaveBeenCalledWith({
        type: 'error',
        message: 'Exclusion not undone: disk full',
      }),
    );

  it('is told from the strip', async () => {
    render(<BidsUndoStrip />);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    await told();
  });

  it('is told from Edit › Undo', async () => {
    useWorkspaceStore.setState({ getActiveWorkspace: () => ({ type: 'bids-explorer' }) as never });
    expect(undoBidsExclusion()).toBe(true);
    await told();
  });
});
