import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { EmptyStackOverlay } from '../EmptyStackOverlay';

const WORKSPACE = 'run-tab';
const front = () => useViewStateStore.setState({ activeWorkspaceKey: WORKSPACE });
const setLayers = (layers: object[]) =>
  useViewStateStore.setState((state) => ({ viewState: { ...state.viewState, layers: layers as never } }));
const enqueue = (workspaceId: string, start = true) => {
  const queue = useLoadingQueueStore.getState();
  const id = queue.enqueue({
    type: 'volume-load',
    path: `/d/${workspaceId}.nii.gz`,
    displayName: 'sub-01_task-a_bold.nii.gz',
    workspaceId,
  });
  if (start) queue.startLoading(id);
};

describe('EmptyStackOverlay', () => {
  beforeEach(() => {
    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map(), completed: [] });
    useLayerStore.setState({ loadingLayers: new Set() });
    front();
    setLayers([]);
  });

  it('says what is opening from the first moment, with no buttons to press', () => {
    enqueue(WORKSPACE);
    render(<EmptyStackOverlay />);
    expect(screen.getByText('Opening sub-01_task-a_bold.nii.gz')).toBeInTheDocument();
    expect(screen.queryByText('No volume loaded')).toBeNull();
    expect(screen.queryByTestId('empty-open-file')).toBeNull();
  });

  it('counts a load still waiting for its turn', () => {
    enqueue(WORKSPACE, false);
    render(<EmptyStackOverlay />);
    expect(screen.getByText('Opening sub-01_task-a_bold.nii.gz')).toBeInTheDocument();
  });

  it('shows over a tab holding only hidden layers, which would otherwise be black', () => {
    setLayers([{ id: 'template', volumeId: 'template', visible: false }]);
    enqueue(WORKSPACE);
    render(<EmptyStackOverlay />);
    expect(screen.getByTestId('orthogonal-opening')).toBeInTheDocument();
  });

  it('does not cover a volume on screen, however long the next load takes', () => {
    setLayers([{ id: 'shown', volumeId: 'shown', visible: true }]);
    enqueue(WORKSPACE);
    render(<EmptyStackOverlay />);
    expect(screen.queryByTestId('orthogonal-opening')).toBeNull();
  });

  it('is not about a load in another workspace', () => {
    enqueue('elsewhere');
    render(<EmptyStackOverlay />);
    expect(screen.getByText('No volume loaded')).toBeInTheDocument();
  });
});
