import { describe, expect, it, vi } from 'vitest';
import { invokeBackend, MockTransport, setTransport } from '../transport';
import { TemporalHeatmapService } from '../TemporalHeatmapService';
import { BrowserTransport } from '../browser/transport';
import { adaptWgpu20Descriptor } from '../browser/webgpuCompatibility';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('browser host ownership and service boundaries', () => {
  it('routes domain helpers through the selected host and retains injected service ownership', async () => {
    const a = new MockTransport();
    const b = new MockTransport();
    const result = { width: 1, height: 1, data: [3] };
    a.setMockResponse('plugin:api-bridge|compute_temporal_metric', result);
    const service = new TemporalHeatmapService(a);
    setTransport(b);
    expect(await service.getMetricMap('v', 'mean', 'axial', 0)).toEqual(result);
    expect(b.getCallLog()).toEqual([]);
    b.setMockResponse('plugin:api-bridge|get_template_catalog', ['native']);
    expect(await invokeBackend('plugin:api-bridge|get_template_catalog')).toEqual(['native']);
  });

  it('rejects unavailable native features without invoking another backend', async () => {
    const worker = new FakeWorker();
    const transport = new BrowserTransport(worker as unknown as Worker);
    setTransport(transport);
    await expect(invokeBackend('plugin:api-bridge|get_template_catalog')).rejects.toMatchObject({
      code: 'UNSUPPORTED_BROWSER_CAPABILITY',
    });
    await expect(
      new TemporalHeatmapService(transport).getMetricMap('v', 'mean', 'axial', 0),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_BROWSER_CAPABILITY' });
    expect(worker.postMessage).not.toHaveBeenCalled();
    transport.dispose();
    setTransport(new MockTransport());
  });

  it('cancels callers, requests cleanup of late replies, and terminates only its worker', async () => {
    const worker = new FakeWorker();
    const transport = new BrowserTransport(worker as unknown as Worker);
    const abort = new AbortController();
    const request = transport.request('load_file', {}, abort.signal);
    abort.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    worker.onmessage!({ data: { id: 1, value: { id: 'provisional' } } } as MessageEvent);
    expect(worker.postMessage).toHaveBeenCalledWith({ cancel: 1 });
    const pending = transport.invoke('initialize');
    transport.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(transport.invoke('initialize')).rejects.toThrow('closed');
  });

  it('translates only the removed limit and preserves current device validation', () => {
    const old = {
      requiredLimits: { maxInterStageShaderComponents: 60, maxSampledTexturesPerShaderStage: 27 },
      requiredFeatures: ['float32-filterable'],
    };
    const adapted = adaptWgpu20Descriptor(old, { maxInterStageShaderVariables: 16 });
    expect(adapted.requiredLimits).toEqual({
      maxInterStageShaderVariables: 2,
      maxSampledTexturesPerShaderStage: 27,
    });
    expect(adapted.requiredFeatures).toEqual(old.requiredFeatures);
    expect(old.requiredLimits.maxInterStageShaderComponents).toBe(60);
    expect(adaptWgpu20Descriptor(old, { maxInterStageShaderComponents: 60 })).toBe(old);
  });
});
