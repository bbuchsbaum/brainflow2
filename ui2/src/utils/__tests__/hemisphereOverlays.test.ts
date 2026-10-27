import { describe, expect, it } from 'vitest';
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';
import { overlayMapName, overlaySubjectKey, pairedOverlayLayers, pairedRangeUpdates } from '../hemisphereOverlays';

const layer = (id: string, name: string, dataRange: [number, number], range = dataRange, sourcePath?: string): SurfaceDataLayer =>
  ({ id, name, sourcePath, values: new Float32Array([1]), colormap: 'viridis', range, dataRange, threshold: [0, 0], opacity: 1, visible: true }) as SurfaceDataLayer;
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

  it('strips HCP and suffix hemisphere tokens', () => {
    expect(overlayMapName('sub-01.L.thickness.32k_fs_LR.func.gii')).toBe('sub-01.thickness.32k_fs_LR.func');
    expect(overlayMapName('zstat1_lh.func.gii')).toBe('zstat1.func');
  });
});

describe('hemisphere pairing is per subject / session (v1 fidelity 8)', () => {
  it('keys a subject by BIDS sub / ses / space, else by directory', () => {
    expect(overlaySubjectKey({ name: 'x', sourcePath: '/d/sub-01/ses-2/anat/sub-01_ses-2_hemi-L_space-fsaverage_z.func.gii' })).toBe(
      'sub-01|ses-2|space-fsaverage',
    );
    expect(overlaySubjectKey({ name: 'lh.zstat.gii', sourcePath: '/subjects/bert/surf/lh.zstat.gii' })).toBe('dir:/subjects/bert/surf');
    expect(overlaySubjectKey({ name: 'lh.zstat.gii' }, '/subjects/bert/surf/lh.white')).toBe('dir:/subjects/bert/surf');
  });

  it('two subjects\' lh/rh zstat maps do not pair across subjects', () => {
    const lh1 = layer('a', 'lh.zstat.gii', [0, 5], undefined, '/subjects/s01/surf/lh.zstat.gii');
    const rh1 = layer('b', 'rh.zstat.gii', [0, 4], undefined, '/subjects/s01/surf/rh.zstat.gii');
    const lh2 = layer('c', 'lh.zstat.gii', [0, 9], undefined, '/subjects/s02/surf/lh.zstat.gii');
    const surfaces = [surface('L1', [lh1]), surface('R1', [rh1]), surface('L2', [lh2])];
    expect(pairedOverlayLayers(surfaces, rh1).map((p) => p.layer.id)).toEqual(['a', 'b']);
    expect(pairedOverlayLayers(surfaces, lh2).map((p) => p.layer.id)).toEqual(['c']);
  });

  it('BIDS hemi-L / hemi-R pair within one subject and session, not across sessions', () => {
    const p = (sub: string, ses: string, hemi: string) =>
      `/bids/derivatives/sub-${sub}/ses-${ses}/sub-${sub}_ses-${ses}_hemi-${hemi}_zstat.func.gii`;
    const name = (path: string) => path.split('/').pop()!;
    const l = layer('a', name(p('01', '1', 'L')), [0, 5], undefined, p('01', '1', 'L'));
    const r = layer('b', name(p('01', '1', 'R')), [0, 4], undefined, p('01', '1', 'R'));
    const r2 = layer('c', name(p('01', '2', 'R')), [0, 7], undefined, p('01', '2', 'R'));
    const pairs = pairedOverlayLayers([surface('L', [l]), surface('R', [r, r2])], l);
    expect(pairs.map((x) => x.layer.id)).toEqual(['a', 'b']);
  });
});
