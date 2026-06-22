import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureInvoker, sampleLayerValueAtWorld, setLayerBorder } from '@brainflow/api';

describe('@brainflow/api backend helpers', () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'sample_layer_value_at_world') {
        return 42.5;
      }
      return undefined;
    });
    configureInvoker(invokeMock);
  });

  it('sends layer border updates through a transport-neutral command name', async () => {
    await setLayerBorder('layer-1', true, 2);

    expect(invokeMock).toHaveBeenCalledWith('set_layer_border', {
      layerId: 'layer-1',
      enabled: true,
      thicknessPx: 2,
    });
  });

  it('samples layer values through a transport-neutral command name', async () => {
    await expect(sampleLayerValueAtWorld('layer-2', [1, 2, 3])).resolves.toBe(42.5);

    expect(invokeMock).toHaveBeenCalledWith('sample_layer_value_at_world', {
      layerId: 'layer-2',
      worldCoords: [1, 2, 3],
    });
  });
});
