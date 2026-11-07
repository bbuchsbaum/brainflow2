/**
 * R5c: when the residency report's owner is `backend`, the UI stops deciding
 * admission and eviction (docs/plans/gpu-residency-r5-plan-2026-11.md §11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResidencyLayerReport, ResidencyReport } from '@brainflow/api';
import { MockTransport, getTransport } from '@/services/transport';
import { useLayerStore } from '@/stores/layerStore';
import {
  backendOwnsResidency,
  resetResidencyAlertsForTests,
  useResidencyStore,
} from '@/stores/residencyStore';
import { getEventBus } from '@/events/EventBus';
import { layerEvictionService } from '@/services/LayerEvictionService';
import { ensureFrontWorkspaceResident } from '@/services/frontWorkspaceResidency';
import { LayerGpuService } from '@/services/layer/LayerGpuService';

const mock = () => getTransport() as MockTransport;
const calls = (command: string) =>
  mock()
    .getCallLog()
    .filter((call) => call.cmd === command);

let seq = 0;
const report = (
  owner: 'ui' | 'backend',
  layers: Partial<ResidencyLayerReport>[] = [],
): ResidencyReport => ({
  seq: ++seq,
  owner,
  budget_bytes: 1024,
  used_bytes: 0,
  binding_capacity: 13,
  undemanded_bytes: 0,
  layers: layers.map((layer) => ({
    layer_id: 'a',
    state: 'resident',
    bytes: 128,
    frames: ['tab'],
    refusal: null,
    ...layer,
  })),
});

function withLayers(ids: string[], resident: boolean): void {
  useLayerStore.setState({
    layers: ids.map((id) => ({ id, name: `Layer ${id}`, volumeId: `vol-${id}`, visible: true })),
    layerMetadata: new Map(ids.map((id) => [id, { gpuResident: resident }])),
  } as never);
}

const metadata = (id: string) =>
  useLayerStore.getState().layerMetadata.get(id) as { gpuResident?: boolean; evicted?: boolean };

describe('backend residency owner', () => {
  beforeEach(() => {
    seq = 0;
    useResidencyStore.setState({ report: null });
    resetResidencyAlertsForTests();
    mock().clearCallLog();
  });

  it('syncs gpuResident from backend reports, never from a UI-owned one', () => {
    withLayers(['a', 'b'], true);
    useResidencyStore.getState().apply(report('ui', [{ layer_id: 'a', state: 'evicted' }]));
    expect(backendOwnsResidency()).toBe(false);
    expect(metadata('a').gpuResident).toBe(true);

    useResidencyStore.getState().apply(
      report('backend', [
        { layer_id: 'a', state: 'evicted' },
        { layer_id: 'b', state: 'resident' },
      ]),
    );
    expect(backendOwnsResidency()).toBe(true);
    expect(metadata('a')).toMatchObject({ gpuResident: false, evicted: true });
    expect(metadata('b').gpuResident).toBe(true);
  });

  it('draw_cap_refusal_alerts_once_per_epoch', () => {
    withLayers(['a'], false);
    const alerts: string[] = [];
    const off = getEventBus().on('ui.notification', (event) => {
      if (event.alert) alerts.push(event.message);
    });
    const refused = () =>
      report('backend', [{ layer_id: 'a', state: 'refused', refusal: 'draw_cap' }]);
    const store = useResidencyStore.getState();
    store.apply(refused());
    store.apply(refused());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('at most 13 layers');

    // Drawn again, then refused again: a new alert.
    store.apply(report('backend', [{ layer_id: 'a', state: 'resident' }]));
    store.apply(refused());
    expect(alerts).toHaveLength(2);
    off();
  });

  it('backend_owner_disables_ui_eviction_and_front_restore', async () => {
    withLayers(['a', 'b'], true);
    useResidencyStore.getState().apply(report('backend'));

    await expect(layerEvictionService.makeRoomForUpload('b', { reserve: true })).resolves.toBe(
      true,
    );
    await layerEvictionService.checkAndEvict();
    await ensureFrontWorkspaceResident(() => true);

    // No eviction, no stats round trip, no restore upload.
    expect(calls('release_layer_gpu_resources')).toHaveLength(0);
    expect(calls('get_atlas_stats')).toHaveLength(0);
    expect(calls('request_layer_gpu_resources')).toHaveLength(0);
  });

  it('a budget refusal under a backend owner is final: the UI does not retry', async () => {
    useResidencyStore.getState().apply(report('backend'));
    const refusal = {
      GpuBudgetExceeded: { code: 6008, requested_bytes: 128, used_bytes: 256, budget_bytes: 256 },
    };
    const request = vi.fn(() => {
      throw refusal;
    });
    mock().setMockResponse('request_layer_gpu_resources', request);
    const service = new LayerGpuService(getTransport());
    await expect(service.requestLayerGpuResources('a', 'vol-a')).rejects.toBe(refusal);
    expect(request).toHaveBeenCalledTimes(1);
    expect(calls('release_layer_gpu_resources')).toHaveLength(0);
  });
});
