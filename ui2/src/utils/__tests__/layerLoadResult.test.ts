import { describe, expect, it } from 'vitest';
import { findNewLayerId } from '@/utils/layerLoadResult';

describe('findNewLayerId', () => {
  it('returns the newest layer id not present before load', () => {
    const result = findNewLayerId(
      ['layer-1', 'layer-2'],
      [{ id: 'layer-1' }, { id: 'layer-2' }, { id: 'layer-3' }]
    );

    expect(result).toBe('layer-3');
  });

  it('returns null when no new layer was added', () => {
    const result = findNewLayerId(
      ['layer-1', 'layer-2'],
      [{ id: 'layer-1' }, { id: 'layer-2' }]
    );

    expect(result).toBeNull();
  });
});
