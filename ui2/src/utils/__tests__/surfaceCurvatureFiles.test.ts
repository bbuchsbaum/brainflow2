import { describe, expect, it } from 'vitest';
import { curvatureSidecarCandidates, parseFreeSurferCurv } from '../surfaceCurvatureFiles';

describe('curvature sidecars (D2)', () => {
  it('FreeSurfer and HCP / fs_LR names, sulc before curv', () => {
    expect(curvatureSidecarCandidates('/s/surf/lh.inflated')).toEqual(
      expect.arrayContaining(['/s/surf/lh.sulc', '/s/surf/lh.curv']),
    );
    const hcp = curvatureSidecarCandidates('/d/fs_LR.32k.L.inflated.surf.gii');
    expect(hcp[0]).toBe('/d/fs_LR.32k.L.sulc.shape.gii');
    expect(hcp.indexOf('/d/fs_LR.32k.L.sulc.shape.gii')).toBeLessThan(hcp.indexOf('/d/fs_LR.32k.L.curv.shape.gii'));
    expect(curvatureSidecarCandidates('/d/100307.L.midthickness.32k_fs_LR.surf.gii')).toContain(
      '/d/100307.L.sulc.32k_fs_LR.shape.gii',
    );
  });

  it('nothing for a name without a surface-type token', () => {
    expect(curvatureSidecarCandidates('/d/mesh.gii')).toEqual([]);
  });

  it('parses the FreeSurfer "new" curv format (big-endian)', () => {
    const n = 3;
    const buf = new ArrayBuffer(15 + n * 4);
    const v = new DataView(buf);
    v.setUint8(0, 0xff);
    v.setUint8(1, 0xff);
    v.setUint8(2, 0xff);
    v.setInt32(3, n, false);
    v.setInt32(7, 2, false);
    v.setInt32(11, 1, false);
    [1.5, -0.25, 3].forEach((x, i) => v.setFloat32(15 + i * 4, x, false));
    expect(Array.from(parseFreeSurferCurv(new Uint8Array(buf))!)).toEqual([1.5, -0.25, 3]);
    expect(parseFreeSurferCurv(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
