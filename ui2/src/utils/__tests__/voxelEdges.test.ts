import { describe, expect, it } from 'vitest';
import { widenToVoxelEdges } from '../voxelEdges';

describe('widenToVoxelEdges (native N1)', () => {
  it('an 8³ 10 mm volume centred at 0 spans −40..+40 mm (centres −35..+35)', () => {
    const edges = widenToVoxelEdges({ min: [-35, -35, -35], max: [35, 35, 35] }, [8, 8, 8]);
    expect(edges.min).toEqual([-40, -40, -40]);
    expect(edges.max).toEqual([40, 40, 40]);
  });
  it('keeps other fields and leaves bounds without dims unchanged', () => {
    const b = { min: [0, 0, 0] as [number, number, number], max: [10, 20, 30] as [number, number, number], center: [5, 10, 15] };
    expect(widenToVoxelEdges(b, [11, 21, 31])).toMatchObject({ min: [-0.5, -0.5, -0.5], max: [10.5, 20.5, 30.5], center: [5, 10, 15] });
    expect(widenToVoxelEdges(b, null)).toBe(b);
  });
});
