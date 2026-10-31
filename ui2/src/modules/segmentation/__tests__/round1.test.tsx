/**
 * Round-1 rules: labels render as an exclusive partition (edges once,
 * constant fill), the crosshair yields to a paint tool, the review encoding
 * and the Approve gate, the native-grid brush readout, and the per-label
 * review statistics that back the Dice table.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  boundaryEdgeSet,
  brushReadout,
  canApprove,
  crosshairGapRadius,
  formatVolume,
  LABEL_FILL_ALPHA,
  partitionEdges,
  reviewEncoding,
} from '@/modules/segmentation/components/shared/geometry';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import { ReviewDecision } from '@/modules/segmentation/components/shared/ProposalParts';
import { LABEL_DEFS, NATIVE, REVIEW_NAV, REVIEW_ROWS } from '@/modules/segmentation/components/shared/mockData';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import type { LabelVoxel } from '@/modules/segmentation/components/shared/types';

describe('partition renderer', () => {
  // Two labels side by side: 1 at (0,0), 2 at (1,0).
  const pair: LabelVoxel[] = [
    [0, 0, 1],
    [1, 0, 2],
  ];

  it('draws a shared edge exactly once, owned by the priority label', () => {
    const edges = partitionEdges(pair);
    const total = edges.reduce((n, e) => n + e.count, 0);
    // 2 voxels x 4 edges = 8, minus the shared edge counted twice = 7.
    expect(total).toBe(7);
    // Lower id owns the shared edge by default; the active label when given.
    expect(edges.find((e) => e.label === 1)?.count).toBe(4);
    const active2 = partitionEdges(pair, [2]);
    expect(active2.find((e) => e.label === 2)?.count).toBe(4);
    expect(active2.find((e) => e.label === 1)?.count).toBe(3);
  });

  it('draws no edge between voxels of the same label', () => {
    const block: LabelVoxel[] = [
      [0, 0, 3],
      [1, 0, 3],
      [0, 1, 3],
      [1, 1, 3],
    ];
    expect(partitionEdges(block)[0].count).toBe(8);
  });

  it('on the real mock slice, every boundary edge is drawn once', () => {
    const slice = DESIGN.labels.cor(DESIGN.primaryJ);
    const edges = partitionEdges(slice, [1]);
    const drawn = edges.flatMap((e) => e.d.split('M').filter(Boolean));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.length).toBe(boundaryEdgeSet(slice).size);
  });

  it('fills one colour per voxel at a constant alpha of at most 0.25', () => {
    expect(LABEL_FILL_ALPHA).toBeLessThanOrEqual(0.25);
    const { container } = render(
      <div style={{ width: 200, height: 200 }}>
        <SliceView image={DESIGN.images.corT2} center={[68, 130]} fovMm={40} overlays={[{ kind: 'labels', voxels: pair }]} />
      </div>,
    );
    const fills = [...container.querySelectorAll('path[fill-opacity]')].map((p) => Number(p.getAttribute('fill-opacity')));
    expect(fills.length).toBe(2);
    expect(new Set(fills)).toEqual(new Set([LABEL_FILL_ALPHA]));
  });
});

describe('crosshair yields to the brush', () => {
  it('opens a gap of at least three brush radii', () => {
    expect(crosshairGapRadius(10)).toBe(30);
    expect(crosshairGapRadius(2)).toBe(12);
    expect(crosshairGapRadius(2, 4)).toBe(6);
  });

  it('splits both crosshair lines around a brush at the crosshair', () => {
    const view = (brush: boolean) =>
      render(
        <div style={{ width: 480, height: 360 }}>
          <SliceView
            image={DESIGN.images.corT2}
            center={[68, 130]}
            fovMm={40}
            crosshair={[68, 130]}
            brush={brush ? { center: [68.5, 130.5], radiusMm: 1.5 } : null}
          />
        </div>,
      );
    const lines = (c: HTMLElement) => c.querySelectorAll('line.stroke-bf-crosshair').length;
    const a = view(false);
    expect(lines(a.container)).toBe(2);
    a.unmount();
    const b = view(true);
    expect(lines(b.container)).toBe(4);
    b.unmount();
  });
});

describe('review', () => {
  it('splits disagreement into A only, B only and relabelled', () => {
    const a: LabelVoxel[] = [
      [0, 0, 1],
      [1, 0, 1],
      [2, 0, 4],
    ];
    const b: LabelVoxel[] = [
      [0, 0, 1],
      [1, 0, 3],
      [3, 0, 1],
    ];
    const enc = reviewEncoding(a, b);
    expect(enc.aOnly).toEqual([[2, 0]]);
    expect(enc.bOnly).toEqual([[3, 0]]);
    expect(enc.relabelled).toEqual([[1, 0]]);
    // Identical raters: nothing departs.
    expect(reviewEncoding(a, a).departureCount).toBe(0);
  });

  it('gates Approve until every disagreement was visited', () => {
    expect(canApprove([0, 1, 2], 5)).toBe(false);
    expect(canApprove([0, 1, 2, 3, 4], 5)).toBe(true);
    expect(canApprove(new Set([1, 1, 2]), 3)).toBe(false);
    expect(canApprove([], 0)).toBe(true);
    const { getByRole } = render(<ReviewDecision />);
    expect(REVIEW_NAV.visited).toBeLessThan(REVIEW_NAV.total);
    expect((getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Return to rater B' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists every label in the agreement table, n/a where B did not trace', () => {
    expect(REVIEW_ROWS.map((r) => r.label)).toEqual(LABEL_DEFS.map((l) => l.id));
    const erc = REVIEW_ROWS.find((r) => r.label === 5)!;
    expect(erc.dice).toBeNull();
    expect(erc.volB).toBe(0);
    for (const r of REVIEW_ROWS) if (r.volB > 0) expect(r.dice).not.toBeNull();
  });
});

describe('native geometry readouts', () => {
  it('counts what a 3 mm brush writes on a 0.4 x 0.4 x 2.0 mm grid', () => {
    const r = brushReadout(3, NATIVE.spacing, '2D');
    expect(r.across).toBe(7);
    expect(r.slices).toBe(1);
    expect(r.inPlane).toBeGreaterThan(30);
    expect(brushReadout(3, [1, 1, 1], '2D').inPlane).toBe(9);
    expect(brushReadout(6, NATIVE.spacing, '3D').slices).toBe(3);
  });

  it('shows mm³ only on a 1 mm grid, vx and mm³ otherwise', () => {
    expect(formatVolume(1376)).toBe('1,376 mm³');
    expect(formatVolume(1376, { voxelMm3: NATIVE.voxelMm3 })).toBe('1,376 vx · 440 mm³');
  });
});
