/**
 * Round 7 (the final static pass on direction H's workflow states): lesion
 * T1w/T2w are true small multiples in place of the cuts while a type is set,
 * and the cuts' axial band is visible; the AI state is one moment of the
 * session model, its bar is trimmed, over-reach covers empty labels and
 * slices outside the body slab; setup checks registration in the primary;
 * history says one step count; View aids is one line; ERC (0 vx) is no
 * longer drawn.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DirectionHWorkflow } from '@/modules/segmentation/components/directions/h/workflow/WorkflowH';
import { ORTHO_HATCH_PITCH } from '@/modules/segmentation/components/directions/h/workflow/AiStates';
import { VIEW_AIDS_NOTE } from '@/modules/segmentation/components/directions/h/workflow/ContrastAids';
import { LESION_BAND_ALPHA } from '@/modules/segmentation/components/directions/h/workflow/LesionState';
import { AI, BODY_K, JOURNAL } from '@/modules/segmentation/components/directions/h/workflow/workflowData';
import { BAND_ALPHA } from '@/modules/segmentation/components/shared/SliceView';
import { ERC, LABEL_VOLUMES } from '@/modules/segmentation/components/shared/mockData';
import { SCENE } from '@/modules/segmentation/components/shared/scenes';
import { BEFORE_AI, BRANCH, journal } from '@/modules/segmentation/components/shared/session';
import { EMPTY_PRIOR_MARGIN_VX, overreach, slicesOutside } from '@/modules/segmentation/components/shared/workflowRules';
import { LESION } from '@/modules/segmentation/__design__/lesionData';

describe('lesion: de-crowded', () => {
  it('while a type is set, T1w and T2w replace the cuts at the primary scale; no strip, no whole-slice tile', () => {
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="lesion" />);
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
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="lesion-overview" />);
    const cuts = getByTestId('lesion-cuts');
    const bands = cuts.querySelectorAll('[data-band]');
    expect(bands).toHaveLength(2);
    for (const b of bands) expect(b.getAttribute('fill-opacity')).toBe(String(LESION_BAND_ALPHA));
    expect(cuts.querySelectorAll('[data-band-edges]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="lesion-open"]')).toBeNull();
    unmount();
  });

  it('prints a type only when it is not the default, labels the span axis once and keeps one tag size', () => {
    const { container, unmount } = render(<DirectionHWorkflow state="lesion" />);
    for (const row of container.querySelectorAll('[data-lesion-row]')) {
      const tag = row.querySelector('[data-type-tag]');
      if (row.getAttribute('data-type') === 'WMH') expect(tag).toBeNull();
      else expect(tag?.textContent).toBe(row.getAttribute('data-type'));
    }
    expect(container.querySelector('[data-testid="lesion-list"]')!.textContent).toMatch(/k 113 → 84/);
    unmount();
    const fit = render(<DirectionHWorkflow state="lesion-overview" />);
    const sizes = new Set([...fit.container.querySelectorAll('[data-testid="lesion-tag"]')].map((t) => /text-bf-\w+/.exec(t.className)?.[0]));
    expect([...sizes]).toEqual(['text-bf-xs']);
    fit.unmount();
  });

  it('Fazekas is provisional while lesions are still to review', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="lesion" />);
    const n = LESION.rows.filter((r) => !r.reviewed).length;
    expect(getByTestId('fazekas-provisional').textContent).toBe(`provisional · ${n} lesions to review`);
    unmount();
  });
});

describe('AI: one moment of the session model', () => {
  it('the pending answer is the kept branch step: same slices, the same three looked at', () => {
    expect(AI.asOf).toBe(BEFORE_AI);
    const step = journal(0).find((s) => s.id === BRANCH.steps[0])!;
    expect([...AI.slices].sort((a, b) => a - b)).toEqual([...step.ks]);
    expect([...AI.seen].sort((a, b) => a - b)).toEqual(step.writes!.filter((w) => w.prov === 'ai-reviewed').map((w) => w.k).sort((a, b) => a - b));
    expect(step.unreviewed).toBe(AI.slices.length - AI.seen.length);
  });

  it('the bar is two lines: progress, then Accept and Discard left, prompt undo as an icon, Confirm all alone on the right', () => {
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
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
    const near = overreach([[10 + EMPTY_PRIOR_MARGIN_VX, 10], [10 + EMPTY_PRIOR_MARGIN_VX + 1, 10]], new Map(), prior, 1, new Set([5]), { k: 8, expected: [1, 20] });
    expect(near.voxels).toEqual([[10 + EMPTY_PRIOR_MARGIN_VX, 10]]);
    expect(near.labels).toEqual([5]);
    // A label that has voxels is checked by contact only.
    expect(overreach([[14, 10]], new Map([['0,0', 5]]), prior, 1, new Set([5]), { k: 8, expected: [1, 20] }).voxels).toEqual([]);
    expect(slicesOutside([13, 9, 5, 4], [6, 14])).toEqual([4, 5]);
    expect(slicesOutside([5], null)).toEqual([]);
    expect(LABEL_VOLUMES[ERC].now).toBe(0);
    expect(AI.overreach.byLabel.map(([id]) => id)).toContain(ERC);
    expect(AI.outside.map((o) => o.k)).toEqual(slicesOutside(AI.slices, BODY_K));
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
    expect(getByTestId('ai-overreach').textContent).toMatch(/ERC \d+, empty/);
    const checkRows = [...container.querySelectorAll('[data-testid="slice-ruler"] [data-ruler-caption="check"]')];
    expect(checkRows.length).toBe(1);
    unmount();
  });

  it('the orthogonal views hatch the answer coarser, outline the whole answer and mark its slab', () => {
    expect(ORTHO_HATCH_PITCH).toBeGreaterThan(5);
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
    expect(getByTestId('ai-slab-caption').textContent).toBe(`proposed k ${Math.min(...AI.slices)}–${Math.max(...AI.slices)}`);
    const patterns = [...container.querySelectorAll('pattern')].filter((p) => p.id.includes('hatch'));
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    unmount();
  });
});

describe('setup: registration is checked in the primary', () => {
  it('starts unticked, names who confirms, offers "Not aligned…", and Start waits for it', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="setup" />);
    expect((getByTestId('registration-aligned') as HTMLInputElement).checked).toBe(false);
    expect(getByTestId('registration-confirmer').getAttribute('title')).toMatch(/Rater A/);
    expect(getByTestId('registration-not-aligned').getAttribute('title')).toMatch(/without the T1w aids/);
    expect((getByTestId('setup-start') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('primary-panel').querySelector('[data-testid="checkerboard-t1"]')).not.toBeNull();
    expect(getByTestId('slab-locator').className).toMatch(/w-\[200px\]/);
    unmount();
  });
});

describe('history: one step count', () => {
  it('says the steps since the save once, nowhere the journal total', () => {
    const { container, unmount } = render(<DirectionHWorkflow state="history" />);
    const text = container.textContent!;
    expect(text.split(`${JOURNAL.sinceSave} steps`).length - 1).toBe(1);
    expect(text).not.toMatch(new RegExp(`${JOURNAL.step} steps`));
    unmount();
  });

  it('prints a label name only where it changes from the row above', () => {
    const { container, unmount } = render(<DirectionHWorkflow state="history" />);
    const cells = [...container.querySelectorAll('[data-testid="history-list"] [data-label-cell]')];
    cells.forEach((c, i) => {
      const changed = i === 0 || cells[i - 1].getAttribute('data-label-cell') !== c.getAttribute('data-label-cell');
      expect(!!c.querySelector('[data-label-name]')).toBe(changed);
    });
    unmount();
  });
});

describe('contrast aids and the mock', () => {
  it('View aids is one line with the rest behind "?"; the lens switch shows on while the lens shows', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="contrast-aids" />);
    expect(getByTestId('view-aids-line').textContent).toBe('display only · never written · filters recorded');
    expect(getByTestId('view-aids-help').getAttribute('title')).toBe(VIEW_AIDS_NOTE);
    expect(getByTestId('view-aids').textContent).not.toContain('Edits map through');
    expect(getByTestId('view-aids').querySelector('[aria-label="Lens shown"]')!.getAttribute('aria-checked')).toBe('true');
    unmount();
  });

  it('a label with no voxels (ERC) is not drawn', () => {
    expect(SCENE.tracing.base.some((v) => v[2] === ERC)).toBe(false);
  });
});
