import { describe, expect, it } from 'vitest';
import { sampleLayerValueAtWorld, setLayerBorder } from '@brainflow/api';
import { ApiService } from '../apiService';
import { MockTransport, setTransport } from '../transport';
import { createMockViewState } from '../../test-setup';

describe('ApiService backend ownership', () => {
  it('keeps delegated operations and rendering on each supplied backend', async () => {
    const defaultTransport = new MockTransport();
    setTransport(defaultTransport);
    const first = new MockTransport();
    const second = new MockTransport();
    const firstApi = new ApiService(first);
    const secondApi = new ApiService(second);

    // Interleave identical resource names: the backend owns their identity.
    for (const [api, transport, marker] of [
      [firstApi, first, 1],
      [secondApi, second, 2],
      [firstApi, first, 3],
    ] as const) {
      transport.clearCallLog();
      transport.setMockResponse('load_file', { id: `volume-${marker}` });
      transport.setMockResponse('fs_list_directory', { nodes: [{ id: `file-${marker}` }] });
      transport.setMockResponse('get_volume_timepoint', marker);
      const batch = new ArrayBuffer(marker);
      transport.setMockResponse('batch_render_slices', batch);

      expect(await api.loadFile('brain.nii')).toEqual({ id: `volume-${marker}` });
      expect(await api.listDirectory('data')).toEqual([{ id: `file-${marker}` }]);
      expect(await api.getVolumeTimepoint('volume')).toBe(marker);
      await api.patchLayer('layer', { opacity: 0.5 });
      expect(await api.batchRenderSlices([], 32, 32)).toBe(batch);
      await api.submitViewState(createMockViewState(), 'axial', 32, 32);
      await api.unloadVolume('volume');

      expect(transport.getCallLog().map(({ cmd }) => cmd)).toEqual([
        'load_file', 'fs_list_directory', 'get_volume_timepoint', 'patch_layer',
        'batch_render_slices', 'submit_view', 'unload_volume',
      ]);
      expect(defaultTransport.getCallLog()).toEqual([]);
    }
  });

  it('does not redirect existing instances when the application default changes', async () => {
    const original = new MockTransport();
    original.setMockResponse('get_volume_timepoint', 1);
    setTransport(original);
    const api = new ApiService();
    const replacement = new MockTransport();
    replacement.setMockResponse('get_volume_timepoint', 2);
    setTransport(replacement);

    expect(await api.getVolumeTimepoint('volume')).toBe(1);
    expect(await new ApiService().getVolumeTimepoint('volume')).toBe(2);
  });

  it('binds legacy helpers to the application default, not the last constructed service', async () => {
    const application = new MockTransport();
    application.setMockResponse('sample_layer_value_at_world', 42);
    setTransport(application);
    const isolated = new MockTransport();
    isolated.setMockResponse('sample_layer_value_at_world', 99);
    new ApiService(isolated);

    expect(await sampleLayerValueAtWorld('layer', [1, 2, 3])).toBe(42);
    await setLayerBorder('layer', true, 2);
    expect(application.getCallLog().map(({ cmd }) => cmd)).toEqual([
      'sample_layer_value_at_world', 'set_layer_border',
    ]);
    expect(isolated.getCallLog()).toEqual([]);

    setTransport(isolated);
    expect(await sampleLayerValueAtWorld('layer', [1, 2, 3])).toBe(99);
  });

  it('propagates a backend failure without retrying against the application default', async () => {
    const application = new MockTransport();
    setTransport(application);
    const isolated = new MockTransport();
    isolated.setMockResponse('load_file', () => { throw new Error('source unavailable'); });

    await expect(new ApiService(isolated).loadFile('brain.nii')).rejects.toThrow('source unavailable');
    expect(application.getCallLog()).toEqual([]);
    expect(isolated.getCallLog()).toHaveLength(1);
  });
});
