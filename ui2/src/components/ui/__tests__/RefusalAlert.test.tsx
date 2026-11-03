import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RefusalAlert } from '../RefusalAlert';
import { getEventBus } from '@/events/EventBus';

const SENTENCE =
  'Cannot show sub-01_ses-01_task-rest_run-02_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz: ' +
  'GPU texture slots full (all 13 in use). Hide or remove a layer, then load again.';

describe('RefusalAlert (N31)', () => {
  afterEach(() => cleanup());

  it('floats a refusal with its full sentence and dismisses it', () => {
    render(<RefusalAlert />);
    expect(screen.queryByTestId('refusal-alert')).toBeNull();
    act(() => {
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: SENTENCE,
        subject: 'sub-01_ses-01_task-rest_run-02_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz',
        alert: true,
      });
    });
    // The whole sentence, cause and action, not a middle-truncated label.
    expect(screen.getByTestId('refusal-alert-text')).toHaveTextContent(SENTENCE);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(screen.queryByTestId('refusal-alert')).toBeNull();
  });

  it('ignores ordinary notifications and shows the latest refusal only', () => {
    render(<RefusalAlert />);
    act(() => {
      getEventBus().emit('ui.notification', { type: 'info', message: 'Loaded: a.nii.gz' });
    });
    expect(screen.queryByTestId('refusal-alert')).toBeNull();
    act(() => {
      getEventBus().emit('ui.notification', { type: 'error', message: 'First refusal.', alert: true });
      getEventBus().emit('ui.notification', { type: 'error', message: 'Second refusal.', alert: true });
    });
    expect(screen.getAllByTestId('refusal-alert')).toHaveLength(1);
    expect(screen.getByTestId('refusal-alert-text')).toHaveTextContent('Second refusal.');
  });
});
