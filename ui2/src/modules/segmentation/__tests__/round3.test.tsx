/**
 * Round-3 rules (balance): every label strokes the inner edge of its own
 * voxels (both sides of a shared edge show), emphasis levels (active 1.5 px
 * full colour plus a faint inset fill, others 1 px muted, complete/locked
 * quieter), enclosed gaps marked, the neighbour line only where it departs,
 * per-slice bars for every label on one axis (inactive rows muted), the
 * review Inspector ordered for the decision, rater B's untraced labels never
 * textured, locks shown only where they depart from the status, and the
 * orthogonal views' landmark names in a gutter.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ACTIVE_FILL_ALPHA,
  enclosedGaps,
  innerBandPath,
  innerEdges,
  insetVoxels,
  LABEL_STROKE,
  labelEmphasis,
  lockDeparts,
  neighbourDeparturePath,
} from '@/modules/segmentation/components/shared/geometry';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import { LABEL_DEFS, QUIET_LABELS, REVIEW_ROWS } from '@/modules/segmentation/components/shared/mockData';
import { B_NONE } from '@/modules/segmentation/components/shared/scenes';
import { DirectionH } from '@/modules/segmentation/components/directions/h/DirectionH';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import type { LabelVoxel } from '@/modules/segmentation/components/shared/types';

const pair: LabelVoxel[] = [
  [0, 0, 1],
  [1, 0, 2],
];

/** Rectangles of a band path as [x, y, w, h]. */
function rects(d: string): number[][] {
  return [...d.matchAll(/M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)/g)].map((m) => m.slice(1).map(Number));
}

