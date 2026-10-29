import { describe, expect, it, vi } from 'vitest';
import { BrowserTransport } from './transport';

describe('fatal worker ownership', () => {
  it('rejects pending requests, terminates once and notifies the owner', async () => {
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
    } as unknown as Worker;
    const transport = new BrowserTransport(worker);
    const failure = vi.fn();
    transport.onFailure = failure;
    const pending = transport.invoke('render_view').catch((error) => error.message);
    worker.onmessage!({ data: { id: 0, fatal: true, error: 'device lost' } } as MessageEvent);
    expect(await pending).toBe('device lost');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledOnce();
    await expect(transport.invoke('initialize')).rejects.toThrow('viewer is closed');
    transport.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
