import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const { loadFile, setVolumeTimepoint } = vi.hoisted(() => ({
  loadFile: vi.fn(),
  setVolumeTimepoint: vi.fn(async () => undefined),
}));
vi.mock('@/services/FileLoadingService', () => ({ getFileLoadingService: () => ({ loadFile }) }));
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ reorderLayers: vi.fn(async () => undefined), removeLayer: vi.fn(async () => undefined) }),
}));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({ setVolumeTimepoint }) }));
vi.mock('@/components/layout/openDockTab', () => ({ openDockTab: vi.fn() }));

import { openRunInViewer, resetRunViewer } from '../openRunInViewer';

const viewLayer = (id: string) => ({ id, visible: true, opacity: 1 });
const layer = (id: string, volumeId: string, frame: number) => ({
  id, name: id, volumeId, type: 'functional', visible: true, order: 0,
  volumeType: 'TimeSeries4D', currentTimepoint: frame,
  timeSeriesInfo: { num_timepoints: 200, tr: 2, temporal_unit: 's', acquisition_time: null },
});

describe('BIDS run landing isolation', () => {
  beforeEach(() => {
    resetRunViewer();
    loadFile.mockReset();
    setVolumeTimepoint.mockClear();
    useLayerStore.setState({ layers: [layer('other', 'other-volume', 7)] as never, selectedLayerId: 'other' });
    useWorkspaceStore.setState({
      workspaces: new Map([
        ['other', { id: 'other', type: 'orthogonal-locked' } as never],
        ['bids', { id: 'bids', type: 'bids-explorer' } as never],
      ]),
      activeWorkspaceId: 'other',
      createWorkspace: vi.fn(async () => {
        useWorkspaceStore.setState((state) => ({
          workspaces: new Map([...state.workspaces, ['viewer', { id: 'viewer', type: 'orthogonal-locked' } as never]]),
          activeWorkspaceId: 'viewer',
        }));
        return 'viewer';
      }) as never,
    });
    useViewStateStore.getState().setViewState((state) => {
      state.timepoint = 7;
      state.layers = [viewLayer('other')] as never;
    }, 'other');
    useWorkspaceStore.setState({ activeWorkspaceId: 'bids' });
    useViewStateStore.getState().setViewState((state) => { state.layers = []; }, 'bids');
    loadFile.mockImplementation(async (path: string, _ingress: string, _intent: string, workspaceId: string) => {
      useLayerStore.setState((state) => ({
        layers: [...state.layers, { ...layer('run', 'run-volume', 0), sourcePath: path }] as never,
      }));
      useViewStateStore.getState().setViewState((state) => { state.layers.push(viewLayer('run') as never); }, workspaceId);
    });
  });

  it('moves only the newly opened run to its peak frame', async () => {
    await openRunInViewer({ path: '/dataset/run.nii.gz', fd: { peak_volume: 149 } } as never);
    const layers = useLayerStore.getState().layers;
    expect(layers.find((item) => item.id === 'other')?.currentTimepoint).toBe(7);
    expect(layers.find((item) => item.id === 'run')?.currentTimepoint).toBe(149);
    expect(useViewStateStore.getState().workspaceViewStates.get('other')?.timepoint).toBe(7);
    expect(useViewStateStore.getState().workspaceViewStates.get('viewer')?.timepoint).toBe(149);
    expect(setVolumeTimepoint).toHaveBeenCalledWith('run-volume', 149);
    expect(setVolumeTimepoint).not.toHaveBeenCalledWith('other-volume', expect.anything());
  });
});
