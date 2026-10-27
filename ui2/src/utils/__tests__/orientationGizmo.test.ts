import { describe, expect, it } from 'vitest';
import { projectGizmoAxes } from '../orientationGizmo';

describe('orientation glyph (D5)', () => {
  it('left lateral view: anterior to the left, superior up, right axis pointing away', () => {
    // Camera at −x looking +x, up +z: screen right is −y (posterior).
    const axes = projectGizmoAxes({ right: [0, -1, 0], up: [0, 0, 1], forward: [1, 0, 0] });
    const byLabel = Object.fromEntries(axes.map((a) => [a.label, a]));
    expect(byLabel.A.x).toBeCloseTo(-1, 9);
    expect(byLabel.S.y).toBeCloseTo(-1, 9); // up on screen (y down)
    expect(byLabel.R.depth).toBeCloseTo(-1, 9);
    // Drawn back to front: R (away) first.
    expect(axes[0].label).toBe('R');
  });

  it('dorsal view: R to the right, A up, S toward the viewer', () => {
    const axes = projectGizmoAxes({ right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] });
    const byLabel = Object.fromEntries(axes.map((a) => [a.label, a]));
    expect(byLabel.R.x).toBeCloseTo(1, 9);
    expect(byLabel.A.y).toBeCloseTo(-1, 9);
    expect(byLabel.S.depth).toBeCloseTo(1, 9);
  });
});
