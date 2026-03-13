import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceLoadingService } from '@/services/SurfaceLoadingService';

const mockInvoke = vi.fn();

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: mockInvoke,
  }),
  TauriTransport: class {
    getNamespacedCommand(command: string) {
      return `plugin:api-bridge|${command}`;
    }
  },
}));

describe('SurfaceLoadingService', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('opens the canonical file dialog for surface selection', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const service = new SurfaceLoadingService();

    await service.requestSurfaceFileSelection();

    expect(mockInvoke).toHaveBeenCalledWith('open_file_dialog');
  });

  it('accepts both .gii and .gifti surface files during validation', async () => {
    const service = new SurfaceLoadingService();

    await expect(service.validateSurfaceFile('/tmp/lh.pial.gii')).resolves.toBe(true);
    await expect(service.validateSurfaceFile('/tmp/lh.pial.gifti')).resolves.toBe(true);
    await expect(service.validateSurfaceFile('/tmp/lh.pial.obj')).resolves.toBe(false);
  });

  it('keeps the namespaced surface commands stable', async () => {
    const { TauriTransport } = await import('@/services/transport');
    const transport = new TauriTransport();

    expect((transport as any).getNamespacedCommand('load_surface')).toBe('plugin:api-bridge|load_surface');
    expect((transport as any).getNamespacedCommand('get_surface_geometry')).toBe(
      'plugin:api-bridge|get_surface_geometry'
    );
  });
});
