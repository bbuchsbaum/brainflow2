import { beforeEach, describe, expect, it } from 'vitest';
import { RenderTargetService } from '../RenderTargetService';
import { MockTransport } from '../../transport';
import { useRenderStore } from '@/stores/renderStore';

describe('RenderTargetService', () => {
  let renderTargetService: RenderTargetService;
  let mockTransport: MockTransport;

  beforeEach(() => {
    mockTransport = new MockTransport();
    mockTransport.clearCallLog();
    renderTargetService = new RenderTargetService(mockTransport);

    useRenderStore.setState({
      renderTarget: {
        width: 0,
        height: 0,
        isRecreating: false,
        lastError: null
      },
      isRendering: false,
      renderError: null,
      queuedJobs: 0,
      lastRenderTimestamp: 0,
      lastRenderDimensions: null
    });
  });

  it('initializes the render loop through the backend transport', async () => {
    await renderTargetService.initRenderLoop(512, 512);

    const calls = mockTransport.getCallLog();
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('init_render_loop');
    expect(calls[0].args).toEqual({ width: 512, height: 512 });
  });

  it('creates an offscreen render target through the backend transport', async () => {
    await renderTargetService.createOffscreenRenderTarget(640, 480);

    const calls = mockTransport.getCallLog();
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('create_offscreen_render_target');
    expect(calls[0].args).toEqual({ width: 640, height: 480 });
  });

  it('rejects invalid offscreen render target dimensions before invoking the backend', async () => {
    await expect(renderTargetService.createOffscreenRenderTarget(0, 480)).rejects.toThrow(
      'Invalid render target dimensions: 0x480. Dimensions must be between 1 and 8192.'
    );

    expect(mockTransport.getCallLog()).toHaveLength(0);
  });

  it('resizes the canvas through the backend transport', async () => {
    await renderTargetService.resizeCanvas(1024, 768);

    const calls = mockTransport.getCallLog();
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('resize_canvas');
    expect(calls[0].args).toEqual({ width: 1024, height: 768 });
  });

  it('updates the synchronized frame through the backend transport', async () => {
    await renderTargetService.updateFrameForSynchronizedView(180, 120, [10, 20, 30], 2);

    const calls = mockTransport.getCallLog();
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('update_frame_for_synchronized_view');
    expect(calls[0].args).toEqual({
      viewWidthMm: 180,
      viewHeightMm: 120,
      crosshairWorld: [10, 20, 30],
      planeId: 2
    });
  });

  it('reports render target readiness from the render store', () => {
    useRenderStore.setState({
      renderTarget: {
        width: 512,
        height: 512,
        isRecreating: false,
        lastError: null
      }
    });

    expect(renderTargetService.isRenderTargetReady()).toBe(true);
    expect(renderTargetService.getRenderTargetState()).toEqual({
      width: 512,
      height: 512,
      isRecreating: false,
      lastError: null
    });
  });
});
