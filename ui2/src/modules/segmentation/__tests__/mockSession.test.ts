/**
 * Facts about the mock scenes, the mock session model and the mock lesion
 * data that the design screens are drawn from (`__design__/`,
 * `shared/mockData.ts`, `shared/scenes.ts`, `shared/session.ts`). They keep
 * the mocks honest (a blocked stroke writes nothing, the AI state is a moment
 * of the session, a label at 0 vx is not drawn); they are not design rules
 * and do not carry over to real components. The rules are in
 * `designContract.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { AI, BRANCH } from '@/modules/segmentation/components/directions/h/workflow/workflowData';
import {
  boundaryEdgeSet,
  labelIndex,
  partitionEdges,
} from '@/modules/segmentation/components/shared/geometry';
import {
  CA23,
  DG,
  ERC,
  LABEL_DEFS,
  LABEL_VOLUMES,
  REVIEW_ROWS,
  SRLM,
  sessionLabels,
} from '@/modules/segmentation/components/shared/mockData';
import { SCENE } from '@/modules/segmentation/components/shared/scenes';
import { BEFORE_AI, journal } from '@/modules/segmentation/components/shared/session';

const key = (v: readonly number[]) => `${v[0]},${v[1]}`;

/** The labels locked mid-session (complete): CA2/3, DG, SRLM. */
const locked = new Set([CA23, DG, SRLM]);

/** Facts about the mock data the design screens were drawn from. They keep the mocks honest; they do not carry over to real components. */
describe('The mock scenes and session (not design rules)', () => {
  it('the blocked-stroke scene really writes nothing', () => {
    expect(SCENE.blocked.written).toBe(0);
    expect(SCENE.blocked.blocked).toBeGreaterThan(0);
    expect(SCENE.tracing.wet.length).toBeGreaterThan(0);
  });

  it('on the real mock slice, every boundary edge is drawn once', () => {
    const slice = DESIGN.labels.cor(DESIGN.primaryJ);
    const edges = partitionEdges(slice, [1]);
    const drawn = edges.flatMap((e) => e.d.split('M').filter(Boolean));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.length).toBe(boundaryEdgeSet(slice).size);
  });

  it('lists every label in the agreement table, n/a where B did not trace', () => {
    expect(REVIEW_ROWS.map((r) => r.label)).toEqual(LABEL_DEFS.map((l) => l.id));
    const erc = REVIEW_ROWS.find((r) => r.label === 5)!;
    expect(erc.dice).toBeNull();
    expect(erc.volB).toBe(0);
    for (const r of REVIEW_ROWS) if (r.volB > 0) expect(r.dice).not.toBeNull();
  });

  it('labels complete mid-session have the volume review compares', () => {
    for (const row of REVIEW_ROWS) {
      const v = LABEL_VOLUMES[row.label];
      expect(v.final).toBe(row.volA);
      if (v.complete) expect(v.now).toBe(v.final);
    }
    const listed = sessionLabels();
    for (const l of listed) expect(l.voxels).toBe(LABEL_VOLUMES[l.id].now);
  });

  it('the mocked result touches locked labels and takes none of their voxels', () => {
    const labels = labelIndex(SCENE.tracing.base);
    expect(AI.protected.some((p) => p.locked)).toBe(true);
    for (const v of AI.added) expect(locked.has(labels.get(key(v)) ?? 0)).toBe(false);
    for (const v of AI.added) expect(labels.get(key(v)) ?? 0).toBe(0);
  });

  it('the pending answer is the kept branch step: same slices, the same three looked at', () => {
    expect(AI.asOf).toBe(BEFORE_AI);
    const step = journal(0).find((s) => s.id === BRANCH.steps[0])!;
    expect([...AI.slices].sort((a, b) => a - b)).toEqual([...step.ks]);
    expect([...AI.seen].sort((a, b) => a - b)).toEqual(
      step
        .writes!.filter((w) => w.prov === 'ai-reviewed')
        .map((w) => w.k)
        .sort((a, b) => a - b),
    );
    expect(step.unreviewed).toBe(AI.slices.length - AI.seen.length);
  });

  it('a label with no voxels (ERC) is not drawn', () => {
    expect(SCENE.tracing.base.some((v) => v[2] === ERC)).toBe(false);
  });
});
