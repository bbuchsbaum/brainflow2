/**
 * Design contract tests for the segmentation module, organised by the rules
 * in `../DESIGN.md` (one describe per rule section). They consolidate the
 * rule tests of hill-climb rounds 1 to 7.
 *
 * Written to outlive the mocks: the rules are tested as pure functions
 * (`shared/geometry.ts`, `shared/workflowRules.ts`, `shared/colour.ts`) and
 * the renderers through the DOM the components produce (data attributes and
 * test ids, not pixels). Screens are reached through `designSubjects.tsx`:
 * when a component is promoted to production, point `renderCore` /
 * `renderWorkflow` at it (fed by a fixture session) and keep these tests.
 * Facts about the mock data alone live in `mockSession.test.ts`.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { LESION, flairAt, lesionsOnK } from '@/modules/segmentation/__design__/lesionData';
import { DIRECTIONS } from '@/modules/segmentation/components/directions';
import { ORTHO_HATCH_PITCH } from '@/modules/segmentation/components/directions/h/workflow/AiStates';
import { VIEW_AIDS_NOTE } from '@/modules/segmentation/components/directions/h/workflow/ContrastAids';
import { DOCK_ROWS } from '@/modules/segmentation/components/directions/h/workflow/HistoryState';
import { LESION_BAND_ALPHA } from '@/modules/segmentation/components/directions/h/workflow/LesionState';
import {
  AI,
  BODY_K,
  BRANCH,
  CANDIDATES,
  HISTORY,
  JOURNAL,
  LESION_CONNECTIVITY,
  LESION_SCENE,
  NEW_LABEL_DEF,
  PER_LABEL_UNDO,
  RANGE,
  SAVE,
} from '@/modules/segmentation/components/directions/h/workflow/workflowData';
import { ReviewDecision } from '@/modules/segmentation/components/shared/ProposalParts';
import { BAND_ALPHA, SliceView } from '@/modules/segmentation/components/shared/SliceView';
import { Sparkline } from '@/modules/segmentation/components/shared/Sparkline';
import {
  MUTED_MIN_DELTA_E,
  deltaE76,
  mutedColor,
  parseRgb,
} from '@/modules/segmentation/components/shared/colour';
import {
  ACTIVE_FILL_ALPHA,
  LABEL_FILL_ALPHA,
  LABEL_STROKE,
  areaFlags,
  brushReadout,
  canApprove,
  crosshairGapRadius,
  discFootprint,
  displayToWorld,
  enclosedGaps,
  formatVolume,
  gateStroke,
  innerBandPath,
  innerEdges,
  insetVoxels,
  labelEmphasis,
  labelIndex,
  labelIslands,
  lockDeparts,
  neighbourDeparturePath,
  partitionEdges,
  reviewEncoding,
  strokeFootprint,
  voxelOutlinePath,
  worldToDisplay,
} from '@/modules/segmentation/components/shared/geometry';
import {
  CA1,
  CA23,
  DG,
  DISAGREEMENTS,
  ERC,
  LABEL_DEFS,
  LABEL_VOLUMES,
  NATIVE,
  NATIVE_SLICES_J,
  PROTOCOL,
  QUIET_LABELS,
  RECONCILE,
  REVIEW_NAV,
  REVIEW_ROWS,
  SRLM,
  labelColor,
  labelTint,
} from '@/modules/segmentation/components/shared/mockData';
import { B_NONE, OVERLAYS, SCENE } from '@/modules/segmentation/components/shared/scenes';
import {
  BEFORE_AI,
  JOURNAL_STEP,
  LABEL_VOXELS,
  LAST_SAVE,
  PROVENANCE_CODES,
  RECOVERY,
  STEPS_SINCE_SAVE,
  aiUsed,
  provenanceTable,
  sessionSliceStatus,
  unreviewedSlices,
} from '@/modules/segmentation/components/shared/session';
import {
  DESIGN_STATES,
  type LabelVoxel,
  type Voxel,
  WORKFLOW_STATES,
} from '@/modules/segmentation/components/shared/types';
import {
  EMPTY_PRIOR_MARGIN_VX,
  FAZEKAS_GRADES,
  LESION_TYPES,
  NIFTI_INTENT_LABEL,
  PARTIAL_VOLUME_RULE,
  RESERVED_MIN_DELTA_E,
  colourCandidates,
  components26,
  defaultConnectivity,
  dsegTsv,
  filterBadge,
  gateProposal,
  itksnapTxt,
  labelVolumeHeader,
  nextUnseen,
  overreach,
  rangeFootprint,
  saveCheck,
  slicesOutside,
  undoForLabel,
  voxelCoverage,
} from '@/modules/segmentation/components/shared/workflowRules';
import { renderCore, renderWorkflow } from './designSubjects';

const crosshairSegments = (c: HTMLElement) =>
  [...c.querySelectorAll('line.stroke-bf-crosshair')].map((l) => ({
    x1: Number(l.getAttribute('x1')),
    y1: Number(l.getAttribute('y1')),
    x2: Number(l.getAttribute('x2')),
    y2: Number(l.getAttribute('y2')),
  }));

/** Two labels side by side: 1 at (0,0), 2 at (1,0). */
const pair: LabelVoxel[] = [
  [0, 0, 1],
  [1, 0, 2],
];

/** Rectangles of a band path as [x, y, w, h]. */
function rects(d: string): number[][] {
  return [...d.matchAll(/M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)/g)].map((m) =>
    m.slice(1).map(Number),
  );
}

const key = (v: readonly number[]) => `${v[0]},${v[1]}`;

const rulerCaptions = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="slice-ruler"] [data-ruler-caption]')].map((e) =>
    e.getAttribute('data-ruler-caption'),
  );

const hollowRulerKs = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="slice-ruler"] [data-status="open"]')].map((e) =>
    Number(/k (\d+)/.exec(e.getAttribute('title') ?? '')?.[1]),
  );

/** A 480 x 360 view (jsdom's fallback size), 40 mm across 360 px: 9 px per mm. */
const crosshairView = (props: Partial<React.ComponentProps<typeof SliceView>>) =>
  render(
    <SliceView
      image={DESIGN.images.corT2}
      center={[68, 130]}
      fovMm={40}
      crosshair={[68, 130]}
      {...props}
    />,
  );

/** The labels locked mid-session (complete): CA2/3, DG, SRLM. */
const locked = new Set([CA23, DG, SRLM]);

/**
 * Fills use one constant alpha; every label strokes the inner edge of its own
 * voxels; active, inactive and quiet emphasis; muting is a tint, never alpha
 * (ΔE*ab ≥ 15); gaps get a dot, islands a ring; the pack example cannot be
 * taken for the user's work.
 */
