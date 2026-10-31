/**
 * Round-4 rules (one static fix pass): muted labels are opaque tints (ΔE
 * between muted pairs), inactive strokes keep only the outer halo, islands
 * of the active label get a ring, the slice matrix shows the active row and
 * the flagged rows on one scale (gaps, jumps, outside the pack's range) with
 * the rest behind a disclosure, the step card wraps its rule and lists every
 * check beside an example drawn in its own style, the orthogonals show the
 * active label only with a locator and tilted plane ticks, review reconciles
 * flagged regions, and the contrast strip carries no prose.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { deltaE76, MUTED_MIN_DELTA_E, mutedColor, parseRgb } from '@/modules/segmentation/components/shared/colour';
import { areaFlags, canApprove, LABEL_STROKE, labelIslands } from '@/modules/segmentation/components/shared/geometry';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import {
  CA1,
  DG,
  LABEL_DEFS,
  PROTOCOL,
  RECONCILE,
  SRLM,
  labelColor,
  labelTint,
} from '@/modules/segmentation/components/shared/mockData';
import { DirectionH } from '@/modules/segmentation/components/directions/h/DirectionH';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import type { LabelVoxel } from '@/modules/segmentation/components/shared/types';

describe('muted labels are tints, not alpha', () => {
  it('keeps every stroke opaque; only the active label has the inner rim', () => {
    for (const em of ['active', 'inactive', 'quiet', 'plain'] as const) expect(LABEL_STROKE[em].opacity).toBe(1);
    expect(LABEL_STROKE.active.innerRim).toBe(true);
    expect(LABEL_STROKE.inactive.innerRim).toBe(false);
    expect(LABEL_STROKE.quiet.innerRim).toBe(false);
  });

  it('mutes toward a lighter, less saturated tint of the same label', () => {
    for (const d of LABEL_DEFS) {
      const full = parseRgb(d.color);
      const inactive = parseRgb(labelTint(d.id, 'inactive'));
      const quiet = parseRgb(labelTint(d.id, 'quiet'));
      const lum = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      const spread = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
      expect(lum(inactive)).toBeGreaterThan(lum(full) - 2);
      expect(spread(inactive)).toBeLessThan(spread(full));
      expect(spread(quiet)).toBeLessThan(spread(inactive));
      expect(labelTint(d.id, 'active')).toBe(d.color);
    }
  });

  it(`separates every pair of muted labels by ΔE*ab ≥ ${MUTED_MIN_DELTA_E}`, () => {
    const muted = LABEL_DEFS.flatMap((d) => (['inactive', 'quiet'] as const).map((lv) => ({ id: d.id, c: parseRgb(mutedColor(d.color, lv)) })));
    for (let i = 0; i < muted.length; i++)
      for (let j = i + 1; j < muted.length; j++) {
        if (muted[i].id === muted[j].id) continue;
        expect(deltaE76(muted[i].c, muted[j].c), `${muted[i].id} vs ${muted[j].id}`).toBeGreaterThanOrEqual(MUTED_MIN_DELTA_E);
      }
  });

  it('moves SRLM away from DG and keeps it off the crosshair green', () => {
    expect(deltaE76(parseRgb(labelColor(SRLM)), parseRgb(labelColor(DG)))).toBeGreaterThan(40);
    expect(deltaE76(parseRgb(labelColor(SRLM)), parseRgb('#5fe0a0'))).toBeGreaterThan(25);
  });

  it('draws inactive strokes in their tint, with the outer halo only', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    const primary = container.querySelector('[data-testid="primary-panel"]')!;
    expect(primary.querySelector(`[data-label-stroke="${DG}"]`)?.getAttribute('data-colour')).toBe(labelTint(DG, 'quiet'));
    expect(primary.querySelector(`[data-label-stroke="${CA1}"]`)?.getAttribute('data-colour')).toBe(labelColor(CA1));
    expect(primary.querySelector(`[data-halo="${DG}"]`)?.hasAttribute('data-inner-rim')).toBe(false);
    expect(primary.querySelector(`[data-halo="${CA1}"]`)?.hasAttribute('data-inner-rim')).toBe(true);
    unmount();
  });
});

describe('islands of the active label', () => {
  it('finds pieces beyond the largest component', () => {
    const vs: LabelVoxel[] = [
      [0, 0, 1],
      [1, 0, 1],
      [5, 5, 1],
      [3, 3, 2],
    ];
    expect(labelIslands(vs, 1)).toEqual([[[5, 5]]]);
    expect(labelIslands(vs, 2)).toEqual([]);
  });

  it('rings the island on the primary and keys it inline', () => {
    const { container, getByTestId, unmount } = render(<DirectionH state="tracing" />);
    expect(container.querySelector('[data-testid="primary-panel"] [data-island]')).not.toBeNull();
    expect(getByTestId('island-key').textContent).toContain('island');
    expect(getByTestId('neighbour-key').textContent).toContain('neighbour');
    unmount();
  });
});

describe('area-by-slice flags', () => {
  it('flags gaps, jumps over 40%, slices outside the range and missing slices of complete labels', () => {
    expect(areaFlags([10, 0, 10], null, false)).toEqual([{ kind: 'gap', k: 2 }]);
    expect(areaFlags([10, 20], null, false)).toEqual([{ kind: 'jump', k: 2 }]);
    expect(areaFlags([10, 15], null, false)).toEqual([]);
    expect(areaFlags([2, 10], null, false)).toEqual([]);
    expect(areaFlags([8, 10, 10], [2, 3], false)).toEqual([{ kind: 'outside', k: 1 }]);
    expect(areaFlags([0, 10, 10, 0], [1, 4], true)).toEqual([
      { kind: 'missing', k: 1 },
      { kind: 'missing', k: 4 },
    ]);
    expect(areaFlags([0, 10, 10, 0], [1, 4], false)).toEqual([]);
  });

  it('shows the active row and the flagged rows, the rest behind "Show all labels", on one scale', () => {
    const { getByTestId, unmount } = render(<DirectionH state="tracing" />);
    const m = getByTestId('slice-matrix');
    const more = getByTestId('slice-matrix-more');
    const top = [...m.querySelectorAll('[data-matrix-row]')].filter((r) => !more.contains(r)).map((r) => Number(r.getAttribute('data-matrix-row')));
    expect(top[0]).toBe(CA1);
    for (const id of top.slice(1)) expect(m.querySelector(`[data-matrix-row="${id}"] [data-flag]`)).not.toBeNull();
    const hidden = [...more.querySelectorAll('[data-matrix-row]')].map((r) => Number(r.getAttribute('data-matrix-row')));
    expect([...top, ...hidden].sort()).toEqual(LABEL_DEFS.map((l) => l.id).sort());
    expect(more.hasAttribute('open')).toBe(false);
    expect(getByTestId('slice-matrix-scale').textContent).toMatch(/one scale · max \d+/);
    // Expected ranges come from the pack; bars are opaque tints; slices are buttons.
    expect(m.querySelector(`[data-matrix-row="${CA1}"] [data-expected]`)?.getAttribute('data-expected')).toBe(PROTOCOL.expectedK[CA1].join('-'));
    expect(m.querySelectorAll(`[data-matrix-row="${CA1}"] button[data-k]`).length).toBe(20);
    expect(m.querySelector('[data-bar][opacity]')).toBeNull();
    expect(m.querySelector(`[data-matrix-row="${CA1}"] [data-island-k]`)).not.toBeNull();
    unmount();
  });

  it('draws the pending proposal in the CA1 row: hollow until reviewed', () => {
    const { getByTestId, unmount } = render(<DirectionH state="proposal" />);
    const row = getByTestId('slice-matrix').querySelector(`[data-matrix-row="${CA1}"]`)!;
    expect(row.querySelectorAll('[data-bar="hollow"]').length).toBe(6);
    expect(row.querySelectorAll('[data-bar="solid"]').length).toBe(5);
    unmount();
  });
});

describe('step card and example', () => {
  it('wraps the rule and lists all three checks, the done one ticked, no fraction', () => {
    const { getByTestId, unmount } = render(<DirectionH state="tracing" />);
    expect(getByTestId('step-rule').className).not.toContain('truncate');
    const next = getByTestId('step-next');
    expect(next.querySelectorAll('[data-check]').length).toBe(3);
    expect(next.querySelectorAll('[data-check="done"]').length).toBe(1);
    expect(next.textContent).not.toMatch(/\d\/3 checks/);
    expect(getByTestId('reference-thumb').getAttribute('aria-label')).toBe('Enlarge the pack example');
    unmount();
  });

  it('draws a pack example with neutral hairlines and a flat fill, never dashes', () => {
    const { container, unmount } = render(
      <SliceView
        image={DESIGN.images.corT2}
        center={[68, 130]}
        fovMm={40}
        overlays={[{ kind: 'labels', voxels: DESIGN.labels.cor(DESIGN.primaryJ), active: [CA1], example: true }]}
      />,
    );
    expect(container.querySelector('[data-example]')).not.toBeNull();
    expect(container.querySelector('[data-label-stroke]')).toBeNull();
    expect(container.querySelector(`[data-example-fill="${CA1}"]`)).not.toBeNull();
    expect(container.querySelector('[data-example] [stroke-dasharray]')).toBeNull();
    unmount();
  });
});

describe('orthogonal views', () => {
  it('show the active label only, with a locator and tilted plane ticks', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    const frames = [...container.querySelectorAll('[data-testid="ortho-gutter"]')].map((g) => g.parentElement!);
    expect(frames.length).toBe(2);
    for (const f of frames) {
      const strokes = [...f.querySelectorAll('[data-label-stroke]')].map((e) => e.getAttribute('data-label-stroke'));
      expect(strokes).toEqual([String(CA1)]);
      expect(f.querySelector('[data-testid="ortho-locator"]')).not.toBeNull();
      expect(f.querySelector('[data-band]')?.getAttribute('fill-opacity')).toBe('0.14');
    }
    unmount();
  });
});

describe('review reconciliation', () => {
  it('groups flagged disagreements by region and gates Approve on decisions', () => {
    expect(RECONCILE.regions.length).toBeGreaterThan(1);
    for (const g of RECONCILE.regions) expect(new Set(g.ids).size).toBe(g.ids.length);
    expect(canApprove(RECONCILE.decided, RECONCILE.regions.length)).toBe(false);
    expect(canApprove(RECONCILE.regions.map((g) => g.key), RECONCILE.regions.length)).toBe(true);
    const { getByTestId, getByRole, unmount } = render(<DirectionH state="review" />);
    const open = getByTestId('reconcile-open');
    for (const name of [/Keep A/, /Take B/, /Edit/]) expect(open.textContent).toMatch(name);
    expect((getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('decided-count').textContent).toBe(`${RECONCILE.decided.length} of ${RECONCILE.regions.length} regions decided`);
    expect(getByTestId('review-inspector').textContent?.match(/regions decided/g)?.length).toBe(1);
    unmount();
  });
});

describe('multi-contrast strip', () => {
  it('carries no prose: "Linked · k", a plain view-only caption', () => {
    const { getByTestId, unmount } = render(<DirectionH state="multi-contrast" />);
    const strip = getByTestId('contrast-strip');
    expect(getByTestId('strip-caption').textContent).toBe('k 11');
    expect(strip.textContent).not.toContain('Space');
    expect(strip.textContent).not.toContain('same slice');
    expect(getByTestId('view-only-caption').textContent).toBe('view only');
    expect(getByTestId('example-key')).toBeTruthy();
    unmount();
  });
});
