import { describe, expect, it } from 'vitest';
import type { LoadedSurface } from '@/stores/surfaceStore';
import { matchingOverlayTarget, validateSurfaceOverlayIdentity } from '../surfaceOverlayIdentity';

function mesh(handle: string, path: string, hemisphere: 'left' | 'right'): LoadedSurface {
  return {
    handle,
    name: path.split('/').pop()!,
    visible: true,
    geometry: { vertices: new Float32Array(9), faces: new Uint32Array([0, 1, 2]), hemisphere, surfaceType: 'inflated' as never },
    layers: new Map(),
    metadata: { vertexCount: 3, faceCount: 1, hemisphere, surfaceType: 'inflated', path },
  } as LoadedSurface;
}

describe('overlay target by hemisphere', () => {
  const lh = mesh('lh', '/s/fig/lh.inflated.gii', 'left');
  const rh = mesh('rh', '/s/fig/rh.inflated.gii', 'right');
  const otherRh = mesh('rh2', '/s/other/rh.inflated.gii', 'right');

  it('keeps the selected surface when the overlay agrees with it (or names no hemisphere)', () => {
    expect(matchingOverlayTarget('/s/fig/lh.sensorimotor.func.gii', lh, [lh, rh]).handle).toBe('lh');
    expect(matchingOverlayTarget('/s/fig/sensorimotor.func.gii', lh, [lh, rh]).handle).toBe('lh');
  });

  it("sends an rh overlay to the rh surface, the selected one's folder first", () => {
    expect(matchingOverlayTarget('/s/fig/rh.sensorimotor.func.gii', lh, [lh, otherRh, rh]).handle).toBe('rh');
    expect(() => validateSurfaceOverlayIdentity('/s/fig/rh.sensorimotor.func.gii', lh)).toThrow(/hemisphere/);
  });

  it('no matching surface: the selected one (and its identity error stands)', () => {
    expect(matchingOverlayTarget('/s/fig/rh.sensorimotor.func.gii', lh, [lh]).handle).toBe('lh');
  });
});
