import { describe, expect, it } from 'vitest';
import { getComparisonGridSpec, getComparisonPanelDimensions } from '@/utils/comparisonLayout';

describe('comparisonLayout', () => {
  it('accounts for the new-panel drop zone when sizing row layouts', () => {
    expect(getComparisonGridSpec(2, 'row')).toEqual({
      cols: 3,
      rows: 1,
      slotCount: 3,
    });

    expect(
      getComparisonPanelDimensions({ width: 900, height: 300 }, 2, 'row')
    ).toMatchObject({
      cols: 3,
      rows: 1,
      width: 297,
      height: 300,
    });
  });

  it('uses the full grid area height without subtracting the toolbar a second time', () => {
    expect(
      getComparisonPanelDimensions({ width: 600, height: 400 }, 3, 'grid')
    ).toMatchObject({
      cols: 2,
      rows: 2,
      width: 298,
      height: 198,
    });
  });
});
