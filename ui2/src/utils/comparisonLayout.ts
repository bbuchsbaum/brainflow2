import type { ComparisonLayout } from '@/types/comparison';

export interface ComparisonGridSpec {
  cols: number;
  rows: number;
  slotCount: number;
}

export interface ComparisonPanelDimensions extends ComparisonGridSpec {
  width: number;
  height: number;
}

const MIN_PANEL_SIZE = 128;
const GRID_GAP = 4;

export function getComparisonGridSpec(
  panelCount: number,
  layout: ComparisonLayout
): ComparisonGridSpec {
  const slotCount = Math.max(panelCount + 1, 1);

  if (layout === 'row') {
    return {
      cols: slotCount,
      rows: 1,
      slotCount,
    };
  }

  const cols = Math.min(slotCount, 2);
  const rows = Math.ceil(slotCount / cols);

  return {
    cols,
    rows,
    slotCount,
  };
}

export function getComparisonPanelDimensions(
  containerSize: { width: number; height: number },
  panelCount: number,
  layout: ComparisonLayout
): ComparisonPanelDimensions {
  const { cols, rows, slotCount } = getComparisonGridSpec(panelCount, layout);
  const availableWidth = Math.max(containerSize.width, MIN_PANEL_SIZE);
  const availableHeight = Math.max(containerSize.height, MIN_PANEL_SIZE);
  const width = Math.floor((availableWidth - GRID_GAP * (cols - 1)) / cols);
  const height = Math.floor((availableHeight - GRID_GAP * (rows - 1)) / rows);

  return {
    cols,
    rows,
    slotCount,
    width: Math.max(width, MIN_PANEL_SIZE),
    height: Math.max(height, MIN_PANEL_SIZE),
  };
}
