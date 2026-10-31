/**
 * Round 5 (direction H workflow states): every state renders on H's shell;
 * AI proposals never take voxels another label holds (locked labels above
 * all) and confirm names the label, with prompt undo apart from document
 * undo; a filtered view always carries its badge; the lesion list has one
 * row per 3D connected lesion; the range brush writes only in-range voxels
 * more than half inside; per-label undo keeps voxels a later step changed;
 * new label colours stay distinguishable; the label volume is NIfTI intent
 * 1002 with the right type; sheets never cover the primary; dashes still
 * mean rater B only.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DIRECTIONS } from '@/modules/segmentation/components/directions';
import { DirectionHWorkflow } from '@/modules/segmentation/components/directions/h/workflow/WorkflowH';
import { AI, CANDIDATES, LESION_SCENE, NEW_LABEL_DEF, PER_LABEL_UNDO, RANGE, SAVE } from '@/modules/segmentation/components/directions/h/workflow/workflowData';
import { deltaE76, mutedColor, MUTED_MIN_DELTA_E, parseRgb } from '@/modules/segmentation/components/shared/colour';
import { labelIndex } from '@/modules/segmentation/components/shared/geometry';
import { CA1, CA23, DG, LABEL_DEFS, SRLM } from '@/modules/segmentation/components/shared/mockData';
import { SCENE } from '@/modules/segmentation/components/shared/scenes';
import { WORKFLOW_STATES, type Voxel } from '@/modules/segmentation/components/shared/types';
import {
  colourCandidates,
  components26,
  dsegTsv,
  filterBadge,
  gateProposal,
  itksnapTxt,
  labelVolumeHeader,
  NIFTI_INTENT_LABEL,
  PARTIAL_VOLUME_RULE,
  rangeFootprint,
  RESERVED_MIN_DELTA_E,
  undoForLabel,
  voxelCoverage,
} from '@/modules/segmentation/components/shared/workflowRules';
import { DESIGN } from '@/modules/segmentation/__design__/designData';
import { LESION, flairAt } from '@/modules/segmentation/__design__/lesionData';

const key = (v: readonly number[]) => `${v[0]},${v[1]}`;

describe('workflow states render on H\'s shell', () => {
  it('direction h offers every workflow state; the round-0 directions none', () => {
    expect(DIRECTIONS.h.workflow).toBeDefined();
    for (const id of ['a', 'b', 'c'] as const) expect(DIRECTIONS[id].workflow).toBeUndefined();
  });

  it.each(WORKFLOW_STATES)('renders %s with the shell, a primary view and the mock disclosure', (state) => {
    const { container, unmount } = render(<DirectionHWorkflow state={state} />);
    expect(container.querySelector('[data-direction="h"]')?.getAttribute('data-state')).toBe(state);
    expect(container.querySelector('[data-testid="primary-panel"] svg image')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-disclosure"]')?.textContent).toMatch(/^Design mock/);
    unmount();
  });

  it.each(WORKFLOW_STATES)('%s dashes nothing (a dash is rater B, who is not on these screens)', (state) => {
    const { container, unmount } = render(<DirectionHWorkflow state={state} />);
    const dashed = [...container.querySelectorAll('[stroke-dasharray]')].filter((e) => e.getAttribute('stroke-dasharray'));
    expect(dashed).toEqual([]);
    expect(container.querySelector('.border-dashed')).toBeNull();
    unmount();
  });

  it.each(['ai-consent', 'save', 'setup'] as const)('the %s sheet replaces the side column, never the primary', (state) => {
    const { container, unmount } = render(<DirectionHWorkflow state={state} />);
    const sheet = container.querySelector('[data-sheet]');
    expect(sheet).not.toBeNull();
    expect(container.querySelector('[data-testid="primary-panel"]')).not.toBeNull();
    expect(sheet!.contains(container.querySelector('[data-testid="primary-panel"]'))).toBe(false);
    expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();
    unmount();
  });
});

describe('AI proposals never overwrite other labels', () => {
  const locked = new Set([CA23, DG, SRLM]);

  it('the gate adds empty voxels only and reports the rest', () => {
    const labels = labelIndex(SCENE.tracing.base);
    const raw: Voxel[] = [...SCENE.tracing.base.slice(0, 40).map(([c, r]) => [c, r] as const), [0, 0], [1, 0]];
    const g = gateProposal(raw, labels, CA1, locked);
    for (const v of g.added) expect(labels.get(key(v)) ?? 0).toBe(0);
    for (const p of g.protected) {
      expect(labels.get(key(p.voxel))).toBe(p.label);
      expect(p.label).not.toBe(CA1);
      expect(p.locked).toBe(locked.has(p.label));
    }
    expect(g.added.length + g.protected.length + g.already).toBe(new Set(raw.map(key)).size);
  });

  it('the mocked result touches locked labels and takes none of their voxels', () => {
    const labels = labelIndex(SCENE.tracing.base);
    expect(AI.protected.some((p) => p.locked)).toBe(true);
    for (const v of AI.added) expect(locked.has(labels.get(key(v)) ?? 0)).toBe(false);
    for (const v of AI.added) expect(labels.get(key(v)) ?? 0).toBe(0);
  });

  it('the state shows the kept voxels, confirms by label name and keeps prompt undo apart from document undo', () => {
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
    // Round 6: per-slice accept is the default (see round6.test.tsx).
    expect(getByTestId('ai-accept').textContent).toContain('Accept CA1 here');
    expect(getByTestId('prompt-undo').getAttribute('title')).toMatch(/document undo \(⌘Z\) is separate/);
    // Round 7: the kept count moved into the key's tooltip.
    expect(getByTestId('ai-protected').getAttribute('title')).toContain(`${AI.protected.length} vx kept`);
    expect(getByTestId('ai-provider').textContent).toMatch(/nnInteractive v2\.5\.0 · local · 0\.84 s/);
    expect(container.querySelectorAll('[data-testid="prompt-rail"] button')).toHaveLength(5);
    // Prompts on this slice are drawn by form; the k 9 prompt is only listed.
    expect(container.querySelectorAll('[data-prompt]')).toHaveLength(AI.prompts.filter((p) => p.k === AI.prompts[0].k).length);
    // Round 6: the Inspector counts the prompts instead of listing them again.
    expect(getByTestId('prompt-count').textContent).toBe(`${AI.prompts.length} prompts`);
    unmount();
  });

  it('the licence gate waits for the acknowledgement and says what leaves the computer', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="ai-consent" />);
    expect((getByTestId('consent-accept') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('licence-name').textContent).toBe('CC BY-NC-SA 4.0');
    expect(getByTestId('leaves-local').textContent).toMatch(/Nothing leaves this computer/);
    expect(getByTestId('leaves-remote').textContent).toMatch(/Leaves this computer/);
    expect(getByTestId('consent-provenance').textContent).toMatch(/weights_licence/);
    unmount();
  });
});

describe('view-only filters always carry their badge', () => {
  it('derives the badge from the image', () => {
    expect(filterBadge(DESIGN.images.corT2u)).toBe('unsharp · view only');
    expect(filterBadge(DESIGN.images.corT2)).toBeNull();
  });

  it.each(WORKFLOW_STATES)('%s: a badge exactly when the primary shows a filtered image', (state) => {
    const { container, unmount } = render(<DirectionHWorkflow state={state} />);
    const href = container.querySelector('[data-testid="primary-panel"] svg image')?.getAttribute('href');
    const filtered = href === DESIGN.images.corT2u.url;
    expect(!!container.querySelector('[data-testid="filter-badge"]')).toBe(filtered);
    unmount();
  });

  it('the lens shows T1w and the filter stays out of the label strokes', () => {
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="contrast-aids" />);
    expect(getByTestId('cursor-lens').querySelector('svg image')?.getAttribute('href')).toBe(DESIGN.images.corT1.url);
    expect(getByTestId('filter-recipe').textContent).toMatch(/unsharp mask σ 1\.5 mm/);
    expect(container.querySelector('[data-testid="flicker-keys"]')).not.toBeNull();
    unmount();
  });
});

describe('lesions: one row per connected lesion, the partial-volume rule', () => {
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
    const { container, unmount } = render(<DirectionHWorkflow state="lesion" />);
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
    const f = rangeFootprint(LESION_SCENE.brush, RANGE.radiusMm, (v) => flairAt(v[0], v[1]), [RANGE.lo, RANGE.hi]);
    for (const v of f.taken) {
      expect(voxelCoverage(LESION_SCENE.brush, RANGE.radiusMm, v)).toBeGreaterThan(0.5);
      const val = flairAt(v[0], v[1])!;
      expect(val >= RANGE.lo && val <= RANGE.hi).toBe(true);
    }
    for (const v of f.partial) expect(voxelCoverage(LESION_SCENE.brush, RANGE.radiusMm, v)).toBeLessThanOrEqual(0.5);
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
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="lesion" />);
    expect(getByTestId('pv-rule').textContent).toBe('> 50% inside');
    expect(getByTestId('range-readout').textContent).toBe(`range FLAIR ${RANGE.lo}–${RANGE.hi}`);
    expect(container.querySelector('[data-testid="pv-partial"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="lesion-ruler"]')).not.toBeNull();
    unmount();
  });
});

describe('history: per-label undo, branches, journal', () => {
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

  it('keeps the undone branch and shows the journal', () => {
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="history" />);
    // Round 6: the kept branch is one row at its branch point, holding both steps.
    expect(container.querySelector('[data-branch="alt"]')?.getAttribute('data-steps')).toBe('33′ 32′');
    expect(getByTestId('journal-status').textContent).toMatch(/journal written 4 s ago/);
    unmount();
  });
});

describe('label colours and files', () => {
  it('offers only colours distinguishable from every label, the crosshair and the warning', () => {
    const existing = LABEL_DEFS.map((d) => ({ name: d.name, color: d.color }));
    for (const c of CANDIDATES.filter((x) => x.ok)) {
      const forms = (s: string) => [s, mutedColor(s, 'inactive'), mutedColor(s, 'quiet')].map(parseRgb);
      for (const e of existing) forms(c.color).forEach((f, i) => expect(deltaE76(f, forms(e.color)[i])).toBeGreaterThanOrEqual(MUTED_MIN_DELTA_E));
    }
    for (const c of CANDIDATES.filter((x) => !x.ok)) expect(c.reason).toBeTruthy();
    expect(CANDIDATES.find((c) => c.color === NEW_LABEL_DEF.color)?.ok).toBe(true);
    const [green] = colourCandidates(['rgb(95 224 160)'], existing, [{ name: 'crosshair', color: 'rgb(95 224 160)' }]);
    expect(green.ok).toBe(false);
    expect(RESERVED_MIN_DELTA_E).toBeGreaterThan(MUTED_MIN_DELTA_E);
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
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="save" />);
    expect(getByTestId('nifti-header').textContent).toMatch(/1002/);
    // Round 6: dseg.tsv is the only default table (volume, table, sidecar, provenance volume).
    expect(getByTestId('save-files').querySelectorAll('li').length).toBe(4);
    unmount();
  });

  it('resume restores the view and outlines the last edit without colour', () => {
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="resume" />);
    expect(getByTestId('recovered-banner').textContent).toMatch(/Recovered \d+ steps from the journal/);
    expect(getByTestId('restored-view').textContent).toMatch(/k 11/);
    expect(container.querySelector('[data-ruler-note]')?.textContent).toBe('last');
    unmount();
  });
});
