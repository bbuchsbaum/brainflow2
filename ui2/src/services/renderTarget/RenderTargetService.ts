import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { useRenderStore } from '@/stores/renderStore';

export class RenderTargetService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async initRenderLoop(width: number, height: number): Promise<void> {
    return this.transport.invoke('init_render_loop', { width, height });
  }

  async createOffscreenRenderTarget(width: number, height: number): Promise<void> {
    if (!width || !height || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      const error = new Error(`Invalid render target dimensions: ${width}x${height}. Dimensions must be between 1 and 8192.`);
      console.error('[RenderTargetService]', error.message);
      throw error;
    }

    console.log(`[RenderTargetService] Creating offscreen render target: ${width}x${height}`);

    try {
      await this.transport.invoke('create_offscreen_render_target', { width, height });
      console.log(`[RenderTargetService] Render target created successfully: ${width}x${height}`);
    } catch (error) {
      console.error('[RenderTargetService] Failed to create render target:', error);
      throw error;
    }
  }

  async resizeCanvas(width: number, height: number): Promise<void> {
    return this.transport.invoke('resize_canvas', { width, height });
  }

  async updateFrameForSynchronizedView(
    viewWidthMm: number,
    viewHeightMm: number,
    crosshairWorld: [number, number, number],
    planeId: number
  ): Promise<void> {
    return this.transport.invoke('update_frame_for_synchronized_view', {
      viewWidthMm,
      viewHeightMm,
      crosshairWorld,
      planeId
    });
  }

  /**
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  isRenderTargetReady(): boolean {
    return useRenderStore.getState().isRenderTargetReady();
  }

  /**
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  getRenderTargetState() {
    return useRenderStore.getState().getRenderTargetState();
  }
}

let instance: RenderTargetService | null = null;

export function getRenderTargetService(): RenderTargetService {
  if (!instance) {
    instance = new RenderTargetService();
  }
  return instance;
}
