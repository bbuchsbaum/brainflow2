import { describe, it, expect } from 'vitest';
import { pickAtlasEvictionCandidate } from '../AtlasPressureMonitor';
import type { LayerInfo } from '@/stores/layerStore';

const makeLayer = (overrides: Partial<LayerInfo>): LayerInfo => ({
  id: overrides.id ?? `layer-${Math.random()}`,
  name: overrides.name ?? overrides.id ?? 'layer',
  volumeId: overrides.volumeId ?? overrides.id ?? 'vol',
  type: overrides.type ?? 'anatomical',
  visible: overrides.visible ?? true,
  order: overrides.order ?? 0,
  loading: overrides.loading,
  error: overrides.error,
});

describe('pickAtlasEvictionCandidate', () => {
  it('prioritises hidden layers', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, visible: true }),
      makeLayer({ id: 'hidden', order: 1, visible: false }),
      makeLayer({ id: 'recent', order: 2, visible: true })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('hidden');
  });

  it('falls back to non-anatomical layers when none hidden', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, type: 'anatomical' }),
      makeLayer({ id: 'functional', order: 1, type: 'functional' }),
      makeLayer({ id: 'mask', order: 2, type: 'mask' })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('functional');
  });

  it('avoids ejecting the first anatomical layer when it is the only option', () => {
    const layers: LayerInfo[] = [
      makeLayer({ id: 'base', order: 0, type: 'anatomical' }),
      makeLayer({ id: 'secondary', order: 1, type: 'anatomical' })
    ];

    const candidate = pickAtlasEvictionCandidate(layers);
    expect(candidate?.id).toBe('secondary');
  });

  it('returns null when there are no layers', () => {
    expect(pickAtlasEvictionCandidate([])).toBeNull();
  });
});
