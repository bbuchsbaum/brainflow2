import { act, render, screen } from '@testing-library/react';
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
});
