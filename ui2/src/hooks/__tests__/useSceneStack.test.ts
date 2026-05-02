import { describe, expect, it } from 'vitest';
import { buildSceneStack } from '@/hooks/useSceneStack';
import type { LayerInfo } from '@/stores/layerStore';
import type { LoadedSurface } from '@/stores/surfaceStore';

function makeVolume(overrides: Partial<LayerInfo>): LayerInfo {
  return {
    id: 'l1',
    name: 'L1',
    type: 'volume',
    visible: true,
    ...overrides,
  } as LayerInfo;
}

function makeSurface(handle: string, overrides: Partial<LoadedSurface> = {}): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(),
      faces: new Uint32Array(),
    },
    layers: new Map(),
    metadata: {
      vertexCount: 100,
      faceCount: 200,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: '/x',
      ...(overrides.metadata ?? {}),
    },
    ...overrides,
  } as LoadedSurface;
}

describe('buildSceneStack', () => {
  it('produces empty groups for empty inputs', () => {
    const result = buildSceneStack([], new Map(), null);
    expect(result.totalCount).toBe(0);
    expect(result.volumes).toHaveLength(0);
    expect(result.surfaces).toHaveLength(0);
    expect(result.mappings).toHaveLength(0);
  });

  it('first non-atlas volume is the base; the rest are overlays', () => {
    const volumes = [
      makeVolume({ id: 'a', name: 'T1w' }),
      makeVolume({ id: 'b', name: 'BOLD' }),
    ];
    const result = buildSceneStack(volumes, new Map(), null);
    expect(result.volumes[0].kind).toBe('volume-base');
    expect(result.volumes[1].kind).toBe('volume-overlay');
  });

  it('flags atlas volumes as volume-overlay-atlas regardless of position', () => {
    const volumes = [
      makeVolume({ id: 'a', name: 'Schaefer', source: 'atlas' }),
      makeVolume({ id: 'b', name: 'T1w' }),
    ];
    const result = buildSceneStack(volumes, new Map(), null);
    // atlas tagging takes precedence over position
    expect(result.volumes.find((v) => v.id === 'a')?.kind).toBe('volume-overlay-atlas');
    // first non-atlas becomes the base
    expect(result.volumes.find((v) => v.id === 'b')?.kind).toBe('volume-base');
  });

  it('emits a mapping scene item for each surface data layer with a volumeId', () => {
    const surface = makeSurface('s1');
    surface.layers.set('dl1', {
      id: 'dl1',
      name: 'projected',
      values: new Float32Array(),
      colormap: 'viridis',
      range: [0, 1],
      dataRange: [0, 1],
      opacity: 0.7,
      volumeId: 'v-source',
    });
    const result = buildSceneStack(
      [makeVolume({ id: 'v-source', name: 'tmap' })],
      new Map([['s1', surface]]),
      null
    );
    expect(result.mappings).toHaveLength(1);
    const mapping = result.mappings[0];
    expect(mapping.kind).toBe('mapping');
    if (mapping.ref.type === 'mapping') {
      expect(mapping.ref.volumeId).toBe('v-source');
      expect(mapping.ref.surfaceId).toBe('s1');
    } else {
      throw new Error('expected mapping ref');
    }
  });

  it('reports opacity from viewStateLayers when available', () => {
    const result = buildSceneStack(
      [makeVolume({ id: 'a', name: 'T1w' })],
      new Map(),
      [{ id: 'a', render: { opacity: 0.42 } }]
    );
    expect(result.volumes[0].opacity).toBeCloseTo(0.42);
  });
});
