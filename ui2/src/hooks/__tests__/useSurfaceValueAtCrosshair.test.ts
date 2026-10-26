import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useSurfaceValueAtCrosshair } from '../useSurfaceValueAtCrosshair';

const FACES = new Uint32Array([0, 1, 2]);

function mesh(handle: string, type: 'pial' | 'inflated', vertices: number[], withOverlay: boolean): LoadedSurface {
  return {
    handle,
    name: `lh.${type}.gii`,
    visible: true,
    geometry: { vertices: new Float32Array(vertices), faces: FACES, hemisphere: 'left', surfaceType: type },
    layers: withOverlay
      ? new Map([['ov', { id: 'ov', name: 'ov', visible: true, values: new Float32Array([1, 2, 3]) } as never]])
      : new Map(),
    metadata: { vertexCount: 3, faceCount: 1, hemisphere: 'left', surfaceType: type, path: `/s/lh.${type}.gii` },
  } as LoadedSurface;
}

describe('useSurfaceValueAtCrosshair: anatomical space only (v4 function critic)', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    void useViewStateStore.getState().setCrosshair([10, 0, 0]);
  });

  it('an inflated mesh alone gives no reading (its vertices are not in world space)', () => {
    // The inflated vertex 1 sits exactly at the crosshair: still no reading.
    const inflated = mesh('infl', 'inflated', [0, 0, 0, 10, 0, 0, 0, 10, 0], true);
    useSurfaceStore.setState({ surfaces: new Map([['infl', inflated]]) });
    const { result } = renderHook(() => useSurfaceValueAtCrosshair('infl', 'ov'));
    expect(result.current).toEqual({ reading: null, anatomical: false });
  });

  it('reads through the matching pial mesh (same topology)', () => {
    const inflated = mesh('infl', 'inflated', [50, 0, 0, 60, 0, 0, 70, 0, 0], true);
    const pial = mesh('pial', 'pial', [0, 0, 0, 0, 10, 0, 10, 0.5, 0], false);
    useSurfaceStore.setState({ surfaces: new Map([['infl', inflated], ['pial', pial]]) });
    const { result } = renderHook(() => useSurfaceValueAtCrosshair('infl', 'ov'));
    expect(result.current.anatomical).toBe(true);
    // Pial vertex 2 is nearest the crosshair: overlay value 3.
    expect(result.current.reading).toMatchObject({ vertex: 2, value: 3 });
  });
});
