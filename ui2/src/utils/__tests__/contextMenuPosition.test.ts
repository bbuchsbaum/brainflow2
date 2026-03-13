import { describe, expect, it } from 'vitest';
import { clampContextMenuPosition } from '../contextMenuPosition';

describe('clampContextMenuPosition', () => {
  it('keeps the menu inside the viewport with padding', () => {
    expect(
      clampContextMenuPosition(310, 210, { width: 120, height: 80 }, { width: 320, height: 240 }, 6)
    ).toEqual({
      left: 194,
      top: 154,
    });
  });

  it('leaves in-bounds coordinates unchanged', () => {
    expect(
      clampContextMenuPosition(24, 36, { width: 100, height: 90 }, { width: 640, height: 480 }, 6)
    ).toEqual({
      left: 24,
      top: 36,
    });
  });
});
