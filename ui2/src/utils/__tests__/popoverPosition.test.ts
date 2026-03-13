import { describe, expect, it } from 'vitest';
import { clampPopoverPosition } from '../popoverPosition';

describe('clampPopoverPosition', () => {
  it('keeps the popover inside the viewport with padding', () => {
    expect(
      clampPopoverPosition(280, 190, { width: 120, height: 80 }, { width: 320, height: 240 }, 8)
    ).toEqual({
      left: 192,
      top: 152,
    });
  });

  it('does not move positions that are already in bounds', () => {
    expect(
      clampPopoverPosition(24, 36, { width: 100, height: 90 }, { width: 640, height: 480 }, 8)
    ).toEqual({
      left: 24,
      top: 36,
    });
  });
});
