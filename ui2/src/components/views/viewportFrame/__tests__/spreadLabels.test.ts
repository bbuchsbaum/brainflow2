import { describe, expect, it } from 'vitest';
import { spreadLabelCenters } from '../frameFormat';

describe('spreadLabelCenters (colorbar tick labels never crowd)', () => {
  it('pushes a crowded label down, keeps clear ones in place', () => {
    // "6" at 5, "4.5" at 12 (7 px apart), "0" at 80: 13 px minimum gap.
    expect(spreadLabelCenters([5, 12, 80], 13, 5, 155)).toEqual([5, 18, 80]);
  });

  it('pushes back up from the bottom edge', () => {
    expect(spreadLabelCenters([5, 140, 150], 13, 5, 150)).toEqual([5, 137, 150]);
  });

  it('every gap is at least the minimum when the range allows it', () => {
    const out = spreadLabelCenters([5, 6, 7, 8, 155], 13, 5, 155);
    for (let i = 1; i < out.length; i += 1) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(13);
  });
});

import { wrapNameAtBoundaries } from '../frameFormat';

describe('wrapNameAtBoundaries (caption names whole or not at all)', () => {
  it('wraps at its own boundaries into whole pieces', () => {
    expect(wrapNameAtBoundaries('zmap_synthetic', 9, 2)).toEqual(['zmap_', 'synthetic']);
  });
  it('gives nothing (drop the name) when two lines cannot hold it', () => {
    expect(wrapNameAtBoundaries('sub-01_task-motor_space-MNI152_desc-zstat1', 10, 2)).toEqual([]);
  });
});
