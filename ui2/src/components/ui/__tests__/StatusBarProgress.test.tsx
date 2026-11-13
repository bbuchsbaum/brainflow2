import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProgressStore } from '@/stores/progressStore';
import { StatusBarProgress } from '../StatusBarProgress';

vi.mock('../ProgressDrawer', () => ({ ProgressDrawer: () => null }));

describe('StatusBarProgress', () => {
  beforeEach(() => useProgressStore.setState({ tasks: new Map() }));
  afterEach(cleanup);

  it('shows nothing without an active task', () => {
    const { container } = render(<StatusBarProgress />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the stage of the current task beside its title', () => {
    useProgressStore.getState().addTask({
      id: 'load-1',
      type: 'file-load',
      title: 'Loading sub-01_tstat.nii.gz',
      message: 'Downloading 12.3 / 80.0 MiB',
      progress: 15,
      status: 'active',
    });
    render(<StatusBarProgress />);
    expect(screen.getByText('Loading sub-01_tstat.nii.gz')).toBeInTheDocument();
    const message = screen.getByTestId('status-progress-message');
    expect(message).toHaveTextContent('Downloading 12.3 / 80.0 MiB');
    expect(message.className).toContain('truncate');
  });

  it('shows the title alone when the task has no message', () => {
    useProgressStore.getState().addTask({
      id: 'task-1',
      type: 'generic',
      title: 'Exporting',
      progress: -1,
      status: 'active',
    });
    render(<StatusBarProgress />);
    expect(screen.getByText('Exporting')).toBeInTheDocument();
    expect(screen.queryByTestId('status-progress-message')).toBeNull();
  });
});
