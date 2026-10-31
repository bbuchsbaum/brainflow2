/**
 * Round-2 rules (subtraction and coherence): the crosshair stays out of the
 * structure being edited (edge ticks in small tiles), dashes mean rater B
 * only, one source of truth for volumes, per-slice bars that show a missing
 * slice, review gated on flagged disagreements, and direction H's cuts (no
 * contrast strip while tracing, lean label rows, one blocked message).
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { canApprove } from '@/modules/segmentation/components/shared/geometry';
import { SliceView } from '@/modules/segmentation/components/shared/SliceView';
import { Sparkline } from '@/modules/segmentation/components/shared/Sparkline';
import { ReviewDecision } from '@/modules/segmentation/components/shared/ProposalParts';
import {
  DISAGREEMENTS,
  LABEL_VOLUMES,
  NATIVE,
  REVIEW_NAV,
  REVIEW_ROWS,
  sessionLabels,
} from '@/modules/segmentation/components/shared/mockData';
import { OVERLAYS } from '@/modules/segmentation/components/shared/scenes';
import { DirectionH } from '@/modules/segmentation/components/directions/h/DirectionH';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { DESIGN_STATES } from '@/modules/segmentation/components/shared/types';

const crosshairSegments = (c: HTMLElement) =>
  [...c.querySelectorAll('line.stroke-bf-crosshair')].map((l) => ({
    x1: Number(l.getAttribute('x1')),
    y1: Number(l.getAttribute('y1')),
    x2: Number(l.getAttribute('x2')),
    y2: Number(l.getAttribute('y2')),
  }));

describe('crosshair keeps out of the structure', () => {
  // 480 x 360 view (jsdom fallback size), 40 mm across 360 px: 9 px per mm.
  const view = (props: Partial<React.ComponentProps<typeof SliceView>>) =>
    render(<SliceView image={DESIGN.images.corT2} center={[68, 130]} fovMm={40} crosshair={[68, 130]} {...props} />);

  it('stops both lines at a clear box around the structure', () => {
    const { container } = view({ crosshairClearBox: { x0: 63, y0: 125, x1: 73, y1: 135 } });
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
    const { container } = view({ crosshairTicks: true });
    const segs = crosshairSegments(container);
    expect(segs.length).toBe(4);
    for (const g of segs) expect(Math.hypot(g.x2 - g.x1, g.y2 - g.y1)).toBeLessThanOrEqual(10);
  });

  it('is a solid hairline', () => {
    const { container } = view({});
    for (const l of container.querySelectorAll('line.stroke-bf-crosshair')) {
      expect(l.getAttribute('stroke-dasharray')).toBeNull();
      expect(Number(l.getAttribute('stroke-width'))).toBe(1);
    }
  });
});

describe('one meaning per dash: rater B only', () => {
  it.each(DESIGN_STATES)('direction H %s dashes nothing but rater B', (state) => {
    const { container, unmount } = render(<DirectionH state={state} />);
    const dashed = [...container.querySelectorAll('[stroke-dasharray]')].filter((e) => e.getAttribute('stroke-dasharray'));
    for (const e of dashed) expect(e.closest('[data-testid="rater-b-departures"], [data-rater="b"]')).not.toBeNull();
    // HTML dashed borders are gone too (ruler, proposal progress).
    expect(container.querySelector('.border-dashed')).toBeNull();
    unmount();
  });

  it('proposal outlines are thin and solid; the hatch says "proposed"', () => {
    const outline = OVERLAYS.proposal([[0, 0]]).find((o) => o.kind === 'voxels' && o.outline);
    expect(outline).toMatchObject({ width: 1 });
    expect(outline && 'dashed' in outline ? outline.dashed : undefined).toBeFalsy();
  });
});

describe('one source of truth for volumes', () => {
  it('labels complete mid-session have the volume review compares', () => {
    for (const row of REVIEW_ROWS) {
      const v = LABEL_VOLUMES[row.label];
      expect(v.final).toBe(row.volA);
      if (v.complete) expect(v.now).toBe(v.final);
    }
    const listed = sessionLabels();
    for (const l of listed) expect(l.voxels).toBe(LABEL_VOLUMES[l.id].now);
  });

  it('the label list and the review table print the same mm³ for a complete label', () => {
    const tracing = render(<DirectionH state="tracing" />);
    const dg = LABEL_VOLUMES[3];
    const mm3 = Math.round(dg.final * NATIVE.voxelMm3).toLocaleString('en-US');
    expect(tracing.container.textContent).toContain(`${dg.now.toLocaleString('en-US')} vx · ${mm3} mm³`);
    tracing.unmount();
    const review = render(<DirectionH state="review" />);
    const cells = [...review.container.querySelectorAll('td')].map((t) => t.textContent);
    expect(cells).toContain(mm3);
    review.unmount();
  });
});

describe('per-slice bars show a missing slice', () => {
  it('draws one bar per non-empty slice and a hole for an empty one', () => {
    const { container } = render(<Sparkline values={[3, 0, 4, 5]} label="area" variant="bars" />);
    expect(container.querySelectorAll('[data-bars] rect').length).toBe(3);
  });
});

describe('review gate counts flagged disagreements', () => {
  it('lists flagged regions first and gates Approve on them', () => {
    const firstUnflagged = DISAGREEMENTS.findIndex((r) => !r.flagged);
    expect(firstUnflagged).toBe(REVIEW_NAV.flagged);
    expect(DISAGREEMENTS.length).toBe(REVIEW_NAV.total);
    expect(canApprove(REVIEW_NAV.visitedIds, REVIEW_NAV.flagged)).toBe(false);
    const flaggedIds = DISAGREEMENTS.filter((r) => r.flagged).map((r) => r.id);
    expect(canApprove(flaggedIds, REVIEW_NAV.flagged)).toBe(true);
    const { getByRole, getByText } = render(<ReviewDecision />);
    expect((getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(`${REVIEW_NAV.visited} of ${REVIEW_NAV.flagged} flagged visited`)).toBeTruthy();
  });
});

describe('direction H cuts', () => {
  it('has no contrast strip while tracing; the multi-contrast layout keeps it at the primary zoom', () => {
    const t = render(<DirectionH state="tracing" />);
    expect(t.queryByTestId('contrast-strip')).toBeNull();
    t.unmount();
    const m = render(<DirectionH state="multi-contrast" />);
    // Round 4: the strip header is "Linked · k 11"; the zoom is in its tooltip and the primary header.
    expect(m.getByTestId('contrast-strip').querySelector('[title*="(4.0×)"]')).not.toBeNull();
    expect(m.getByTestId('primary-panel').textContent).toContain('4.0×');
    m.unmount();
  });

  it('label rows carry swatch, id, name, volume, status and lock; per-slice bars live in one matrix (round 3)', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    expect(container.querySelector('[aria-label^="Hide "]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Labels"] [aria-label$="click a slice to go there"]').length).toBe(0);
    expect(container.textContent).not.toContain('Lines: area per slice');
    unmount();
  });

  it('states a refused stroke once at the cursor, plus the header chip', () => {
    const { getByTestId, container, unmount } = render(<DirectionH state="blocked" />);
    expect(getByTestId('blocked-callout')).toBeTruthy();
    expect(getByTestId('status-chip').textContent).toContain('Blocked');
    expect(getByTestId('constraint-strip').getAttribute('data-blocked')).toBeNull();
    expect(container.textContent?.match(/is locked/g)?.length).toBe(1);
    expect(container.textContent).not.toContain('DG (locked)');
    unmount();
  });

  it('names the primary by native slice and hides paint tools in review', () => {
    const { getByTestId, getByLabelText, unmount } = render(<DirectionH state="review" />);
    expect(getByTestId('primary-geometry').textContent).toContain('k 11/20');
    expect(getByLabelText('Segmentation tools').querySelectorAll('button').length).toBe(1);
    unmount();
  });

  it('counts proposal progress once and keeps Confirm all subordinate', () => {
    const { getByTestId, getByRole, unmount } = render(<DirectionH state="proposal" />);
    expect(getByTestId('proposal-bar').textContent?.match(/reviewed/g)?.length).toBe(1);
    expect(getByRole('button', { name: /Confirm all/ }).textContent).toContain('…');
    unmount();
  });
});
