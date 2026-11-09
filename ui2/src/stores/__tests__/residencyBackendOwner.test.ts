/**
 * R6: the backend owns admission and eviction; the UI follows its residency
 * report (docs/plans/gpu-residency-r6-plan-2026-11.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResidencyLayerReport, ResidencyReport } from '@brainflow/api';
import { MockTransport, getTransport } from '@/services/transport';
import { useLayerStore } from '@/stores/layerStore';
import {
  noteBackendRelease,
  residencyFreed,
  resetResidencyAlertsForTests,
  useResidencyStore,
} from '@/stores/residencyStore';
import { getEventBus } from '@/events/EventBus';
import { LayerGpuService } from '@/services/layer/LayerGpuService';

const mock = () => getTransport() as MockTransport;
const calls = (command: string) =>
  mock()
    .getCallLog()
    .filter((call) => call.cmd === command);

let seq = 0;
const report = (
  layers: Partial<ResidencyLayerReport>[] = [],
  usedBytes = 0,
): ResidencyReport => ({
  seq: ++seq,
  owner: 'backend',
  budget_bytes: 1024,
  used_bytes: usedBytes,
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

  it('syncs gpuResident from the report', () => {
    withLayers(['a', 'b'], true);
    useResidencyStore.getState().apply(
      report([
        { layer_id: 'a', state: 'evicted' },
        { layer_id: 'b', state: 'resident' },
      ]),
    );
    expect(metadata('a')).toMatchObject({ gpuResident: false, evicted: true });
    expect(metadata('b').gpuResident).toBe(true);
  });

  // A layer the backend admits for a frame's demand changes nothing in the
  // view state: the views that left it out must be told to draw again.
  it('announces layer.gpu.ready once when the backend admits a layer', () => {
    withLayers(['a'], false);
    const ready: string[] = [];
    const off = getEventBus().on('layer.gpu.ready', ({ layerId }) => ready.push(layerId));
    const store = useResidencyStore.getState();
    store.apply(report([{ layer_id: 'a', state: 'evicted' }]));
    expect(ready).toEqual([]);
    store.apply(report([{ layer_id: 'a', state: 'resident' }]));
    store.apply(report([{ layer_id: 'a', state: 'resident' }]));
    expect(ready).toEqual(['a']);
    expect(metadata('a')).toMatchObject({ gpuResident: true, evicted: false });
    off();
  });

  it('marks a watchdog release non-resident, once, and ignores unknown layers', () => {
    withLayers(['w'], true);
    noteBackendRelease('w');
    expect(metadata('w')).toMatchObject({ gpuResident: false, evicted: true });
    const before = useLayerStore.getState().layerMetadata;
    noteBackendRelease('w');
    noteBackendRelease('unknown');
    expect(useLayerStore.getState().layerMetadata).toBe(before);
  });

  it('residencyFreed: fewer bytes or fewer resident layers, in a newer report', () => {
    const full = report([{ layer_id: 'a' }, { layer_id: 'b' }], 512);
    const fewerBytes = report([{ layer_id: 'a' }, { layer_id: 'b' }], 256);
    const fewerResident = report([{ layer_id: 'a' }, { layer_id: 'b', state: 'evicted' }], 512);
    const more = report([{ layer_id: 'a' }, { layer_id: 'b' }, { layer_id: 'c' }], 768);
    expect(residencyFreed(full, fewerBytes)).toBe(true);
    expect(residencyFreed(full, fewerResident)).toBe(true);
    expect(residencyFreed(full, more)).toBe(false);
    expect(residencyFreed(fewerBytes, full)).toBe(false); // older
    expect(residencyFreed(null, full)).toBe(false);
  });

  it('draw_cap_refusal_alerts_once_per_tab', () => {
    withLayers(['a', 'b'], false);
    const alerts: string[] = [];
    const off = getEventBus().on('ui.notification', (event) => {
      if (event.alert) alerts.push(event.message);
    });
    const capped = (ids: string[], frame = 'tab') =>
      report(
        ids.map((id) => ({
          layer_id: id,
          state: 'refused' as const,
          refusal: 'draw_cap' as const,
          frames: [frame],
        })),
      );
    const store = useResidencyStore.getState();
    store.apply(capped(['a']));
    store.apply(capped(['a']));
    expect(alerts).toEqual(['Layer a is not drawn: a view draws at most 13 layers.']);

    // Another layer past the same tab's cap, and a switch away and back:
    // the badge shows them, no new alert.
    store.apply(capped(['a', 'b']));
    store.apply(
      report([
        { layer_id: 'a', state: 'evicted', frames: ['tab'] },
        { layer_id: 'b', state: 'evicted', frames: ['tab'] },
      ]),
    );
    store.apply(capped(['a', 'b']));
    expect(alerts).toHaveLength(1);

    // The tab closes; another tab over its cap alerts once, naming both.
    store.apply(report([]));
    store.apply(capped(['a', 'b'], 'other'));
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toBe('Layer a and 1 more are not drawn: a view draws at most 13 layers.');
    off();
  });

  it('a budget refusal is final: the UI does not evict or retry', async () => {
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