describe('Labels: an exclusive partition, inner-edge strokes, tints (DESIGN: Labels)', () => {
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

  it('fills one colour per voxel at a constant alpha of at most 0.25', () => {
    expect(LABEL_FILL_ALPHA).toBeLessThanOrEqual(0.25);
    const { container } = render(
      <div style={{ width: 200, height: 200 }}>
        <SliceView
          image={DESIGN.images.corT2}
          center={[68, 130]}
          fovMm={40}
          overlays={[{ kind: 'labels', voxels: pair }]}
        />
      </div>,
    );
    const fills = [...container.querySelectorAll('path[fill-opacity]')].map((p) =>
      Number(p.getAttribute('fill-opacity')),
    );
    expect(fills.length).toBe(2);
    expect(new Set(fills)).toEqual(new Set([LABEL_FILL_ALPHA]));
  });

  it('outlines a single voxel with its four edges', () => {
    expect(voxelOutlinePath([[2, 3]]).match(/M/g)).toHaveLength(4);
  });

  it('gives both labels their side of a shared edge', () => {
    const one = innerEdges(pair, 1);
    const two = innerEdges(pair, 2);
    expect(one.length).toBe(4);
    expect(two.length).toBe(4);
    expect(one).toContainEqual({ c: 0, r: 0, side: 'right' });
    expect(two).toContainEqual({ c: 1, r: 0, side: 'left' });
  });

  it("draws each band inside the label's own voxels", () => {
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
      <SliceView
        image={DESIGN.images.corT2}
        center={[68, 130]}
        fovMm={40}
        overlays={[{ kind: 'labels', voxels: pair, fill: false }]}
      />,
    );
    const strokes = [...container.querySelectorAll('[data-label-stroke]')].map((e) =>
      e.getAttribute('data-label-stroke'),
    );
    expect(strokes.sort()).toEqual(['1', '2']);
    expect(container.querySelectorAll('[data-halo]').length).toBe(2);
  });

  it('orders active > inactive > quiet', () => {
    expect(LABEL_STROKE.active.width).toBe(1.5);
    expect(LABEL_STROKE.inactive.width).toBe(1);
    // Muting is by tint, not opacity (see the tint tests below).
    expect(LABEL_STROKE.inactive.opacity).toBe(1);
    expect(LABEL_STROKE.quiet.width).toBe(1);
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
    const { container, unmount } = renderCore('tracing');
    const primary = container.querySelector('[data-testid="primary-panel"]')!;
    const em = (id: number) =>
      primary.querySelector(`[data-label-stroke="${id}"]`)?.getAttribute('data-emphasis');
    expect(em(1)).toBe('active');
    for (const id of QUIET_LABELS) expect(em(id)).toBe('quiet');
    expect(em(4)).toBe('inactive');
    expect(primary.querySelector('[data-active-fill="1"]')).not.toBeNull();
    expect(primary.querySelector(`[data-labels] path[fill-opacity="0.22"]`)).toBeNull();
    unmount();
  });

  it('keeps every stroke opaque; only the active label has the inner rim', () => {
    for (const em of ['active', 'inactive', 'quiet', 'plain'] as const)
      expect(LABEL_STROKE[em].opacity).toBe(1);
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
    const muted = LABEL_DEFS.flatMap((d) =>
      (['inactive', 'quiet'] as const).map((lv) => ({
        id: d.id,
        c: parseRgb(mutedColor(d.color, lv)),
      })),
    );
    for (let i = 0; i < muted.length; i++)
      for (let j = i + 1; j < muted.length; j++) {
        if (muted[i].id === muted[j].id) continue;
        expect(
          deltaE76(muted[i].c, muted[j].c),
          `${muted[i].id} vs ${muted[j].id}`,
        ).toBeGreaterThanOrEqual(MUTED_MIN_DELTA_E);
      }
  });

  it('moves SRLM away from DG and keeps it off the crosshair green', () => {
    expect(deltaE76(parseRgb(labelColor(SRLM)), parseRgb(labelColor(DG)))).toBeGreaterThan(40);
    expect(deltaE76(parseRgb(labelColor(SRLM)), parseRgb('#5fe0a0'))).toBeGreaterThan(25);
  });

  it('draws inactive strokes in their tint, with the outer halo only', () => {
    const { container, unmount } = renderCore('tracing');
    const primary = container.querySelector('[data-testid="primary-panel"]')!;
    expect(primary.querySelector(`[data-label-stroke="${DG}"]`)?.getAttribute('data-colour')).toBe(
      labelTint(DG, 'quiet'),
    );
    expect(primary.querySelector(`[data-label-stroke="${CA1}"]`)?.getAttribute('data-colour')).toBe(
      labelColor(CA1),
    );
    expect(primary.querySelector(`[data-halo="${DG}"]`)?.hasAttribute('data-inner-rim')).toBe(
      false,
    );
    expect(primary.querySelector(`[data-halo="${CA1}"]`)?.hasAttribute('data-inner-rim')).toBe(
      true,
    );
    unmount();
  });

  it('finds an unlabelled voxel enclosed by labels', () => {
    const ring: LabelVoxel[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) if (c !== 1 || r !== 1) ring.push([c, r, (c + r) % 2 ? 1 : 2]);
    expect(enclosedGaps(ring)).toEqual([[1, 1]]);
    expect(enclosedGaps(pair)).toEqual([]);
  });

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
    const { container, getByTestId, unmount } = renderCore('tracing');
    expect(container.querySelector('[data-testid="primary-panel"] [data-island]')).not.toBeNull();
    expect(getByTestId('island-key').textContent).toContain('island');
    expect(getByTestId('neighbour-key').textContent).toContain('neighbour');
    unmount();
  });

  it('draws a pack example with neutral hairlines and a flat fill, never dashes', () => {
    const { container, unmount } = render(
      <SliceView
        image={DESIGN.images.corT2}
        center={[68, 130]}
        fovMm={40}
        overlays={[
          {
            kind: 'labels',
            voxels: DESIGN.labels.cor(DESIGN.primaryJ),
            active: [CA1],
            example: true,
          },
        ]}
      />,
    );
    expect(container.querySelector('[data-example]')).not.toBeNull();
    expect(container.querySelector('[data-label-stroke]')).toBeNull();
    expect(container.querySelector(`[data-example-fill="${CA1}"]`)).not.toBeNull();
    expect(container.querySelector('[data-example] [stroke-dasharray]')).toBeNull();
    unmount();
  });
});

/**
 * Neighbour slices, proposals, ruler marks and examples never dash; the
 * neighbour line shows only where it departs.
 */
