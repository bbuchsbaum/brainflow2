import { afterEach, describe, expect, it, vi } from 'vitest';

const querySliceAxisMeta = vi.hoisted(() => vi.fn());
vi.mock('@/services/volume/VolumeApiService', () => ({
  getVolumeApiService: () => ({ querySliceAxisMeta }),
}));

import {
  clearStudioPaneSliceSteps,
  planeNormalAxis,
  studioPaneSliceStepMm,
} from '../studioPaneSliceStep';

const axial = { u_mm: [1, 0, 0] as [number, number, number], v_mm: [0, -1, 0] as [number, number, number] };
const coronal = { u_mm: [1, 0, 0] as [number, number, number], v_mm: [0, 0, -1] as [number, number, number] };
const sagittal = { u_mm: [0, 1, 0] as [number, number, number], v_mm: [0, 0, -1] as [number, number, number] };

afterEach(() => {
  clearStudioPaneSliceSteps();
  querySliceAxisMeta.mockReset();
});

describe('studio pane slice step', () => {
  it('names the view axis from the plane normal', () => {
    expect(planeNormalAxis(axial)).toBe('axial');
    expect(planeNormalAxis(coronal)).toBe('coronal');
    expect(planeNormalAxis(sagittal)).toBe('sagittal');
    expect(planeNormalAxis({ u_mm: [1, 0, 0], v_mm: [2, 0, 0] })).toBeNull();
  });

  it('reads the volume\'s spacing along that axis once per volume and axis', async () => {
    querySliceAxisMeta.mockResolvedValue({ sliceCount: 91, sliceSpacing: 2, axisLength: 182 });
    expect(await studioPaneSliceStepMm('v1', axial)).toBe(2);
    expect(await studioPaneSliceStepMm('v1', axial)).toBe(2);
    expect(querySliceAxisMeta).toHaveBeenCalledTimes(1);
    expect(querySliceAxisMeta).toHaveBeenCalledWith('v1', 'axial');
    await studioPaneSliceStepMm('v1', coronal);
    expect(querySliceAxisMeta).toHaveBeenLastCalledWith('v1', 'coronal');
  });

  it('gives null for an unusable answer, and does not cache a failure', async () => {
    querySliceAxisMeta.mockResolvedValueOnce({ sliceCount: 1, sliceSpacing: 0, axisLength: 0 });
    expect(await studioPaneSliceStepMm('v2', axial)).toBeNull();
    querySliceAxisMeta.mockRejectedValueOnce(new Error('no volume'));
    expect(await studioPaneSliceStepMm('v3', axial)).toBeNull();
    querySliceAxisMeta.mockResolvedValueOnce({ sliceCount: 91, sliceSpacing: 2, axisLength: 182 });
    expect(await studioPaneSliceStepMm('v3', axial)).toBe(2);
  });
});