describe('inner-edge label strokes', () => {
  it('gives both labels their side of a shared edge', () => {
    const one = innerEdges(pair, 1);
    const two = innerEdges(pair, 2);
    expect(one.length).toBe(4);
    expect(two.length).toBe(4);
    expect(one).toContainEqual({ c: 0, r: 0, side: 'right' });
    expect(two).toContainEqual({ c: 1, r: 0, side: 'left' });
  });

  it('draws each band inside the label\'s own voxels', () => {
    const t = 0.1;
    for (const [label, c0] of [
      [1, 0],
      [2, 1],
    ] as const) {
      for (const [x, y, w, h] of rects(innerBandPath(pair, label, 0, t))) {
        expect(x).toBeGreaterThanOrEqual(c0 - 1e-9);
        expect(x + w).toBeLessThanOrEqual(c0 + 1 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('closes concave corners', () => {
    // An L of three voxels: the corner voxel (0,0) gets a corner square.
    const ell: LabelVoxel[] = [
      [0, 0, 3],
      [1, 0, 3],
      [0, 1, 3],
    ];
    const d = innerBandPath(ell, 3, 0, 0.2);
    expect(rects(d).length).toBe(innerEdges(ell, 3).length + 1);
  });

  it('renders one stroke per label, both labels on a shared edge', () => {
    const { container } = render(
      <SliceView image={DESIGN.images.corT2} center={[68, 130]} fovMm={40} overlays={[{ kind: 'labels', voxels: pair, fill: false }]} />,
    );
    const strokes = [...container.querySelectorAll('[data-label-stroke]')].map((e) => e.getAttribute('data-label-stroke'));
    expect(strokes.sort()).toEqual(['1', '2']);
    expect(container.querySelectorAll('[data-halo]').length).toBe(2);
  });
});

describe('emphasis levels', () => {
  it('orders active > inactive > quiet', () => {
    expect(LABEL_STROKE.active).toEqual({ width: 1.5, opacity: 1 });
    expect(LABEL_STROKE.inactive.width).toBe(1);
    expect(LABEL_STROKE.inactive.opacity).toBeGreaterThan(0.5);
    expect(LABEL_STROKE.inactive.opacity).toBeLessThan(0.65);
    expect(LABEL_STROKE.quiet.opacity).toBeLessThan(LABEL_STROKE.inactive.opacity);
    expect(LABEL_STROKE.quiet.opacity).toBeGreaterThanOrEqual(0.4);
    expect(labelEmphasis(1, [1], [3])).toBe('active');
    expect(labelEmphasis(3, [1], [3])).toBe('quiet');
    expect(labelEmphasis(4, [1], [3])).toBe('inactive');
    expect(labelEmphasis(4, [], [3])).toBe('plain');
  });

  it('insets the active fill by one voxel', () => {
    const block: LabelVoxel[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) block.push([c, r, 1]);
    expect(insetVoxels(block, 1)).toEqual([[1, 1]]);
    expect(ACTIVE_FILL_ALPHA).toBeLessThanOrEqual(0.1);
  });

  it('direction H tracing: CA1 active, complete labels quiet, CA1 faintly filled, no constant fill', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    const primary = container.querySelector('[data-testid="primary-panel"]')!;
    const em = (id: number) => primary.querySelector(`[data-label-stroke="${id}"]`)?.getAttribute('data-emphasis');
    expect(em(1)).toBe('active');
    for (const id of QUIET_LABELS) expect(em(id)).toBe('quiet');
    expect(em(4)).toBe('inactive');
    expect(primary.querySelector('[data-active-fill="1"]')).not.toBeNull();
    expect(primary.querySelector(`[data-labels] path[fill-opacity="0.22"]`)).toBeNull();
    unmount();
  });
});

describe('gaps and the neighbour line', () => {
  it('finds an unlabelled voxel enclosed by labels', () => {
    const ring: LabelVoxel[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (c !== 1 || r !== 1) ring.push([c, r, (c + r) % 2 ? 1 : 2]);
    expect(enclosedGaps(ring)).toEqual([[1, 1]]);
    expect(enclosedGaps(pair)).toEqual([]);
  });

  it('draws the neighbour only where it departs by more than one voxel', () => {
    const a = [[0, 0], [1, 0], [2, 0]] as const;
    expect(neighbourDeparturePath(a, a, 1)).toBe('');
    const far = [[10, 10]] as const;
    expect(neighbourDeparturePath(far, a, 1).length).toBeGreaterThan(0);
  });

  it('keeps the neighbour key short (keys in the tooltip)', () => {
    const { getByTestId, unmount } = render(<DirectionH state="tracing" />);
    const key = getByTestId('neighbour-key');
    expect(key.textContent?.trim()).toBe('k 10');
    expect(key.getAttribute('title')).toContain('Hold ,');
    unmount();
  });
});

describe('Inspector space', () => {
  it('shows the way forward under the collapsed step card', () => {
    const { getByTestId, getByRole, unmount } = render(<DirectionH state="tracing" />);
    const next = getByTestId('step-next');
    expect(next.querySelectorAll('[data-check="open"]').length).toBe(2);
    expect(getByTestId('reference-thumb')).toBeTruthy();
    expect((getByRole('button', { name: 'Mark CA1 complete' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
  });

  it('draws per-slice bars for all six labels on one axis, inactive rows muted', () => {
    const { getByTestId, unmount } = render(<DirectionH state="tracing" />);
    const m = getByTestId('slice-matrix');
    const rows = [...m.querySelectorAll('[data-matrix-row]')];
    expect(rows.map((r) => Number(r.getAttribute('data-matrix-row')))).toEqual(LABEL_DEFS.map((l) => l.id));
    for (const r of rows) {
      const id = Number(r.getAttribute('data-matrix-row'));
      expect(r.getAttribute('data-emphasis')).toBe(id === 1 ? 'active' : QUIET_LABELS.includes(id) ? 'quiet' : 'inactive');
      if (id !== 5) expect(r.querySelectorAll('[data-bar]').length).toBeGreaterThan(0);
      const op = Number(r.querySelector('[data-bar]')?.getAttribute('opacity') ?? 0);
      if (id !== 1 && id !== 5) expect(op).toBeLessThan(0.5);
    }
    expect(m.querySelector('[data-current-k]')?.textContent).toBe('11');
    unmount();
  });

  it('shows a lock only where it departs from the status', () => {
    expect(lockDeparts({ status: 'complete', locked: true })).toBe(false);
    expect(lockDeparts({ status: 'complete', locked: false })).toBe(true);
    expect(lockDeparts({ status: 'in-progress', locked: true })).toBe(true);
    const { container, unmount } = render(<DirectionH state="tracing" />);
    expect(container.querySelectorAll('[aria-label="Labels"] [data-lock-hidden]').length).toBe(6);
    unmount();
  });
});

describe('review Inspector', () => {
  it('leads with the disagreements and the decision; agreement is Label · Dice · Δ', () => {
    const { getByTestId, unmount } = render(<DirectionH state="review" />);
    const parts = [...getByTestId('review-inspector').querySelectorAll('[data-review-part]')].map((e) => e.getAttribute('data-review-part'));
    expect(parts).toEqual(['disagreements', 'decision', 'agreement']);
    const heads = [...getByTestId('agreement-table').querySelectorAll('thead th')].map((t) => t.textContent?.trim());
    expect(heads).toEqual(['Label', 'Dice', 'Δ B−A']);
    expect(getByTestId('review-details').hasAttribute('open')).toBe(false);
    // Progress is counted once (next to Approve).
    expect(getByTestId('review-inspector').textContent?.match(/flagged visited/g)?.length).toBe(1);
    unmount();
  });

  it('never textures a label rater B did not trace as "A only"', () => {
    expect(B_NONE).toEqual(REVIEW_ROWS.filter((r) => r.volB === 0).map((r) => r.label));
    const view = (bNone?: number[]) =>
      render(
        <SliceView
          image={DESIGN.images.corT2}
          center={[68, 130]}
          fovMm={40}
          overlays={[{ kind: 'review', a: [[68, 130, 5]], b: [], bNone }]}
        />,
      );
    const a = view();
    expect(a.container.querySelector('[data-texture="a-only"]')).not.toBeNull();
    a.unmount();
    const b = view([5]);
    expect(b.container.querySelector('[data-texture="a-only"]')).toBeNull();
    b.unmount();
    const h = render(<DirectionH state="review" />);
    expect(h.getByTestId('b-none-tag').textContent).toContain('B: none');
    h.unmount();
  });
});

describe('orthogonal views and ruler', () => {
  it('put the landmark names in a gutter, not over anatomy', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    expect(container.querySelectorAll('[data-testid="ortho-gutter"]').length).toBe(2);
    expect(container.querySelector('[data-limit-label]')).toBeNull();
    expect(container.querySelectorAll('[data-gutter-current]').length).toBeGreaterThan(0);
    unmount();
  });

  it('sets ruler captions horizontally, and review uses triangles', () => {
    const t = render(<DirectionH state="tracing" />);
    expect(t.container.innerHTML).not.toContain('writing-mode');
    expect(t.container.querySelector('[data-ruler-caption="interp."]')).not.toBeNull();
    t.unmount();
    const r = render(<DirectionH state="review" />);
    expect(r.getByTestId('slice-ruler').querySelector('[data-shape="triangle"]')).not.toBeNull();
    expect(r.getByTestId('slice-ruler').querySelector('[data-shape="hollow-bar"]')).toBeNull();
    r.unmount();
  });
});
