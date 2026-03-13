import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressDrawer } from '../ProgressDrawer';
import { useProgressStore, type ProgressTask } from '@/stores/progressStore';

const { cancelTaskMock } = vi.hoisted(() => ({
  cancelTaskMock: vi.fn(),
}));

vi.mock('@/services/ProgressService', () => ({
  getProgressService: () => ({
    cancelTask: cancelTaskMock,
    startTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
  }),
}));

function buildTask(overrides: Partial<ProgressTask>): ProgressTask {
  return {
    id: overrides.id ?? 'task-1',
    type: overrides.type ?? 'generic',
    title: overrides.title ?? 'Task',
    message: overrides.message,
    progress: overrides.progress ?? -1,
    status: overrides.status ?? 'active',
    startTime: overrides.startTime ?? 1000,
    endTime: overrides.endTime,
    error: overrides.error,
    cancellable: overrides.cancellable,
    metadata: overrides.metadata,
  };
}

describe('ProgressDrawer', () => {
  beforeEach(() => {
    cancelTaskMock.mockReset();
    act(() => {
      useProgressStore.setState({ tasks: new Map() });
    });
  });

  afterEach(() => {
    act(() => {
      useProgressStore.setState({ tasks: new Map() });
    });
  });

  it('renders tasks sorted by most recent start time', () => {
    const olderTask = buildTask({
      id: 'older',
      title: 'Older Task',
      startTime: 1000,
      progress: 25,
      status: 'active',
    });
    const newerTask = buildTask({
      id: 'newer',
      title: 'Newer Task',
      startTime: 2000,
      progress: 75,
      status: 'active',
    });

    act(() => {
      useProgressStore.setState({
        tasks: new Map([
          [olderTask.id, olderTask],
          [newerTask.id, newerTask],
        ]),
      });
    });

    render(<ProgressDrawer onClose={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Newer Task')).toBeInTheDocument();
    expect(within(items[1]).getByText('Older Task')).toBeInTheDocument();
  });

  it('closes on Escape and backdrop click', async () => {
    const onClose = vi.fn();
    render(<ProgressDrawer onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('progress-drawer-backdrop'));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('dispatches cancellation for active cancellable tasks', async () => {
    const task = buildTask({
      id: 'cancel-me',
      title: 'Cancelable Task',
      status: 'active',
      progress: 30,
      cancellable: true,
    });

    act(() => {
      useProgressStore.setState({
        tasks: new Map([[task.id, task]]),
      });
    });

    render(<ProgressDrawer onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    });

    expect(cancelTaskMock).toHaveBeenCalledWith('cancel-me');
  });

  it('clears completed and cancelled tasks from the store', async () => {
    const completedTask = buildTask({
      id: 'done',
      title: 'Completed Task',
      status: 'completed',
      progress: 100,
      endTime: 3000,
    });
    const cancelledTask = buildTask({
      id: 'stopped',
      title: 'Cancelled Task',
      status: 'cancelled',
      progress: 40,
      endTime: 4000,
    });
    const activeTask = buildTask({
      id: 'active',
      title: 'Active Task',
      status: 'active',
      progress: 10,
    });

    act(() => {
      useProgressStore.setState({
        tasks: new Map([
          [completedTask.id, completedTask],
          [cancelledTask.id, cancelledTask],
          [activeTask.id, activeTask],
        ]),
      });
    });

    render(<ProgressDrawer onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear Completed Tasks' }));
    });

    expect(Array.from(useProgressStore.getState().tasks.keys())).toEqual(['active']);
    expect(screen.queryByText('Completed Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled Task')).not.toBeInTheDocument();
    expect(screen.getByText('Active Task')).toBeInTheDocument();
  });
});
