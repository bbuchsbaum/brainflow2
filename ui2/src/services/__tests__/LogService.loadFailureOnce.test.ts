/**
 * QA 2026-10-31 N2: one failed open read as three Log lines (layer.error,
 * volume.load.error and the open's error notification). The open reports
 * its failure once, by the file's name.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { useLogStore } from '@/stores/logStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useLayerStore } from '@/stores/layerStore';
import { bootstrapLogService, resetLogServiceForTest } from '@/services/LogService';
import { loadFailureMessage } from '@/utils/formatTauriError';

const raw = new Error(
  'Failed to add layer to render state: Internal { code: 1885, details: "Failed to add layer: Maximum layer count 8 reached" }',
);

describe('a failed open is logged once', () => {
  beforeEach(() => {
    useLogStore.getState().clear();
    useLayerStore.setState({ layers: [] });
    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map() });
    bootstrapLogService();
  });
  afterEach(() => {
    resetLogServiceForTest();
    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map() });
  });

  it('logs the open’s message only, with the clear slots-full text', () => {
    useLoadingQueueStore.setState({
      activeLoads: new Map([
        [
          'q1',
          { id: 'q1', path: '/d/oblique4d.nii', displayName: 'oblique4d.nii', status: 'loading' } as never,
        ],
      ]),
    });
    const bus = getEventBus();
    bus.emit('layer.error', { layerId: 'oblique4d.nii', error: raw, sourcePath: '/d/oblique4d.nii' });
    bus.emit('volume.load.error', { volumeId: 'v1', source: 'file', sourcePath: '/d/oblique4d.nii', error: raw });
    bus.emit('ui.notification', {
      type: 'error',
      message: loadFailureMessage('oblique4d.nii', raw),
      logSource: 'volume',
    });

    const messages = useLogStore.getState().entries.map((e) => e.message);
    expect(messages).toEqual([
      'Failed to load oblique4d.nii: GPU texture slots full (all 8 in use). Hide or remove a layer, then load again.',
    ]);
  });

  it('still logs those events outside a queued open', () => {
    const bus = getEventBus();
    bus.emit('volume.load.error', { volumeId: 'v1', source: 'file', error: new Error('disk') });
    bus.emit('layer.error', { layerId: 'x', error: new Error('boom') });
    expect(useLogStore.getState().entries).toHaveLength(2);
  });

  // Review M5: only the running open's own events are dropped. An atlas that
  // fails while a T1 is loading is still logged.
  it('logs failures from other sources during an open', () => {
    useLoadingQueueStore.setState({
      activeLoads: new Map([
        [
          'q1',
          { id: 'q1', path: 'template:MNI152NLin2009cAsym_T1w_1mm', displayName: 'T1', status: 'loading' } as never,
        ],
      ]),
    });
    const bus = getEventBus();
    bus.emit('volume.load.error', {
      volumeId: 'atlas-1',
      source: 'atlas',
      sourcePath: 'atlas:aseg',
      error: new Error('atlas failed'),
    });
    bus.emit('layer.error', { layerId: 'aseg', error: new Error('atlas layer failed'), sourcePath: 'atlas:aseg' });
    // An event that names no source is never assumed to be the open's.
    bus.emit('volume.load.error', { volumeId: 'v9', source: 'file', error: new Error('other') });
    expect(useLogStore.getState().entries).toHaveLength(3);
  });
});
