import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationToast } from '../NotificationToast';
import { getEventBus } from '@/events/EventBus';

describe('NotificationToast (status-bar messages)', () => {
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
});
