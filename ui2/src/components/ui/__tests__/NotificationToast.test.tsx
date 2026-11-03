import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationToast } from '../NotificationToast';
import { getEventBus } from '@/events/EventBus';

describe('NotificationToast (status-bar messages)', () => {
  // N31: "Cannot…ts full" cut the cause and the way out. With a subject, a
  // line too long for the bar shortens the file name, never the message.
  it('shortens only the subject of a message that names one', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ font: '', measureText: (text: string) => ({ width: Array.from(text).length * 5 }) } as never);
    try {
      const subject = 'sub-01_ses-01_task-rest_run-02_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz';
      const cause = 'Only 16 layers can be drawn in one view. Hide a layer in this view, then show this one.';
      render(<NotificationToast />);
      act(() => {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Cannot show ${subject}: ${cause}`,
          subject,
        });
      });
      const text = screen.getByTestId('status-notification-text').textContent ?? '';
      expect(text.startsWith('Cannot show sub-01')).toBe(true);
      expect(text).toContain('_bold.nii.gz: ');
      expect(text.endsWith(`: ${cause}`)).toBe(true);
      expect(text).toContain('…');
      expect(text).not.toContain(subject);
      expect(Array.from(text).length * 5).toBeLessThanOrEqual(600);
    } finally {
      width.mockRestore();
      context.mockRestore();
    }
  });

  it('merges load messages into one line and shows errors as alerts', () => {
    render(<NotificationToast />);
    act(() => {
      getEventBus().emit('ui.notification', { type: 'info', message: 'Loaded: MNI152_T1_2mm_brain.nii.gz' });
      getEventBus().emit('ui.notification', { type: 'info', message: 'Surface loaded: lh.inflated.gii' });
      getEventBus().emit('ui.notification', { type: 'info', message: 'Loaded overlay: lh.sensorimotor.func.gii' });
    });
    expect(screen.getByTestId('status-notification')).toHaveTextContent(
      'Loaded: MNI152_T1_2mm_brain.nii.gz, lh.inflated.gii, lh.sensorimotor.func.gii',
    );
    // One line, not a stack.
    expect(screen.getAllByTestId('status-notification')).toHaveLength(1);
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: 'Permission denied' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
  });

  it('shows an action ("Removed T1w.nii.gz — Undo") that runs once and clears the message', () => {
    render(<NotificationToast />);
    const run = vi.fn();
    act(() => {
      getEventBus().emit('ui.notification', {
        type: 'info',
        message: 'Removed T1w.nii.gz',
        action: { label: 'Undo', run },
      });
    });
    expect(screen.getByTestId('status-notification')).toHaveTextContent('Removed T1w.nii.gz');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('status-notification')).toBeNull();
  });

  it('opens the full error from the status line (a keyboard button), not only a hover title', () => {
    render(<NotificationToast />);
    const reason = 'Failed to load /Volumes/lab/study/derivatives/sub-01/func/zstat1.nii.gz: Permission denied';
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: reason });
    });
    const open = screen.getByTestId('status-notification-open');
    expect(open.tagName).toBe('BUTTON');
    expect(open).toHaveAccessibleName(`Error: ${reason}. Show in full`);
    fireEvent.click(open);
    expect(screen.getByTestId('status-notification-list')).toHaveTextContent(reason);
  });

  // QA 2026-10-31 N18 note: the slots-full toast read "Failed t…, then load
  // again." in the bar. The bar says "GPU slots full"; the list has it all.
  it('shortens the slots-full cause in the bar and keeps it whole in the list', () => {
    render(<NotificationToast />);
    const full =
      'Failed to load oblique.nii.gz: GPU texture slots full (all 8 in use). Hide or remove a layer, then load again.';
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: full });
    });
    expect(screen.getByTestId('status-notification-text')).toHaveTextContent(
      'Failed to load oblique.nii.gz: GPU slots full',
    );
    const open = screen.getByTestId('status-notification-open');
    expect(open).toHaveAttribute('title', full);
    fireEvent.click(open);
    expect(screen.getByTestId('status-notification-list')).toHaveTextContent(full);
  });

  it('dismissing the last message does not drop focus to <body>', async () => {
    render(
      <>
        <NotificationToast />
        <button data-testid="status-diagnostics-trigger">Diagnostics</button>
      </>,
    );
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: 'Boom' });
    });
    const dismiss = screen.getByRole('button', { name: 'Dismiss message' });
    dismiss.focus();
    fireEvent.click(dismiss);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    });
    expect(document.activeElement).toBe(screen.getByTestId('status-diagnostics-trigger'));
  });

  it('an open message list does not expire out from under the user; it expires on close', () => {
    vi.useFakeTimers();
    try {
      render(<NotificationToast />);
      act(() => {
        getEventBus().emit('ui.notification', { type: 'info', message: 'Saved image to /tmp/figure.png' });
      });
      fireEvent.click(screen.getByTestId('status-notification-open'));
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      // Still there while the list is open.
      expect(screen.getByTestId('status-notification-list')).toHaveTextContent('Saved image to /tmp/figure.png');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      act(() => {
        vi.advanceTimersByTime(10);
      });
      expect(screen.queryByTestId('status-notification')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves older load errors only in the recovered workspace, including late failures', () => {
    render(<NotificationToast />);
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: 'Other error' });
      getEventBus().emit('ui.notification', { type: 'error', message: 'Old load', scope: 'volume-load:w', sequence: 1 });
      getEventBus().emit('ui.notification', { type: 'error', message: 'New load', scope: 'volume-load:w', sequence: 3 });
      getEventBus().emit('ui.notification', { type: 'error', message: 'Other workspace', scope: 'volume-load:other', sequence: 1 });
      getEventBus().emit('ui.notification.resolve', { scope: 'volume-load:w', through: 2 });
      getEventBus().emit('ui.notification', { type: 'error', message: 'Late old failure', scope: 'volume-load:w', sequence: 2 });
    });
    fireEvent.click(screen.getByTestId('status-notification-open'));
    const list = screen.getByTestId('status-notification-list');
    expect(list).toHaveTextContent('Other error');
    expect(list).toHaveTextContent('Other workspace');
    expect(list).toHaveTextContent('New load');
    expect(list).not.toHaveTextContent('Old load');
    expect(list).not.toHaveTextContent('Late old failure');
    act(() => getEventBus().emit('ui.notification.resolve', { scope: 'volume-load:w', through: 3 }));
    expect(list).not.toHaveTextContent('New load');
    expect(list).toHaveTextContent('Other workspace');
  });

  it('restores focus when recovery removes the open message list', async () => {
    render(<><NotificationToast /><button data-testid="status-diagnostics-trigger">Diagnostics</button></>);
    act(() => getEventBus().emit('ui.notification', {
      type: 'error', message: 'Load failed', scope: 'volume-load:w', sequence: 1,
    }));
    fireEvent.click(screen.getByTestId('status-notification-open'));
    expect(screen.getByTestId('status-notification-list')).toBeInTheDocument();
    act(() => getEventBus().emit('ui.notification.resolve', { scope: 'volume-load:w', through: 2 }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
    });
    expect(screen.queryByTestId('status-notification-list')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('status-diagnostics-trigger'));
  });

  it('announces an error once (its alert), not also in the polite region', () => {
    render(<NotificationToast />);
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: 'Disk full' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    expect(screen.getByRole('status')).not.toHaveTextContent('Disk full');
  });
});
