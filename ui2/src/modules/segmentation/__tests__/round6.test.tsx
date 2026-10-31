/**
 * Round 6 (fix pass on the direction H workflow states): one session model
 * is the source of every journal count, provenance code and ruler/matrix
 * mark, and the states agree with it; AI is accepted slice by slice by
 * default with distinct reviewed and unreviewed codes, over-reach into
 * untraced labels is flagged, and nothing is marked AI before AI was used;
 * ⌘S saves silently and the sheet is "Save as / export…" that warns but
 * saves; lesions are outline only, typed, seeded, graphed and rated
 * (Fazekas); setup names the subject and rater and checks registration;
 * the island ring keeps its key wherever it is drawn.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DirectionH } from '@/modules/segmentation/components/directions/h/DirectionH';
import { DirectionHWorkflow } from '@/modules/segmentation/components/directions/h/workflow/WorkflowH';
import { DOCK_ROWS } from '@/modules/segmentation/components/directions/h/workflow/HistoryState';
import { AI, BRANCH, CANDIDATES, HISTORY, JOURNAL, LESION_CONNECTIVITY, SAVE } from '@/modules/segmentation/components/directions/h/workflow/workflowData';
import { CA1, NATIVE_SLICES_J } from '@/modules/segmentation/components/shared/mockData';
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
import { WORKFLOW_STATES } from '@/modules/segmentation/components/shared/types';
import { defaultConnectivity, FAZEKAS_GRADES, LESION_TYPES, nextUnseen, overreach, saveCheck } from '@/modules/segmentation/components/shared/workflowRules';
import { LESION, lesionsOnK } from '@/modules/segmentation/__design__/lesionData';

const rulerCaptions = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="slice-ruler"] [data-ruler-caption]')].map((e) => e.getAttribute('data-ruler-caption'));
const hollowRulerKs = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="slice-ruler"] [data-status="open"]')].map((e) => Number(/k (\d+)/.exec(e.getAttribute('title') ?? '')?.[1]));

describe('one session model', () => {
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
      const { container, unmount } = render(<DirectionHWorkflow state={state as 'history'} />);
      expect(container.textContent).toMatch(re);
      unmount();
    }
  });

  it('provenance has distinct AI and interpolation codes, reviewed and not, summing to the labelled voxels', () => {
    const ids = PROVENANCE_CODES.map((c) => c.id);
    expect(ids).toEqual(['manual', 'interp-reviewed', 'interp-unreviewed', 'ai-reviewed', 'ai-unreviewed']);
    expect(new Set(PROVENANCE_CODES.map((c) => c.code)).size).toBe(5);
    const t = provenanceTable();
    expect(t.reduce((s, c) => s + c.vx, 0)).toBe(LABEL_VOXELS);
    expect(SAVE.provenanceCodes).toEqual(t);
    // Unreviewed slices carry voxels in the unreviewed codes.
    const un = unreviewedSlices(CA1);
    expect(t.find((c) => c.id === 'ai-unreviewed')!.vx > 0).toBe(un.some((u) => u.prov === 'ai-unreviewed'));
    expect(t.find((c) => c.id === 'interp-unreviewed')!.vx > 0).toBe(un.some((u) => u.prov === 'interp-unreviewed'));
  });

  it('the ruler, the matrix and the history mark the same unreviewed slices', () => {
    const un = unreviewedSlices(CA1).map((u) => u.k);
    expect(un.length).toBeGreaterThan(0);
    const { container, unmount } = render(<DirectionH state="tracing" />);
    expect(hollowRulerKs(container).sort((a, b) => a - b)).toEqual(un);
    const hollowBars = [...container.querySelectorAll('[data-matrix-row="1"] [data-bar="hollow"]')].map((e) => Number(e.closest('[data-k]')!.getAttribute('data-k')));
    expect(hollowBars.sort((a, b) => a - b)).toEqual(un);
    unmount();
    const notReviewed = HISTORY.filter((h) => !h.branch).reduce((n, h) => n + (h.unreviewed ?? 0), 0);
    expect(notReviewed).toBe(un.length);
    expect(SAVE.check.warn).toContain(`${un.length} slices not reviewed`);
  });

  it('the core ruler is the session as of now (unchanged from round 5)', () => {
    const now = NATIVE_SLICES_J.map((j) => sessionSliceStatus(j));
    expect(now.map((s, i) => [i + 1, s]).filter(([, s]) => s !== 'traced' && s !== 'empty')).toEqual([
      [9, 'ai'],
      [12, 'interpolated'],
      [13, 'interpolated'],
    ]);
  });
});

describe('no AI marks before AI was used', () => {
  it('the licence gate shows the session before the first AI step', () => {
    expect(aiUsed(BEFORE_AI)).toBe(false);
    expect(aiUsed()).toBe(true);
    expect(NATIVE_SLICES_J.some((j) => sessionSliceStatus(j, BEFORE_AI) === 'ai')).toBe(false);
    const { container, unmount } = render(<DirectionHWorkflow state="ai-consent" />);
    expect(rulerCaptions(container)).not.toContain('AI');
    expect(container.querySelector('[data-testid="slice-ruler"] [data-status="open"]')).toBeNull();
    unmount();
  });

  it('tracing after AI was used marks the AI slice', () => {
    const { container, unmount } = render(<DirectionH state="tracing" />);
    expect(rulerCaptions(container)).toContain('AI');
    unmount();
  });
});

describe('AI: per-slice accept by default', () => {
  it('Enter accepts this slice and steps to the next unseen one', () => {
    expect(nextUnseen([11, 10, 12, 9, 13], [11, 10, 12], 11)).toBe(9);
    expect(nextUnseen([11, 10], [11, 10], 10)).toBeNull();
    expect(AI.next).toBe(nextUnseen(AI.order, AI.seen, AI.current));
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
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

  it('flags over-reach into labels not yet complete, separately from the kept voxels', () => {
    const now = new Map([['5,5', 4]]);
    const r = overreach([[4, 4], [9, 9]], now, new Map(), 1, new Set([4]), { k: 3, expected: [1, 20] });
    expect(r.voxels).toEqual([[4, 4]]);
    expect(r.byLabel).toEqual([[4, 1]]);
    expect(overreach([[9, 9]], new Map(), new Map(), 1, new Set(), { k: 25, expected: [1, 20] }).outsideRange).toBe(true);
    expect(AI.overreach.voxels.length).toBeGreaterThan(0);
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
    expect(getByTestId('ai-overreach').textContent).toMatch(new RegExp(`check ${AI.overreach.voxels.length} vx · .*Subiculum`));
    unmount();
  });

  it('says AI once: no prompt list, no channel control in the Inspector, the provider only in the bar', () => {
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="ai-prompt" />);
    expect(container.querySelectorAll('[data-prompt-row]')).toHaveLength(0);
    expect(getByTestId('ai-section').querySelector('select, [role="combobox"]')).toBeNull();
    expect(container.textContent!.split('nnInteractive').length - 1).toBe(1);
    unmount();
  });
});

describe('plain language over records', () => {
  it.each([
    ['ai-consent', 'consent-sentence', 'consent-record'],
    ['save', 'save-sentence', 'save-record'],
  ] as const)('%s states one sentence and keeps the record behind "Show record"', (state, sentence, record) => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state={state} />);
    expect(getByTestId(sentence).textContent!.length).toBeGreaterThan(40);
    const details = getByTestId(record) as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Show record');
    unmount();
  });

  it('the unselected remote server is one line with its warning', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="ai-consent" />);
    const remote = getByTestId('server-remote');
    expect(remote.getAttribute('aria-checked')).toBe('false');
    expect(remote.querySelector('input')).toBeNull();
    expect(getByTestId('leaves-remote').textContent).toMatch(/Leaves this computer/);
    unmount();
  });
});

describe('save: ⌘S silent, the sheet is Save as / export', () => {
  it('unreviewed work warns and saves; only Mark complete is blocked', () => {
    expect(saveCheck({ unreviewed: 3, incomplete: ['CA1'] })).toMatchObject({ save: 'allowed', status: 'draft', markComplete: 'blocked' });
    expect(saveCheck({ unreviewed: 0, incomplete: [] })).toEqual({ save: 'allowed', status: 'complete', warn: null, markComplete: 'allowed' });
  });

  it('the sheet is Save as / export with one-line sections and dseg.tsv the only default table', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="save" />);
    expect(getByTestId('save-sheet').getAttribute('aria-label')).toBe('Save as / export…');
    for (const id of ['save-volume', 'save-tables', 'save-provenance']) {
      const d = getByTestId(id) as HTMLDetailsElement;
      expect(d.open).toBe(false);
      expect(d.querySelector('[data-summary]')!.textContent!.length).toBeGreaterThan(5);
    }
    const checked = [...getByTestId('save-tables').querySelectorAll('input[type="checkbox"], [role="checkbox"]')].filter(
      (e) => (e as HTMLInputElement).checked || e.getAttribute('aria-checked') === 'true' || e.getAttribute('data-state') === 'checked',
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
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="contrast-aids" />);
    expect(getByTestId('saved-note').textContent).toMatch(/^Saved \d\d:\d\d$/);
    expect(container.querySelector('[data-sheet]')).toBeNull();
    unmount();
  });
});

describe('lesions', () => {
  it('WMH is outline only by default (no fill over the FLAIR)', () => {
    for (const state of ['lesion', 'lesion-overview'] as const) {
      const { getByTestId, unmount } = render(<DirectionHWorkflow state={state} />);
      const primary = getByTestId('primary-panel');
      expect(primary.querySelector('[data-active-fill]')).toBeNull();
      expect(primary.querySelector('[data-labels] > path[fill-opacity]')).toBeNull();
      expect(primary.querySelector('[data-label-stroke]')).not.toBeNull();
      unmount();
    }
  });

  it('shows T1w and T2w beside the FLAIR while typing, and every tag at fit', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="lesion" />);
    expect(getByTestId('strip-t1').querySelector('image')?.getAttribute('href')).toBe(LESION.images.axT1.url);
    expect(getByTestId('strip-t2').querySelector('image')?.getAttribute('href')).toBe(LESION.images.axT2.url);
    unmount();
    const fit = render(<DirectionHWorkflow state="lesion-overview" />);
    expect(fit.container.querySelectorAll('[data-testid="primary-panel"] [data-testid="lesion-tag"]')).toHaveLength(lesionsOnK(LESION.k).length);
    fit.unmount();
  });

  it('rows come from the seed, unreviewed until marked, each typed, with span and volume bars', () => {
    expect(LESION_TYPES).toEqual(['WMH', 'lacune', 'infarct', 'PVS', 'exclude']);
    const { container, getByTestId, unmount } = render(<DirectionHWorkflow state="lesion" />);
    expect(getByTestId('lesion-seed').textContent).toMatch(/LST-AI/);
    const rows = [...container.querySelectorAll('[data-lesion-row]')];
    for (const r of rows) {
      expect(r.getAttribute('data-source')).toBe('seed');
      expect(LESION_TYPES).toContain(r.getAttribute('data-type'));
      expect(r.querySelector('[data-span]')).not.toBeNull();
      expect(r.querySelector('[data-mm3-bar]')).not.toBeNull();
    }
    // One scale: the largest lesion's bar is full width.
    const widths = rows.map((r) => parseFloat((r.querySelector('[data-mm3-bar]') as HTMLElement).style.width));
    expect(Math.max(...widths)).toBe(100);
    expect(getByTestId('lesion-open').textContent).toMatch(/Mark L1 reviewed/);
    unmount();
  });

  it('rates Fazekas periventricular and deep, 0–3, per subject', () => {
    expect(FAZEKAS_GRADES).toEqual([0, 1, 2, 3]);
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="lesion" />);
    const f = getByTestId('fazekas');
    expect(f.querySelector('[data-fazekas="periventricular"]')?.getAttribute('data-value')).toBe(String(LESION.fazekas.periventricular));
    expect(f.querySelector('[data-fazekas="deep"]')).not.toBeNull();
    unmount();
  });

  it('connectivity is 26 on 1 mm isotropic grids, 18 on thick slices, and is shown', () => {
    expect(defaultConnectivity([1, 1, 1])).toBe(26);
    expect(defaultConnectivity([0.9, 0.9, 3])).toBe(18);
    expect(LESION_CONNECTIVITY).toBe(26);
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="lesion" />);
    expect(getByTestId('connectivity').textContent).toBe('26-connected');
    unmount();
  });
});

describe('setup', () => {
  it('names subject, session, hemisphere and rater, blinds, and checks registration before tracing', () => {
    const { getByTestId, getByLabelText, unmount } = render(<DirectionHWorkflow state="setup" />);
    for (const name of ['Subject', 'Session', 'Rater']) expect(getByLabelText(name)).not.toBeNull();
    expect(getByTestId('setup-identity').textContent).toMatch(/Hemisphere/);
    expect(getByTestId('setup-blinding')).not.toBeNull();
    expect(getByTestId('setup-identity').textContent).toMatch(/Blind: hide other raters/);
    // Round 7: the check is in the primary (T2w under, T1w in the squares).
    const primary = getByTestId('primary-panel');
    expect(primary.querySelectorAll('image')).toHaveLength(2);
    expect(getByTestId('setup-registration').textContent).toMatch(/Aligned at the hippocampus/);
    expect(getByTestId('slab-locator')).not.toBeNull();
    unmount();
  });

  it('keeps "Add label" closed and shows only usable colours, the refused behind one line', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="setup" />);
    expect((getByTestId('setup-new-label') as HTMLDetailsElement).open).toBe(false);
    const picker = getByTestId('colour-picker');
    const hidden = getByTestId('colour-hidden') as HTMLDetailsElement;
    expect(hidden.open).toBe(false);
    const outside = [...picker.querySelectorAll('[data-candidate]')].filter((e) => !hidden.contains(e));
    expect(outside.every((e) => e.getAttribute('data-candidate') === 'ok')).toBe(true);
    expect(outside).toHaveLength(CANDIDATES.filter((c) => c.ok).length);
    expect(hidden.querySelector('summary')!.textContent).toMatch(new RegExp(`^${CANDIDATES.filter((c) => !c.ok).length} hidden`));
    unmount();
  });
});

describe('island key and the dock', () => {
  it.each(WORKFLOW_STATES)('%s keys the island ring wherever it draws one', (state) => {
    const { container, unmount } = render(<DirectionHWorkflow state={state} />);
    const ring = container.querySelector('[data-testid="primary-panel"] [data-islands]');
    if (ring) expect(container.querySelector('[data-testid="island-key"]')).not.toBeNull();
    unmount();
  });

  it('the lens is a square, never the island ring', () => {
    const { getByTestId, unmount } = render(<DirectionHWorkflow state="contrast-aids" />);
    expect(getByTestId('cursor-lens').getAttribute('data-shape')).toBe('square');
    expect(getByTestId('cursor-lens').className).not.toMatch(/rounded-full/);
    unmount();
  });

  it('the history dock opens at most 8 rows, collapses, and shows the branch with its AI status and a guarded restore', () => {
    expect(DOCK_ROWS).toBeLessThanOrEqual(8);
    const { getByTestId, container, unmount } = render(<DirectionHWorkflow state="history" />);
    expect(getByTestId('dock-collapse')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="history-list"] li')).toHaveLength(DOCK_ROWS);
    expect(container.querySelector('[data-branch="alt"]')!.textContent).toMatch(new RegExp(`${BRANCH.unreviewed} not reviewed`));
    expect(getByTestId('branch-restore').getAttribute('title')).toMatch(/brings back/);
    expect(container.querySelectorAll('[data-signed-bar]').length).toBeGreaterThan(0);
    unmount();
  });
});