describe('Line meanings: a dash means rater B (DESIGN: Line meanings)', () => {
  it.each(DESIGN_STATES)('direction H %s dashes nothing but rater B', (state) => {
    const { container, unmount } = renderCore(state);
    const dashed = [...container.querySelectorAll('[stroke-dasharray]')].filter((e) =>
      e.getAttribute('stroke-dasharray'),
    );
    for (const e of dashed)
      expect(e.closest('[data-testid="rater-b-departures"], [data-rater="b"]')).not.toBeNull();
    // HTML dashed borders are gone too (ruler, proposal progress).
    expect(container.querySelector('.border-dashed')).toBeNull();
    unmount();
  });

  it.each(WORKFLOW_STATES)(
    '%s dashes nothing (a dash is rater B, who is not on these screens)',
    (state) => {
      const { container, unmount } = renderWorkflow(state);
      const dashed = [...container.querySelectorAll('[stroke-dasharray]')].filter((e) =>
        e.getAttribute('stroke-dasharray'),
      );
      expect(dashed).toEqual([]);
      expect(container.querySelector('.border-dashed')).toBeNull();
      unmount();
    },
  );

  it('proposal outlines are thin and solid; the hatch says "proposed"', () => {
    const outline = OVERLAYS.proposal([[0, 0]]).find((o) => o.kind === 'voxels' && o.outline);
    expect(outline).toMatchObject({ width: 1 });
    expect(outline && 'dashed' in outline ? outline.dashed : undefined).toBeFalsy();
  });

  it('draws the neighbour only where it departs by more than one voxel', () => {
    const a = [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const;
    expect(neighbourDeparturePath(a, a, 1)).toBe('');
    const far = [[10, 10]] as const;
    expect(neighbourDeparturePath(far, a, 1).length).toBeGreaterThan(0);
  });

  it('keeps the neighbour key short (keys in the tooltip)', () => {
    const { getByTestId, unmount } = renderCore('tracing');
    const key = getByTestId('neighbour-key');
    expect(key.textContent?.trim()).toBe('neighbour k 10');
    expect(key.getAttribute('title')).toContain('Hold ,');
    unmount();
  });
});

/**
 * The footprint is the exact voxel set written (voxel centre inside the disc);
 * locked labels are never written and a refused stroke says why once; the
 * readout states what the native grid gets.
 */
describe('Brush footprint and the constraint gate (DESIGN: Line meanings, Geometry headers)', () => {
  it('paints voxels whose centres lie inside the brush disc', () => {
    // Centred on a voxel centre, radius 1.5 mm: the 3 x 3 block.
    expect(discFootprint([10.5, 10.5], 1.5)).toHaveLength(9);
    // Radius 1 mm: the centre and its four neighbours.
    expect(discFootprint([10.5, 10.5], 1)).toHaveLength(5);
    // A stroke is the union of the discs swept along it: a 5-voxel row plus
    // the voxels above and below the three centres it passes through.
    expect(
      strokeFootprint(
        [
          [10.5, 10.5],
          [12.5, 10.5],
        ],
        1,
      ).length,
    ).toBe(11);
  });

  it('never writes into locked labels and reports what it refused', () => {
    const labels = labelIndex([
      [10, 10, 3],
      [11, 10, 3],
      [12, 10, 0],
    ]);
    const gate = gateStroke(
      [
        [10, 10],
        [11, 10],
        [12, 10],
        [13, 10],
      ],
      labels,
      1,
      new Set([3]),
      'unlocked',
    );
    expect(gate.written).toEqual([
      [12, 10],
      [13, 10],
    ]);
    expect(gate.blocked.map((b) => b.label)).toEqual([3, 3]);
    expect(gateStroke([[10, 10]], labels, 1, new Set(), 'background').blocked).toHaveLength(1);
  });

  it('states a refused stroke once at the cursor, plus the header chip', () => {
    const { getByTestId, container, unmount } = renderCore('blocked');
    expect(getByTestId('blocked-callout')).toBeTruthy();
    expect(getByTestId('status-chip').textContent).toContain('Blocked');
    expect(getByTestId('constraint-strip').getAttribute('data-blocked')).toBeNull();
    expect(container.textContent?.match(/is locked/g)?.length).toBe(1);
    expect(container.textContent).not.toContain('DG (locked)');
    unmount();
  });

  it('counts what a 3 mm brush writes on a 0.4 x 0.4 x 2.0 mm grid', () => {
    const r = brushReadout(3, NATIVE.spacing, '2D');
    expect(r.across).toBe(7);
    expect(r.slices).toBe(1);
    expect(r.inPlane).toBeGreaterThan(30);
    expect(brushReadout(3, [1, 1, 1], '2D').inPlane).toBe(9);
    expect(brushReadout(6, NATIVE.spacing, '3D').slices).toBe(3);
  });
});

/**
 * A solid hairline that opens a gap of at least three brush radii, stays out
 * of the edited structure, and is edge ticks only in small tiles.
 */
describe('Crosshair (DESIGN: Crosshair)', () => {
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

  it('stops both lines at a clear box around the structure', () => {
    const { container } = crosshairView({
      crosshairClearBox: { x0: 63, y0: 125, x1: 73, y1: 135 },
    });
    const s = 9;
    const box = { x0: 240 - 5 * s, x1: 240 + 5 * s, y0: 180 - 5 * s, y1: 180 + 5 * s };
    const segs = crosshairSegments(container);
    expect(segs.length).toBe(4);
    for (const g of segs) {
      const inX = Math.max(g.x1, g.x2) > box.x0 && Math.min(g.x1, g.x2) < box.x1;
      const inY = Math.max(g.y1, g.y2) > box.y0 && Math.min(g.y1, g.y2) < box.y1;
      expect(inX && inY).toBe(false);
    }
  });

  it('draws only short edge ticks in small tiles', () => {
    const { container } = crosshairView({ crosshairTicks: true });
    const segs = crosshairSegments(container);
    expect(segs.length).toBe(4);
    for (const g of segs) expect(Math.hypot(g.x2 - g.x1, g.y2 - g.y1)).toBeLessThanOrEqual(10);
  });

  it('is a solid hairline', () => {
    const { container } = crosshairView({});
    for (const l of container.querySelectorAll('line.stroke-bf-crosshair')) {
      expect(l.getAttribute('stroke-dasharray')).toBeNull();
      expect(Number(l.getAttribute('stroke-width'))).toBe(1);
    }
  });
});

/**
 * World/display round trip; the primary named by native slice; mm³ on a 1 mm
 * grid, vx plus mm³ otherwise; one source for every volume.
 */
describe('Geometry headers and volumes (DESIGN: Geometry headers)', () => {
  it('maps world mm to display and back on every plane', () => {
    const w = [-26, -22, -16] as const;
    for (const plane of ['coronal', 'axial', 'sagittal'] as const) {
      const p = worldToDisplay(plane, w);
      const index = plane === 'coronal' ? 110 : plane === 'axial' ? 62 : 70;
      expect(displayToWorld(plane, index, p)).toEqual([...w]);
    }
  });

  it('shows mm³ only on a 1 mm grid, vx and mm³ otherwise', () => {
    expect(formatVolume(1376)).toBe('1,376 mm³');
    expect(formatVolume(1376, { voxelMm3: NATIVE.voxelMm3 })).toBe('1,376 vx · 440 mm³');
  });

  it('the label list and the review table print the same mm³ for a complete label', () => {
    const tracing = renderCore('tracing');
    const dg = LABEL_VOLUMES[3];
    const mm3 = Math.round(dg.final * NATIVE.voxelMm3).toLocaleString('en-US');
    expect(tracing.container.textContent).toContain(
      `${dg.now.toLocaleString('en-US')} vx · ${mm3} mm³`,
    );
    tracing.unmount();
    const review = renderCore('review');
    const cells = [...review.container.querySelectorAll('td')].map((t) => t.textContent);
    expect(cells).toContain(mm3);
    review.unmount();
  });

  it('names the primary by native slice and hides paint tools in review', () => {
    const { getByTestId, getByLabelText, unmount } = renderCore('review');
    expect(getByTestId('primary-geometry').textContent).toContain('k 11/20');
    expect(getByLabelText('Segmentation tools').querySelectorAll('button').length).toBe(1);
    unmount();
  });
});

/**
 * Active label only, a locator, the tilted native band; landmark names in a
 * gutter; horizontal ruler captions; review triangles.
 */
describe('Orthogonal views and the slice ruler (DESIGN: Orthogonal views, Slice ruler)', () => {
  it('put the landmark names in a gutter, not over anatomy', () => {
    const { container, unmount } = renderCore('tracing');
    expect(container.querySelectorAll('[data-testid="ortho-gutter"]').length).toBe(2);
    expect(container.querySelector('[data-limit-label]')).toBeNull();
    expect(container.querySelectorAll('[data-gutter-current]').length).toBeGreaterThan(0);
    unmount();
  });

  it('show the active label only, with a locator and tilted plane ticks', () => {
    const { container, unmount } = renderCore('tracing');
    const frames = [...container.querySelectorAll('[data-testid="ortho-gutter"]')].map(
      (g) => g.parentElement!,
    );
    expect(frames.length).toBe(2);
    for (const f of frames) {
      const strokes = [...f.querySelectorAll('[data-label-stroke]')].map((e) =>
        e.getAttribute('data-label-stroke'),
      );
      expect(strokes).toEqual([String(CA1)]);
      expect(f.querySelector('[data-testid="ortho-locator"]')).not.toBeNull();
      expect(f.querySelector('[data-band]')?.getAttribute('fill-opacity')).toBe('0.14');
    }
    unmount();
  });

  it('sets ruler captions horizontally, and review uses triangles', () => {
    const t = renderCore('tracing');
    expect(t.container.innerHTML).not.toContain('writing-mode');
    expect(t.container.querySelector('[data-ruler-caption="interp."]')).not.toBeNull();
    t.unmount();
    const r = renderCore('review');
    expect(r.getByTestId('slice-ruler').querySelector('[data-shape="triangle"]')).not.toBeNull();
    expect(r.getByTestId('slice-ruler').querySelector('[data-shape="hollow-bar"]')).toBeNull();
    r.unmount();
  });
});

/**
 * The step card wraps its rule and lists every check; locks show only where
 * they depart; one matrix of per-slice bars on one scale with gap, jump,
 * outside and missing flags.
 */
describe('Inspector: step card, labels and the slice matrix (DESIGN: Inspector)', () => {
  it('shows the way forward under the collapsed step card', () => {
    const { getByTestId, getByRole, unmount } = renderCore('tracing');
    const next = getByTestId('step-next');
    expect(next.querySelectorAll('[data-check="open"]').length).toBe(2);
    expect(getByTestId('reference-thumb')).toBeTruthy();
    expect((getByRole('button', { name: 'Mark CA1 complete' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    unmount();
  });

  it('wraps the rule and lists all three checks, the done one ticked, no fraction', () => {
    const { getByTestId, unmount } = renderCore('tracing');
    expect(getByTestId('step-rule').className).not.toContain('truncate');
    const next = getByTestId('step-next');
    expect(next.querySelectorAll('[data-check]').length).toBe(3);
    expect(next.querySelectorAll('[data-check="done"]').length).toBe(1);
    expect(next.textContent).not.toMatch(/\d\/3 checks/);
    expect(getByTestId('reference-thumb').getAttribute('aria-label')).toBe(
      'Enlarge the pack example',
    );
    unmount();
  });

  it('label rows carry swatch, id, name, volume, status and lock; per-slice bars live in one matrix (round 3)', () => {
    const { container, unmount } = renderCore('tracing');
    expect(container.querySelector('[aria-label^="Hide "]')).toBeNull();
    expect(
      container.querySelectorAll('[aria-label="Labels"] [aria-label$="click a slice to go there"]')
        .length,
    ).toBe(0);
    expect(container.textContent).not.toContain('Lines: area per slice');
    unmount();
  });

  it('draws per-slice bars for all six labels on one axis, inactive rows muted', () => {
    const { getByTestId, unmount } = renderCore('tracing');
    const m = getByTestId('slice-matrix');
    const rows = [...m.querySelectorAll('[data-matrix-row]')];
    expect(rows.map((r) => Number(r.getAttribute('data-matrix-row')))).toEqual(
      LABEL_DEFS.map((l) => l.id),
    );
    for (const r of rows) {
      const id = Number(r.getAttribute('data-matrix-row'));
      expect(r.getAttribute('data-emphasis')).toBe(
        id === 1 ? 'active' : QUIET_LABELS.includes(id) ? 'quiet' : 'inactive',
      );
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
    const { container, unmount } = renderCore('tracing');
    expect(container.querySelectorAll('[aria-label="Labels"] [data-lock-hidden]').length).toBe(6);
    unmount();
  });

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
    const { getByTestId, unmount } = renderCore('tracing');
    const m = getByTestId('slice-matrix');
    const more = getByTestId('slice-matrix-more');
    const top = [...m.querySelectorAll('[data-matrix-row]')]
      .filter((r) => !more.contains(r))
      .map((r) => Number(r.getAttribute('data-matrix-row')));
    expect(top[0]).toBe(CA1);
    for (const id of top.slice(1))
      expect(m.querySelector(`[data-matrix-row="${id}"] [data-flag]`)).not.toBeNull();
    const hidden = [...more.querySelectorAll('[data-matrix-row]')].map((r) =>
      Number(r.getAttribute('data-matrix-row')),
    );
    expect([...top, ...hidden].sort()).toEqual(LABEL_DEFS.map((l) => l.id).sort());
    expect(more.hasAttribute('open')).toBe(false);
    expect(getByTestId('slice-matrix-scale').textContent).toMatch(/one scale · max \d+/);
    // Expected ranges come from the pack; bars are opaque tints; slices are buttons.
    expect(
      m.querySelector(`[data-matrix-row="${CA1}"] [data-expected]`)?.getAttribute('data-expected'),
    ).toBe(PROTOCOL.expectedK[CA1].join('-'));
    expect(m.querySelectorAll(`[data-matrix-row="${CA1}"] button[data-k]`).length).toBe(20);
    expect(m.querySelector('[data-bar][opacity]')).toBeNull();
    expect(m.querySelector(`[data-matrix-row="${CA1}"] [data-island-k]`)).not.toBeNull();
    unmount();
  });

  it('draws the pending proposal in the CA1 row: hollow until reviewed', () => {
    const { getByTestId, unmount } = renderCore('proposal');
    const row = getByTestId('slice-matrix').querySelector(`[data-matrix-row="${CA1}"]`)!;
    expect(row.querySelectorAll('[data-bar="hollow"]').length).toBe(6);
    expect(row.querySelectorAll('[data-bar="solid"]').length).toBe(5);
    unmount();
  });

  it('draws one bar per non-empty slice and a hole for an empty one', () => {
    const { container } = render(<Sparkline values={[3, 0, 4, 5]} label="area" variant="bars" />);
    expect(container.querySelectorAll('[data-bars] rect').length).toBe(3);
  });
});

/**
 * A proposal adds empty voxels only, is drawn in the target label's colour
 * (hatch, thin solid outline), and Enter accepts one slice and steps to the
 * next unseen; Confirm all is subordinate; proposal undo is separate.
 */
describe('Proposals: one grammar, accepted slice by slice (DESIGN: Proposal, AI assist)', () => {
  it('counts proposal progress once and keeps Confirm all subordinate', () => {
    const { getByTestId, getByRole, unmount } = renderCore('proposal');
    expect(getByTestId('proposal-bar').textContent?.match(/reviewed/g)?.length).toBe(1);
    expect(getByRole('button', { name: /Confirm all/ }).textContent).toContain('…');
    unmount();
  });

  it('the gate adds empty voxels only and reports the rest', () => {
    const labels = labelIndex(SCENE.tracing.base);
    const raw: Voxel[] = [
      ...SCENE.tracing.base.slice(0, 40).map(([c, r]) => [c, r] as const),
      [0, 0],
      [1, 0],
    ];
    const g = gateProposal(raw, labels, CA1, locked);
    for (const v of g.added) expect(labels.get(key(v)) ?? 0).toBe(0);
    for (const p of g.protected) {
      expect(labels.get(key(p.voxel))).toBe(p.label);
      expect(p.label).not.toBe(CA1);
      expect(p.locked).toBe(locked.has(p.label));
    }
    expect(g.added.length + g.protected.length + g.already).toBe(new Set(raw.map(key)).size);
  });

  it('Enter accepts this slice and steps to the next unseen one', () => {
    expect(nextUnseen([11, 10, 12, 9, 13], [11, 10, 12], 11)).toBe(9);
    expect(nextUnseen([11, 10], [11, 10], 10)).toBeNull();
    expect(AI.next).toBe(nextUnseen(AI.order, AI.seen, AI.current));
    const { getByTestId, unmount } = renderWorkflow('ai-prompt');
    const accept = getByTestId('ai-accept');
    expect(accept.textContent).toContain('Accept CA1 here');
    expect(accept.getAttribute('title')).toMatch(new RegExp(`k ${AI.current} only.*k ${AI.next}`));
    expect(getByTestId('ai-next').textContent).toBe(`then k ${AI.next}`);
    // Confirm all is the quiet secondary, after the other actions, and warns about unseen slices.
    const all = getByTestId('ai-confirm-all');
    expect(all.textContent).toContain(`Confirm all ${AI.slices.length}`);
    expect(all.getAttribute('title')).toMatch(/AI, not reviewed/);
    expect(all.getAttribute('title')).toMatch(/Asks once more/);
    expect(accept.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accept.className).not.toBe(all.className);
    unmount();
  });

  it('the state shows the kept voxels, confirms by label name and keeps prompt undo apart from document undo', () => {
    const { container, getByTestId, unmount } = renderWorkflow('ai-prompt');
    // Per-slice accept is the default.
    expect(getByTestId('ai-accept').textContent).toContain('Accept CA1 here');
    expect(getByTestId('prompt-undo').getAttribute('title')).toMatch(
      /document undo \(⌘Z\) is separate/,
    );
    // the kept count moved into the key's tooltip.
    expect(getByTestId('ai-protected').getAttribute('title')).toContain(
      `${AI.protected.length} vx kept`,
    );
    expect(getByTestId('ai-provider').textContent).toMatch(
      /nnInteractive v2\.5\.0 · local · 0\.84 s/,
    );
    expect(container.querySelectorAll('[data-testid="prompt-rail"] button')).toHaveLength(5);
    // Prompts on this slice are drawn by form; the k 9 prompt is only listed.
    expect(container.querySelectorAll('[data-prompt]')).toHaveLength(
      AI.prompts.filter((p) => p.k === AI.prompts[0].k).length,
    );
    // the Inspector counts the prompts instead of listing them again.
    expect(getByTestId('prompt-count').textContent).toBe(`${AI.prompts.length} prompts`);
    unmount();
  });
});

/**
 * A only, B only and relabelled told apart by form; flagged first; regions
 * decided once; Return is the default and Approve waits for every flagged
 * region; a label B never traced is not textured.
 */
describe('Review and reconciliation (DESIGN: Review and reconciliation)', () => {
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
    expect((getByRole('button', { name: 'Return to rater B' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('lists flagged regions first and gates Approve on them', () => {
    const firstUnflagged = DISAGREEMENTS.findIndex((r) => !r.flagged);
    expect(firstUnflagged).toBe(REVIEW_NAV.flagged);
    expect(DISAGREEMENTS.length).toBe(REVIEW_NAV.total);
    expect(canApprove(REVIEW_NAV.visitedIds, REVIEW_NAV.flagged)).toBe(false);
    const flaggedIds = DISAGREEMENTS.filter((r) => r.flagged).map((r) => r.id);
    expect(canApprove(flaggedIds, REVIEW_NAV.flagged)).toBe(true);
    const { getByRole, getByText } = render(<ReviewDecision />);
    expect((getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      getByText(`${REVIEW_NAV.visited} of ${REVIEW_NAV.flagged} flagged visited`),
    ).toBeTruthy();
  });

  it('leads with the disagreements and the decision; agreement is Label · Dice · Δ', () => {
    const { getByTestId, unmount } = renderCore('review');
    const parts = [...getByTestId('review-inspector').querySelectorAll('[data-review-part]')].map(
      (e) => e.getAttribute('data-review-part'),
    );
    expect(parts).toEqual(['disagreements', 'decision', 'agreement']);
    const heads = [...getByTestId('agreement-table').querySelectorAll('thead th')].map((t) =>
      t.textContent?.trim(),
    );
    expect(heads).toEqual(['Label', 'Dice', 'Δ B−A']);
    expect(getByTestId('review-details').hasAttribute('open')).toBe(false);
    // Progress is counted once (next to Approve); round 4 counts decided regions.
    expect(getByTestId('review-inspector').textContent?.match(/regions decided/g)?.length).toBe(1);
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
    const h = renderCore('review');
    expect(h.getByTestId('b-none-tag').textContent).toContain('B: none');
    h.unmount();
  });

  it('groups flagged disagreements by region and gates Approve on decisions', () => {
    expect(RECONCILE.regions.length).toBeGreaterThan(1);
    for (const g of RECONCILE.regions) expect(new Set(g.ids).size).toBe(g.ids.length);
    expect(canApprove(RECONCILE.decided, RECONCILE.regions.length)).toBe(false);
    expect(
      canApprove(
        RECONCILE.regions.map((g) => g.key),
        RECONCILE.regions.length,
      ),
    ).toBe(true);
    const { getByTestId, getByRole, unmount } = renderCore('review');
    const open = getByTestId('reconcile-open');
    for (const name of [/Keep A/, /Take B/, /Edit/]) expect(open.textContent).toMatch(name);
    expect((getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('decided-count').textContent).toBe(
      `${RECONCILE.decided.length} of ${RECONCILE.regions.length} regions decided`,
    );
    expect(getByTestId('review-inspector').textContent?.match(/regions decided/g)?.length).toBe(1);
    unmount();
  });
});

/**
 * The contrast strip at the primary's slice and scale, without prose; a filter
 * badge derived from the image; filters never change labels; the lens is a
 * square; View aids is one line.
 */
describe('Multi-contrast and view-only aids (DESIGN: Contrast aids, Layout)', () => {
  it('has no contrast strip while tracing; the multi-contrast layout keeps it at the primary zoom', () => {
    const t = renderCore('tracing');
    expect(t.queryByTestId('contrast-strip')).toBeNull();
    t.unmount();
    const m = renderCore('multi-contrast');
    // the strip header is "Linked · k 11"; the zoom is in its tooltip and the primary header.
    expect(m.getByTestId('contrast-strip').querySelector('[title*="(4.0×)"]')).not.toBeNull();
    expect(m.getByTestId('primary-panel').textContent).toContain('4.0×');
    m.unmount();
  });

  it('carries no prose: "Linked · k", a plain view-only caption', () => {
    const { getByTestId, unmount } = renderCore('multi-contrast');
    const strip = getByTestId('contrast-strip');
    expect(getByTestId('strip-caption').textContent).toBe('k 11');
    expect(strip.textContent).not.toContain('Space');
    expect(strip.textContent).not.toContain('same slice');
    expect(getByTestId('view-only-caption').textContent).toBe('view only');
    expect(getByTestId('example-key')).toBeTruthy();
    unmount();
  });

  it('derives the badge from the image', () => {
    expect(filterBadge(DESIGN.images.corT2u)).toBe('unsharp · view only');
    expect(filterBadge(DESIGN.images.corT2)).toBeNull();
  });

  it.each(WORKFLOW_STATES)(
    '%s: a badge exactly when the primary shows a filtered image',
    (state) => {
      const { container, unmount } = renderWorkflow(state);
      const href = container
        .querySelector('[data-testid="primary-panel"] svg image')
        ?.getAttribute('href');
      const filtered = href === DESIGN.images.corT2u.url;
      expect(!!container.querySelector('[data-testid="filter-badge"]')).toBe(filtered);
      unmount();
    },
  );

  it('the lens shows T1w and the filter stays out of the label strokes', () => {
    const { container, getByTestId, unmount } = renderWorkflow('contrast-aids');
    expect(getByTestId('cursor-lens').querySelector('svg image')?.getAttribute('href')).toBe(
      DESIGN.images.corT1.url,
    );
    expect(getByTestId('filter-recipe').textContent).toMatch(/unsharp mask σ 1\.5 mm/);
    expect(container.querySelector('[data-testid="flicker-keys"]')).not.toBeNull();
    unmount();
  });

  it('the lens is a square, never the island ring', () => {
    const { getByTestId, unmount } = renderWorkflow('contrast-aids');
    expect(getByTestId('cursor-lens').getAttribute('data-shape')).toBe('square');
    expect(getByTestId('cursor-lens').className).not.toMatch(/rounded-full/);
    unmount();
  });

  it('View aids is one line with the rest behind "?"; the lens switch shows on while the lens shows', () => {
    const { getByTestId, unmount } = renderWorkflow('contrast-aids');
    expect(getByTestId('view-aids-line').textContent).toBe(
      'display only · never written · filters recorded',
    );
    expect(getByTestId('view-aids-help').getAttribute('title')).toBe(VIEW_AIDS_NOTE);
    expect(getByTestId('view-aids').textContent).not.toContain('Edits map through');
    expect(
      getByTestId('view-aids')
        .querySelector('[aria-label="Lens shown"]')!
        .getAttribute('aria-checked'),
    ).toBe('true');
    unmount();
  });
});

/**
 * Every workflow state renders on H's shell; sheets never cover the primary;
 * plain language first, the record behind "Show record"; the island ring keeps
 * its key.
 */
describe('Workflow shell (DESIGN: Workflow states)', () => {
  it('direction h offers every workflow state; the round-0 directions none', () => {
    expect(DIRECTIONS.h.workflow).toBeDefined();
    for (const id of ['a', 'b', 'c'] as const) expect(DIRECTIONS[id].workflow).toBeUndefined();
  });

  it.each(WORKFLOW_STATES)(
    'renders %s with the shell, a primary view and the mock disclosure',
    (state) => {
      const { container, unmount } = renderWorkflow(state);
      expect(container.querySelector('[data-direction="h"]')?.getAttribute('data-state')).toBe(
        state,
      );
      expect(container.querySelector('[data-testid="primary-panel"] svg image')).not.toBeNull();
      expect(container.querySelector('[data-testid="mock-disclosure"]')?.textContent).toMatch(
        /^Design mock/,
      );
      unmount();
    },
  );

  it.each(['ai-consent', 'save', 'setup'] as const)(
    'the %s sheet replaces the side column, never the primary',
    (state) => {
      const { container, unmount } = renderWorkflow(state);
      const sheet = container.querySelector('[data-sheet]');
      expect(sheet).not.toBeNull();
      expect(container.querySelector('[data-testid="primary-panel"]')).not.toBeNull();
      expect(sheet!.contains(container.querySelector('[data-testid="primary-panel"]'))).toBe(false);
      expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();
      unmount();
    },
  );

  it.each(WORKFLOW_STATES)('%s keys the island ring wherever it draws one', (state) => {
    const { container, unmount } = renderWorkflow(state);
    const ring = container.querySelector('[data-testid="primary-panel"] [data-islands]');
    if (ring) expect(container.querySelector('[data-testid="island-key"]')).not.toBeNull();
    unmount();
  });

  it.each([
    ['ai-consent', 'consent-sentence', 'consent-record'],
    ['save', 'save-sentence', 'save-record'],
  ] as const)(
    '%s states one sentence and keeps the record behind "Show record"',
    (state, sentence, record) => {
      const { getByTestId, unmount } = renderWorkflow(state);
      expect(getByTestId(sentence).textContent!.length).toBeGreaterThan(40);
      const details = getByTestId(record) as HTMLDetailsElement;
      expect(details.tagName).toBe('DETAILS');
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')!.textContent).toBe('Show record');
      unmount();
    },
  );

  it('the unselected remote server is one line with its warning', () => {
    const { getByTestId, unmount } = renderWorkflow('ai-consent');
    const remote = getByTestId('server-remote');
    expect(remote.getAttribute('aria-checked')).toBe('false');
    expect(remote.querySelector('input')).toBeNull();
    expect(getByTestId('leaves-remote').textContent).toMatch(/Leaves this computer/);
    unmount();
  });
});

/**
 * Journal counts, provenance codes and ruler and matrix marks come from one
 * model and agree across states; a state may show an earlier moment (asOf) and
 * then carries no later marks.
 */
describe('One session model (DESIGN: Workflow states, One session model)', () => {
  it('journal, recovery and save agree on the steps since the last save', () => {
    expect(STEPS_SINCE_SAVE).toBe(JOURNAL_STEP - LAST_SAVE.step);
    expect(RECOVERY.steps).toBe(STEPS_SINCE_SAVE);
    expect(JOURNAL.sinceSave).toBe(STEPS_SINCE_SAVE);
    expect(SAVE.stepsUnsaved).toBe(STEPS_SINCE_SAVE);
    // The active line since the save is exactly those steps.
    expect(HISTORY.filter((h) => !h.branch)).toHaveLength(STEPS_SINCE_SAVE);
  });

  it('every state that states the count states the same one', () => {
    const counts: Record<string, RegExp> = {
      history: new RegExp(`${STEPS_SINCE_SAVE} steps since the ${LAST_SAVE.time} save`),
      resume: new RegExp(`Recovered ${STEPS_SINCE_SAVE} steps`),
      save: new RegExp(`${STEPS_SINCE_SAVE} steps since ${LAST_SAVE.time}`),
    };
    for (const [state, re] of Object.entries(counts)) {
      const { container, unmount } = renderWorkflow(state as 'history');
      expect(container.textContent).toMatch(re);
      unmount();
    }
  });

  it('provenance has distinct AI and interpolation codes, reviewed and not, summing to the labelled voxels', () => {
    const ids = PROVENANCE_CODES.map((c) => c.id);
    expect(ids).toEqual([
      'manual',
      'interp-reviewed',
      'interp-unreviewed',
      'ai-reviewed',
      'ai-unreviewed',
    ]);
    expect(new Set(PROVENANCE_CODES.map((c) => c.code)).size).toBe(5);
    const t = provenanceTable();
    expect(t.reduce((s, c) => s + c.vx, 0)).toBe(LABEL_VOXELS);
    expect(SAVE.provenanceCodes).toEqual(t);
    // Unreviewed slices carry voxels in the unreviewed codes.
    const un = unreviewedSlices(CA1);
    expect(t.find((c) => c.id === 'ai-unreviewed')!.vx > 0).toBe(
      un.some((u) => u.prov === 'ai-unreviewed'),
    );
    expect(t.find((c) => c.id === 'interp-unreviewed')!.vx > 0).toBe(
      un.some((u) => u.prov === 'interp-unreviewed'),
    );
  });

  it('the ruler, the matrix and the history mark the same unreviewed slices', () => {
    const un = unreviewedSlices(CA1).map((u) => u.k);
    expect(un.length).toBeGreaterThan(0);
    const { container, unmount } = renderCore('tracing');
    expect(hollowRulerKs(container).sort((a, b) => a - b)).toEqual(un);
    const hollowBars = [
      ...container.querySelectorAll('[data-matrix-row="1"] [data-bar="hollow"]'),
    ].map((e) => Number(e.closest('[data-k]')!.getAttribute('data-k')));
    expect(hollowBars.sort((a, b) => a - b)).toEqual(un);
    unmount();
    const notReviewed = HISTORY.filter((h) => !h.branch).reduce(
      (n, h) => n + (h.unreviewed ?? 0),
      0,
    );
    expect(notReviewed).toBe(un.length);
    expect(SAVE.check.warn).toContain(`${un.length} slices not reviewed`);
  });

  it('the core ruler is the session as of now (unchanged from round 5)', () => {
    const now = NATIVE_SLICES_J.map((j) => sessionSliceStatus(j));
    expect(
      now.map((s, i) => [i + 1, s]).filter(([, s]) => s !== 'traced' && s !== 'empty'),
    ).toEqual([
      [9, 'ai'],
      [12, 'interpolated'],
      [13, 'interpolated'],
    ]);
  });

  it('the licence gate shows the session before the first AI step', () => {
    expect(aiUsed(BEFORE_AI)).toBe(false);
    expect(aiUsed()).toBe(true);
    expect(NATIVE_SLICES_J.some((j) => sessionSliceStatus(j, BEFORE_AI) === 'ai')).toBe(false);
    const { container, unmount } = renderWorkflow('ai-consent');
    expect(rulerCaptions(container)).not.toContain('AI');
    expect(container.querySelector('[data-testid="slice-ruler"] [data-status="open"]')).toBeNull();
    unmount();
  });

  it('tracing after AI was used marks the AI slice', () => {
    const { container, unmount } = renderCore('tracing');
    expect(rulerCaptions(container)).toContain('AI');
    unmount();
  });

  it('says the steps since the save once, nowhere the journal total', () => {
    const { container, unmount } = renderWorkflow('history');
    const text = container.textContent!;
    expect(text.split(`${JOURNAL.sinceSave} steps`).length - 1).toBe(1);
    expect(text).not.toMatch(new RegExp(`${JOURNAL.step} steps`));
    unmount();
  });

  it('the history dock opens at most 8 rows, collapses, and shows the branch with its AI status and a guarded restore', () => {
    expect(DOCK_ROWS).toBeLessThanOrEqual(8);
    const { getByTestId, container, unmount } = renderWorkflow('history');
    expect(getByTestId('dock-collapse')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="history-list"] li')).toHaveLength(DOCK_ROWS);
    expect(container.querySelector('[data-branch="alt"]')!.textContent).toMatch(
      new RegExp(`${BRANCH.unreviewed} not reviewed`),
    );
    expect(getByTestId('branch-restore').getAttribute('title')).toMatch(/brings back/);
    expect(container.querySelectorAll('[data-signed-bar]').length).toBeGreaterThan(0);
    unmount();
  });

  it('keeps the undone branch and shows the journal', () => {
    const { container, getByTestId, unmount } = renderWorkflow('history');
    // the kept branch is one row at its branch point, holding both steps.
    expect(container.querySelector('[data-branch="alt"]')?.getAttribute('data-steps')).toBe(
      '33′ 32′',
    );
    expect(getByTestId('journal-status').textContent).toMatch(/journal written 4 s ago/);
    unmount();
  });
});

/**
 * The licence gate waits for acknowledgement and says what leaves the
 * computer; over-reach is a check, never a refusal; AI is said once; the bar
 * keeps four actions; the answer's 3D reach shows in the orthogonal views.
 */
describe('AI assist (DESIGN: AI assist, AI licence gate)', () => {
  it('the licence gate waits for the acknowledgement and says what leaves the computer', () => {
    const { getByTestId, unmount } = renderWorkflow('ai-consent');
    expect((getByTestId('consent-accept') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('licence-name').textContent).toBe('CC BY-NC-SA 4.0');
    expect(getByTestId('leaves-local').textContent).toMatch(/Nothing leaves this computer/);
    expect(getByTestId('leaves-remote').textContent).toMatch(/Leaves this computer/);
    expect(getByTestId('consent-provenance').textContent).toMatch(/weights_licence/);
    unmount();
  });

  it('flags over-reach into labels not yet complete, separately from the kept voxels', () => {
    const now = new Map([['5,5', 4]]);
    const r = overreach(
      [
        [4, 4],
        [9, 9],
      ],
      now,
      new Map(),
      1,
      new Set([4]),
      { k: 3, expected: [1, 20] },
    );
    expect(r.voxels).toEqual([[4, 4]]);
    expect(r.byLabel).toEqual([[4, 1]]);
    expect(
      overreach([[9, 9]], new Map(), new Map(), 1, new Set(), { k: 25, expected: [1, 20] })
        .outsideRange,
    ).toBe(true);
    expect(AI.overreach.voxels.length).toBeGreaterThan(0);
    const { getByTestId, unmount } = renderWorkflow('ai-prompt');
    expect(getByTestId('ai-overreach').textContent).toMatch(
      new RegExp(`check ${AI.overreach.voxels.length} vx · .*Subiculum`),
    );
    unmount();
  });

  it('says AI once: no prompt list, no channel control in the Inspector, the provider only in the bar', () => {
    const { container, getByTestId, unmount } = renderWorkflow('ai-prompt');
    expect(container.querySelectorAll('[data-prompt-row]')).toHaveLength(0);
    expect(getByTestId('ai-section').querySelector('select, [role="combobox"]')).toBeNull();
    expect(container.textContent!.split('nnInteractive').length - 1).toBe(1);
    unmount();
  });

  it('the bar is two lines: progress, then Accept and Discard left, prompt undo as an icon, Confirm all alone on the right', () => {
    const { getByTestId, container, unmount } = renderWorkflow('ai-prompt');
    const actions = getByTestId('ai-actions');
    expect(actions.querySelectorAll('button')).toHaveLength(4);
    expect(actions.lastElementChild).toBe(getByTestId('ai-confirm-all'));
    expect(getByTestId('ai-bar').textContent).not.toMatch(/prompt undo|vx kept|check \d/);
    // The counts moved: check onto the slice, kept into the key's tooltip.
    expect(getByTestId('primary-panel').contains(getByTestId('ai-overreach'))).toBe(true);
    expect(getByTestId('prompt-key').contains(getByTestId('ai-protected'))).toBe(true);
    expect(container.textContent).toContain(`Confirm all ${AI.slices.length}`);
    unmount();
  });

  it('over-reach also covers empty labels and answer slices outside the body slab', () => {
    // An empty label (no voxel now) is checked against its prior territory, widened by the margin.
    const prior = new Map([['10,10', 5]]);
    const near = overreach(
      [
        [10 + EMPTY_PRIOR_MARGIN_VX, 10],
        [10 + EMPTY_PRIOR_MARGIN_VX + 1, 10],
      ],
      new Map(),
      prior,
      1,
      new Set([5]),
      { k: 8, expected: [1, 20] },
    );
    expect(near.voxels).toEqual([[10 + EMPTY_PRIOR_MARGIN_VX, 10]]);
    expect(near.labels).toEqual([5]);
    // A label that has voxels is checked by contact only.
    expect(
      overreach([[14, 10]], new Map([['0,0', 5]]), prior, 1, new Set([5]), {
        k: 8,
        expected: [1, 20],
      }).voxels,
    ).toEqual([]);
    expect(slicesOutside([13, 9, 5, 4], [6, 14])).toEqual([4, 5]);
    expect(slicesOutside([5], null)).toEqual([]);
    expect(LABEL_VOLUMES[ERC].now).toBe(0);
    expect(AI.overreach.byLabel.map(([id]) => id)).toContain(ERC);
    expect(AI.outside.map((o) => o.k)).toEqual(slicesOutside(AI.slices, BODY_K));
    const { container, getByTestId, unmount } = renderWorkflow('ai-prompt');
    expect(getByTestId('ai-overreach').textContent).toMatch(/ERC \d+, empty/);
    const checkRows = [
      ...container.querySelectorAll('[data-testid="slice-ruler"] [data-ruler-caption="check"]'),
    ];
    expect(checkRows.length).toBe(1);
    unmount();
  });

  it('the orthogonal views hatch the answer coarser, outline the whole answer and mark its slab', () => {
    expect(ORTHO_HATCH_PITCH).toBeGreaterThan(5);
    const { getByTestId, container, unmount } = renderWorkflow('ai-prompt');
    expect(getByTestId('ai-slab-caption').textContent).toBe(
      `proposed k ${Math.min(...AI.slices)}–${Math.max(...AI.slices)}`,
    );
    const patterns = [...container.querySelectorAll('pattern')].filter((p) =>
      p.id.includes('hatch'),
    );
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    unmount();
  });
});

/**
 * 26-connected rows that cannot disagree with the mask; the range brush with
 * the > 50% rule; outline only; types, span and mm³ bars; Fazekas; T1w/T2w at
 * the primary's scale while typing; a visible axial band.
 */
describe('White-matter lesions (DESIGN: White-matter lesions on FLAIR)', () => {
  it('26-connectivity joins diagonal neighbours and nothing else', () => {
    const g = components26([
      [0, 0, 0],
      [1, 1, 1],
      [3, 3, 3],
    ]);
    expect(g.map((x) => x.length)).toEqual([2, 1]);
  });

  it('the list has one row per 3D component of the mask, volumes summing to the mask', () => {
    expect(LESION.rows).toHaveLength(components26(LESION.mask).length);
    expect(LESION.rows.reduce((s, r) => s + r.voxels, 0)).toBe(LESION.mask.length);
    const { container, unmount } = renderWorkflow('lesion');
    expect(container.querySelectorAll('[data-lesion-row]')).toHaveLength(LESION.rows.length);
    unmount();
  });

  it('a voxel counts when more than half of it is inside', () => {
    expect(PARTIAL_VOLUME_RULE).toBe(0.5);
    expect(voxelCoverage([0.5, 0.5], 3, [0, 0])).toBe(1);
    // A disc centred on a voxel's edge with a huge radius covers about half of the far voxel's square near its rim: check a straight edge instead.
    expect(voxelCoverage([0, 0.5], 0.0001, [5, 5])).toBe(0);
    const half = voxelCoverage([-100, 0.5], 100.5, [0, 0]);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('the range brush writes in-range voxels more than half inside, and nothing else', () => {
    const f = rangeFootprint(LESION_SCENE.brush, RANGE.radiusMm, (v) => flairAt(v[0], v[1]), [
      RANGE.lo,
      RANGE.hi,
    ]);
    for (const v of f.taken) {
      expect(voxelCoverage(LESION_SCENE.brush, RANGE.radiusMm, v)).toBeGreaterThan(0.5);
      const val = flairAt(v[0], v[1])!;
      expect(val >= RANGE.lo && val <= RANGE.hi).toBe(true);
    }
    for (const v of f.partial)
      expect(voxelCoverage(LESION_SCENE.brush, RANGE.radiusMm, v)).toBeLessThanOrEqual(0.5);
    for (const v of f.outOfRange) {
      const val = flairAt(v[0], v[1]);
      expect(val === null || val < RANGE.lo || val > RANGE.hi).toBe(true);
    }
    expect(f.taken.length).toBeGreaterThan(0);
    // The preview draws exactly what is written (minus voxels already WMH).
    const takenKeys = new Set(f.taken.map(key));
    for (const v of LESION_SCENE.taken) expect(takenKeys.has(key(v))).toBe(true);
  });

  it('shows the rule and the left-out voxels in the view', () => {
    const { getByTestId, container, unmount } = renderWorkflow('lesion');
    expect(getByTestId('pv-rule').textContent).toBe('> 50% inside');
    expect(getByTestId('range-readout').textContent).toBe(`range FLAIR ${RANGE.lo}–${RANGE.hi}`);
    expect(container.querySelector('[data-testid="pv-partial"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="lesion-ruler"]')).not.toBeNull();
    unmount();
  });

  it('WMH is outline only by default (no fill over the FLAIR)', () => {
    for (const state of ['lesion', 'lesion-overview'] as const) {
      const { getByTestId, unmount } = renderWorkflow(state);
      const primary = getByTestId('primary-panel');
      expect(primary.querySelector('[data-active-fill]')).toBeNull();
      expect(primary.querySelector('[data-labels] > path[fill-opacity]')).toBeNull();
      expect(primary.querySelector('[data-label-stroke]')).not.toBeNull();
      unmount();
    }
  });

  it('shows T1w and T2w beside the FLAIR while typing, and every tag at fit', () => {
    const { getByTestId, unmount } = renderWorkflow('lesion');
    expect(getByTestId('strip-t1').querySelector('image')?.getAttribute('href')).toBe(
      LESION.images.axT1.url,
    );
    expect(getByTestId('strip-t2').querySelector('image')?.getAttribute('href')).toBe(
      LESION.images.axT2.url,
    );
    unmount();
    const fit = renderWorkflow('lesion-overview');
    expect(
      fit.container.querySelectorAll('[data-testid="primary-panel"] [data-testid="lesion-tag"]'),
    ).toHaveLength(lesionsOnK(LESION.k).length);
    fit.unmount();
  });

  it('rows come from the seed, unreviewed until marked, each typed, with span and volume bars', () => {
    expect(LESION_TYPES).toEqual(['WMH', 'lacune', 'infarct', 'PVS', 'exclude']);
    const { container, getByTestId, unmount } = renderWorkflow('lesion');
    expect(getByTestId('lesion-seed').textContent).toMatch(/LST-AI/);
    const rows = [...container.querySelectorAll('[data-lesion-row]')];
    for (const r of rows) {
      expect(r.getAttribute('data-source')).toBe('seed');
      expect(LESION_TYPES).toContain(r.getAttribute('data-type'));
      expect(r.querySelector('[data-span]')).not.toBeNull();
      expect(r.querySelector('[data-mm3-bar]')).not.toBeNull();
    }
    // One scale: the largest lesion's bar is full width.
    const widths = rows.map((r) =>
      parseFloat((r.querySelector('[data-mm3-bar]') as HTMLElement).style.width),
    );
    expect(Math.max(...widths)).toBe(100);
    expect(getByTestId('lesion-open').textContent).toMatch(/Mark L1 reviewed/);
    unmount();
  });

  it('rates Fazekas periventricular and deep, 0–3, per subject', () => {
    expect(FAZEKAS_GRADES).toEqual([0, 1, 2, 3]);
    const { getByTestId, unmount } = renderWorkflow('lesion');
    const f = getByTestId('fazekas');
    expect(f.querySelector('[data-fazekas="periventricular"]')?.getAttribute('data-value')).toBe(
      String(LESION.fazekas.periventricular),
    );
    expect(f.querySelector('[data-fazekas="deep"]')).not.toBeNull();
    unmount();
  });

  it('connectivity is 26 on 1 mm isotropic grids, 18 on thick slices, and is shown', () => {
    expect(defaultConnectivity([1, 1, 1])).toBe(26);
    expect(defaultConnectivity([0.9, 0.9, 3])).toBe(18);
    expect(LESION_CONNECTIVITY).toBe(26);
    const { getByTestId, unmount } = renderWorkflow('lesion');
    expect(getByTestId('connectivity').textContent).toBe('26-connected');
    unmount();
  });

  it('while a type is set, T1w and T2w replace the cuts at the primary scale; no strip, no whole-slice tile', () => {
    const { getByTestId, container, unmount } = renderWorkflow('lesion');
    expect(getByTestId('typing-column')).not.toBeNull();
    expect(container.querySelector('[data-testid="lesion-cuts"]')).toBeNull();
    expect(container.querySelector('[data-testid="lesion-strip"]')).toBeNull();
    expect(container.querySelector('[data-testid="strip-overview"]')).toBeNull();
    // True small multiples: the tiles take the primary's scale (px per mm), not their own fit.
    const primaryScale = Number(getByTestId('strip-t1').getAttribute('data-px-per-mm'));
    expect(primaryScale).toBeGreaterThan(0);
    expect(getByTestId('strip-t2').getAttribute('data-px-per-mm')).toBe(String(primaryScale));
    unmount();
  });

  it('at fit the cuts return with a visible axial band (larger step and edge hairlines), the row closed', () => {
    expect(LESION_BAND_ALPHA).toBeGreaterThan(BAND_ALPHA);
    const { getByTestId, container, unmount } = renderWorkflow('lesion-overview');
    const cuts = getByTestId('lesion-cuts');
    const bands = cuts.querySelectorAll('[data-band]');
    expect(bands).toHaveLength(2);
    for (const b of bands) expect(b.getAttribute('fill-opacity')).toBe(String(LESION_BAND_ALPHA));
    expect(cuts.querySelectorAll('[data-band-edges]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="lesion-open"]')).toBeNull();
    unmount();
  });

  it('prints a type only when it is not the default, labels the span axis once and keeps one tag size', () => {
    const { container, unmount } = renderWorkflow('lesion');
    for (const row of container.querySelectorAll('[data-lesion-row]')) {
      const tag = row.querySelector('[data-type-tag]');
      if (row.getAttribute('data-type') === 'WMH') expect(tag).toBeNull();
      else expect(tag?.textContent).toBe(row.getAttribute('data-type'));
    }
    expect(container.querySelector('[data-testid="lesion-list"]')!.textContent).toMatch(
      /k 113 → 84/,
    );
    unmount();
    const fit = renderWorkflow('lesion-overview');
    const sizes = new Set(
      [...fit.container.querySelectorAll('[data-testid="lesion-tag"]')].map(
        (t) => /text-bf-\w+/.exec(t.className)?.[0],
      ),
    );
    expect([...sizes]).toEqual(['text-bf-xs']);
    fit.unmount();
  });

  it('Fazekas is provisional while lesions are still to review', () => {
    const { getByTestId, unmount } = renderWorkflow('lesion');
    const n = LESION.rows.filter((r) => !r.reviewed).length;
    expect(getByTestId('fazekas-provisional').textContent).toBe(
      `provisional · ${n} lesions to review`,
    );
    unmount();
  });
});

/**
 * Per-label undo keeps voxels a later step changed; a label name prints only
 * where it changes.
 */
describe('History (DESIGN: History)', () => {
  it('per-label undo reverts only voxels no later step changed', () => {
    const steps = [
      { id: 1, label: 2, voxels: new Set(['a', 'b', 'c']) },
      { id: 2, label: 1, voxels: new Set(['c', 'd']) },
    ];
    expect(undoForLabel(steps, 2)).toEqual({ stepId: 1, revert: ['a', 'b'], kept: ['c'] });
    expect(undoForLabel(steps, 1)).toEqual({ stepId: 2, revert: ['c', 'd'], kept: [] });
    expect(undoForLabel(steps, 9)).toBeNull();
    expect(PER_LABEL_UNDO.find((u) => u.label === CA23)!.kept).toBeGreaterThan(0);
  });

  it('prints a label name only where it changes from the row above', () => {
    const { container, unmount } = renderWorkflow('history');
    const cells = [...container.querySelectorAll('[data-testid="history-list"] [data-label-cell]')];
    cells.forEach((c, i) => {
      const changed =
        i === 0 ||
        cells[i - 1].getAttribute('data-label-cell') !== c.getAttribute('data-label-cell');
      expect(!!c.querySelector('[data-label-name]')).toBe(changed);
    });
    unmount();
  });
});

/**
 * Unreviewed work warns and saves as a draft; ⌘S is quiet; dseg.tsv is the
 * default table; intent 1002 in the smallest unsigned type; provenance codes
 * sum to the labelled voxels; resume restores the view and outlines the last
 * edit.
 */
describe('Save, export and resume (DESIGN: Save and export, Resume)', () => {
  it('unreviewed work warns and saves; only Mark complete is blocked', () => {
    expect(saveCheck({ unreviewed: 3, incomplete: ['CA1'] })).toMatchObject({
      save: 'allowed',
      status: 'draft',
      markComplete: 'blocked',
    });
    expect(saveCheck({ unreviewed: 0, incomplete: [] })).toEqual({
      save: 'allowed',
      status: 'complete',
      warn: null,
      markComplete: 'allowed',
    });
  });

  it('the sheet is Save as / export with one-line sections and dseg.tsv the only default table', () => {
    const { getByTestId, unmount } = renderWorkflow('save');
    expect(getByTestId('save-sheet').getAttribute('aria-label')).toBe('Save as / export…');
    for (const id of ['save-volume', 'save-tables', 'save-provenance']) {
      const d = getByTestId(id) as HTMLDetailsElement;
      expect(d.open).toBe(false);
      expect(d.querySelector('[data-summary]')!.textContent!.length).toBeGreaterThan(5);
    }
    const checked = [
      ...getByTestId('save-tables').querySelectorAll('input[type="checkbox"], [role="checkbox"]'),
    ].filter(
      (e) =>
        (e as HTMLInputElement).checked ||
        e.getAttribute('aria-checked') === 'true' ||
        e.getAttribute('data-state') === 'checked',
    );
    expect(checked).toHaveLength(1);
    expect(getByTestId('save-warning').textContent).toMatch(/draft/);
    const files = [...getByTestId('save-files').querySelectorAll('li')].map((l) => l.textContent!);
    expect(files.filter((f) => /_dseg\.nii\.gz/.test(f))).toHaveLength(1);
    expect(files.some((f) => /ses-01/.test(f) && /RaterA/.test(f))).toBe(true);
    expect(files.some((f) => /space-/.test(f))).toBe(false);
    unmount();
  });

  it('a quiet "Saved" shows in the header after ⌘S, with no sheet', () => {
    const { getByTestId, container, unmount } = renderWorkflow('contrast-aids');
    expect(getByTestId('saved-note').textContent).toMatch(/^Saved \d\d:\d\d$/);
    expect(container.querySelector('[data-sheet]')).toBeNull();
    unmount();
  });

  it('writes a NIfTI-1 label volume with intent 1002 in the smallest unsigned type', () => {
    expect(labelVolumeHeader(6)).toMatchObject({ datatype: 'uint8', intentCode: 1002 });
    expect(labelVolumeHeader(300).datatype).toBe('uint16');
    expect(() => labelVolumeHeader(70000)).toThrow();
    expect(SAVE.header.intentCode).toBe(NIFTI_INTENT_LABEL);
  });

  it('writes the label-table dialects', () => {
    const t = [{ id: 1, name: 'CA1', color: 'rgb(232 108 92)' }];
    expect(dsegTsv(t)[0].split('\t').slice(0, 2)).toEqual(['index', 'name']);
    expect(dsegTsv(t)[1]).toBe('1\tCA1\tCA1\t#e86c5c\tn/a');
    expect(itksnapTxt(t)[1]).toMatch(/^\s+1\s+232\s+108\s+92\s+1 1\s+1\s+"CA1"$/);
  });

  it('the save sheet lists the files and the provenance codes sum to the labelled voxels', () => {
    const total = SAVE.provenanceCodes.reduce((s, c) => s + c.vx, 0);
    expect(total).toBe(SAVE.labelVoxels);
    const { getByTestId, unmount } = renderWorkflow('save');
    expect(getByTestId('nifti-header').textContent).toMatch(/1002/);
    // dseg.tsv is the only default table (volume, table, sidecar, provenance volume).
    expect(getByTestId('save-files').querySelectorAll('li').length).toBe(4);
    unmount();
  });

  it('resume restores the view and outlines the last edit without colour', () => {
    const { getByTestId, container, unmount } = renderWorkflow('resume');
    expect(getByTestId('recovered-banner').textContent).toMatch(
      /Recovered \d+ steps from the journal/,
    );
    expect(getByTestId('restored-view').textContent).toMatch(/k 11/);
    expect(container.querySelector('[data-ruler-note]')?.textContent).toBe('last');
    unmount();
  });
});

/**
 * Only distinguishable colours are offered; identity and blinding;
 * registration is checked in the primary, unticked, before tracing starts.
 */
describe('Session setup (DESIGN: Session setup)', () => {
  it('offers only colours distinguishable from every label, the crosshair and the warning', () => {
    const existing = LABEL_DEFS.map((d) => ({ name: d.name, color: d.color }));
    for (const c of CANDIDATES.filter((x) => x.ok)) {
      const forms = (s: string) =>
        [s, mutedColor(s, 'inactive'), mutedColor(s, 'quiet')].map(parseRgb);
      for (const e of existing)
        forms(c.color).forEach((f, i) =>
          expect(deltaE76(f, forms(e.color)[i])).toBeGreaterThanOrEqual(MUTED_MIN_DELTA_E),
        );
    }
    for (const c of CANDIDATES.filter((x) => !x.ok)) expect(c.reason).toBeTruthy();
    expect(CANDIDATES.find((c) => c.color === NEW_LABEL_DEF.color)?.ok).toBe(true);
    const [green] = colourCandidates(['rgb(95 224 160)'], existing, [
      { name: 'crosshair', color: 'rgb(95 224 160)' },
    ]);
    expect(green.ok).toBe(false);
    expect(RESERVED_MIN_DELTA_E).toBeGreaterThan(MUTED_MIN_DELTA_E);
  });

  it('names subject, session, hemisphere and rater, blinds, and checks registration before tracing', () => {
    const { getByTestId, getByLabelText, unmount } = renderWorkflow('setup');
    for (const name of ['Subject', 'Session', 'Rater']) expect(getByLabelText(name)).not.toBeNull();
    expect(getByTestId('setup-identity').textContent).toMatch(/Hemisphere/);
    expect(getByTestId('setup-blinding')).not.toBeNull();
    expect(getByTestId('setup-identity').textContent).toMatch(/Blind: hide other raters/);
    // the check is in the primary (T2w under, T1w in the squares).
    const primary = getByTestId('primary-panel');
    expect(primary.querySelectorAll('image')).toHaveLength(2);
    expect(getByTestId('setup-registration').textContent).toMatch(/Aligned at the hippocampus/);
    expect(getByTestId('slab-locator')).not.toBeNull();
    unmount();
  });

  it('keeps "Add label" closed and shows only usable colours, the refused behind one line', () => {
    const { getByTestId, unmount } = renderWorkflow('setup');
    expect((getByTestId('setup-new-label') as HTMLDetailsElement).open).toBe(false);
    const picker = getByTestId('colour-picker');
    const hidden = getByTestId('colour-hidden') as HTMLDetailsElement;
    expect(hidden.open).toBe(false);
    const outside = [...picker.querySelectorAll('[data-candidate]')].filter(
      (e) => !hidden.contains(e),
    );
    expect(outside.every((e) => e.getAttribute('data-candidate') === 'ok')).toBe(true);
    expect(outside).toHaveLength(CANDIDATES.filter((c) => c.ok).length);
    expect(hidden.querySelector('summary')!.textContent).toMatch(
      new RegExp(`^${CANDIDATES.filter((c) => !c.ok).length} hidden`),
    );
    unmount();
  });

  it('starts unticked, names who confirms, offers "Not aligned…", and Start waits for it', () => {
    const { getByTestId, unmount } = renderWorkflow('setup');
    expect((getByTestId('registration-aligned') as HTMLInputElement).checked).toBe(false);
    expect(getByTestId('registration-confirmer').getAttribute('title')).toMatch(/Rater A/);
    expect(getByTestId('registration-not-aligned').getAttribute('title')).toMatch(
      /without the T1w aids/,
    );
    expect((getByTestId('setup-start') as HTMLButtonElement).disabled).toBe(true);
    expect(
      getByTestId('primary-panel').querySelector('[data-testid="checkerboard-t1"]'),
    ).not.toBeNull();
    expect(getByTestId('slab-locator').className).toMatch(/w-\[200px\]/);
    unmount();
  });
});
