import { describe, expect, it } from 'vitest';
import { getComparisonGridSpec, getComparisonPanelDimensions } from '@/utils/comparisonLayout';

// p2 v2: panels are separated by a 1px splitter instead of an 8px card gutter.
describe('comparisonLayout', () => {
  it('sizes row layouts by real panels only', () => {
    expect(getComparisonGridSpec(2, 'row')).toEqual({
      cols: 2,
      rows: 1,
      slotCount: 2,
    });

    expect(
      getComparisonPanelDimensions({ width: 900, height: 300 }, 2, 'row')
    ).toMatchObject({
      cols: 2,
      rows: 1,
      width: 449,
      height: 300,
    });
  });

  it('uses the full grid area height without subtracting the toolbar a second time', () => {
    expect(
      getComparisonPanelDimensions({ width: 600, height: 400 }, 3, 'grid')
    ).toMatchObject({
      cols: 2,
      rows: 2,
      width: 299,
      height: 199,
    });
  });
});
