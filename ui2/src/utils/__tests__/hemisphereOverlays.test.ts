import { describe, expect, it } from 'vitest';
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';
import { overlayMapName, pairedOverlayLayers, pairedRangeUpdates } from '../hemisphereOverlays';

const layer = (id: string, name: string, dataRange: [number, number], range = dataRange): SurfaceDataLayer =>
  ({ id, name, values: new Float32Array([1]), colormap: 'viridis', range, dataRange, threshold: [0, 0], opacity: 1, visible: true }) as SurfaceDataLayer;
const surface = (handle: string, layers: SurfaceDataLayer[]): LoadedSurface =>
  ({ handle, name: handle, visible: true, layers: new Map(layers.map((l) => [l.id, l])), geometry: {}, metadata: {} }) as unknown as LoadedSurface;

/** The colormap position of a value (what the renderer looks up). */
const position = (v: number, range: readonly number[]) => (v - range[0]) / (range[1] - range[0]);

describe('paired hemisphere overlays share one colour range (v1 F1)', () => {
  it('names the map without its hemisphere', () => {
    expect(overlayMapName('lh.sensorimotor.func.gii')).toBe('sensorimotor.func');
    expect(overlayMapName('rh.sensorimotor.func.gii')).toBe('sensorimotor.func');
    expect(overlayMapName('sub-01_hemi-L_task-x_bold.func.gii')).toBe('sub-01_task-x_bold.func');
  });

  it('an rh vertex value maps to the same colour as the same lh value after loading both', () => {
    const lh = layer('a', 'lh.sensorimotor.func.gii', [0, 59412]);
    const rh = layer('b', 'rh.sensorimotor.func.gii', [0, 41588]);
    const updates = pairedRangeUpdates(pairedOverlayLayers([surface('L', [lh]), surface('R', [rh])], rh.name));
    expect(updates).toEqual([{ surfaceId: 'R', layerId: 'b', range: [0, 59412] }]);
    const rhRange = updates[0].range;
    expect(position(41588, rhRange)).toBeCloseTo(position(41588, lh.range), 12);
  });

  it('leaves a re-windowed layer and unrelated maps alone', () => {
    const lh = layer('a', 'lh.sensorimotor.func.gii', [0, 59412], [10, 20]);
    const rh = layer('b', 'rh.sensorimotor.func.gii', [0, 41588]);
    const other = layer('c', 'rh.visual.func.gii', [0, 5]);
    const pairs = pairedOverlayLayers([surface('L', [lh]), surface('R', [rh, other])], 'lh.sensorimotor.func.gii');
    expect(pairs.map((p) => p.layer.id)).toEqual(['a', 'b']);
    expect(pairedRangeUpdates(pairs)).toEqual([{ surfaceId: 'R', layerId: 'b', range: [0, 59412] }]);
  });
});
