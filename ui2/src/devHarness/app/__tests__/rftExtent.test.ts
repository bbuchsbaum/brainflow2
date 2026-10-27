import { describe, expect, it } from 'vitest';
import { extentModel, latticeResels, applyExtentInference } from '../rftExtent';
import { normalSf, tSf } from '@/utils/distributions';
import type { ClusterTable } from '@brainflow/api';

const close = (actual: number, expected: number, rel: number) =>
  expect(Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300)).toBeLessThanOrEqual(rel);

// Reference values: core/neuro-inference/src/rft.rs and cluster.rs tests
// (scipy and tests/fixtures/rft_reference.py), so the harness mirror answers
// as the backend does.
describe('harness RFT mirror (phase 4 C2)', () => {
  it('distribution tails match scipy', () => {
    close(normalSf(3.1), 9.676032132183562e-4, 1e-10);
    close(normalSf(2.3), 1.072411002167581e-2, 1e-10);
    close(tSf(3.1, 20), 2.822438469562088e-3, 1e-9);
    close(tSf(4.5, 12), 3.63326460701846e-4, 1e-9);
    close(1 - tSf(-2, 5), 5.096973941492915e-2, 1e-9);
  });

  it('spm_P_RF extent p, Ec and Ek match the independent reference', () => {
    const cases = [
      { f: { kind: 'z' as const }, u: 3.1, r: [1, 30, 300, 1000], k: 1, ref: [6.035273930827079e-2, 6.449758039338495e-3, 9.651637836224776, 1.1735745804489e-1] },
      { f: { kind: 'z' as const }, u: 2.3, r: [2, 45.5, 610.25, 1873], k: 12.5, ref: [4.308402828023805e-5, 5.060366731788741e-7, 85.14196442130687, 3.010540205104457e-1] },
      { f: { kind: 't' as const, df: 20 }, u: 3.5, r: [1, 30, 300, 1000], k: 0.5, ref: [2.56723057881741e-1, 1.935636513128601e-2, 15.3275972364994, 8.483589084713153e-2] },
      { f: { kind: 't' as const, df: 12 }, u: 3, r: [1, 12, 80, 200], k: 2, ref: [8.431867294701356e-3, 8.58142140549438e-4, 9.86738231928979, 1.417068327992826e-1] },
    ];
    for (const c of cases) {
      const m = extentModel(c.f, c.u, c.r);
      close(m.pFwe(c.k), c.ref[0], 1e-8);
      close(m.pUncorrected(c.k), c.ref[1], 1e-8);
      close(m.expectedClusters, c.ref[2], 1e-8);
      close(m.expectedReselsPerCluster, c.ref[3], 1e-8);
    }
  });

  it('box resels follow the closed form; a hollow shell has R0 = 2', () => {
    const r = latticeResels(new Uint8Array(240).fill(1), [10, 6, 4], [0.5, 0.5, 0.5]);
    const [a, b, c] = [4.5, 2.5, 1.5];
    [1, a + b + c, a * b + b * c + c * a, a * b * c].forEach((v, i) => close(r[i], v, 1e-12));
    const shell = new Uint8Array(27).fill(1);
    shell[13] = 0;
    expect(latticeResels(shell, [3, 3, 3], [1, 1, 1])[0]).toBeCloseTo(2, 12);
  });

  it('a 20³ z field of 2 mm voxels at 4 mm FWHM gives the backend test values', () => {
    const vol = {
      dims: [20, 20, 20] as [number, number, number],
      affine: [[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]],
      data: new Float32Array(8000).fill(1),
      range: [0, 1] as [number, number],
      header: { dataType: 'FLOAT32', intentCode: 5, intentName: '', intentP1: 0, intentP2: 0, intentP3: 0, description: '' },
    };
    const table = { threshold: 3.1, clusters: [{ voxelCount: 27 }, { voxelCount: 8 }] } as unknown as ClusterTable;
    applyExtentInference(table, vol, { fwhmMm: 4 });
    close(table.clusters[0].pFweExtent!, 9.833494450128821e-5, 1e-8);
    close(table.clusters[0].pUncorrectedExtent!, 1.178888417124667e-5, 1e-8);
    close(table.clusters[1].pFweExtent!, 5.238046330599067e-2, 1e-8);
    expect(table.extentInference!.resels).toEqual([1, 28.5, 270.75, 857.375]);
    close(table.extentInference!.expectedClusters, 8.341737714144005, 1e-8);
    close(table.extentInference!.expectedVoxelsPerCluster, 9.388596643591203e-1, 1e-8);
    expect(table.extentInference!.assumption).toContain('4 mm FWHM (user-supplied)');
    expect(table.extentInference!.assumption).toContain('only 2.0 voxels FWHM');
  });
});
