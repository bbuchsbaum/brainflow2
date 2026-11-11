import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SpatialFieldSetSummary } from '@/types/studio';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  resetStudioBackgroundOptions,
  studioGridEvidence,
} from '@/services/studio/studioBackground';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { StudioBackgroundControl } from '../StudioBackgroundControl';

const { getTemplateCatalog } = vi.hoisted(() => ({ getTemplateCatalog: vi.fn() }));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ getTemplateCatalog }),
}));

const T1 = 'template:MNI152NLin2009cAsym_T1w_1mm';
const entry = (id: string, name: string, template_type: string) => ({
  id,
  name,
  config: { template_type },
});

function open(supportLabel: string) {
  useSetStudioStore.getState().bootstrapStudio({
    set: {
      id: 'set',
      supportKind: 'volume',
      supportLabel,
      memberIds: [],
      memberSummaries: [],
      savedCohortIds: [],
    } as unknown as SpatialFieldSetSummary,
    features: [],
    cohorts: [],
    expressions: [],
  });
}

const select = () => screen.getByLabelText('Background') as HTMLSelectElement;
const optionLabels = () => Array.from(select().options).map((option) => option.textContent);

describe('StudioBackgroundControl', () => {
  beforeEach(() => {
    resetStudioBackgroundOptions();
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    getTemplateCatalog.mockReset();
    getTemplateCatalog.mockResolvedValue([
      entry('MNI152NLin2009cAsym_T1w_1mm', 'MNI152 T1w (1mm)', 'T1w'),
      entry('MNI152NLin2009cAsym_mask_1mm', 'MNI152 Brain Mask (1mm)', 'mask'),
      entry('MNI305_T1w_native', 'MNI305 T1w', 'T1w'),
    ]);
  });
  afterEach(cleanup);

  it('lists None, then the catalog anatomy templates by name, and starts on None without a space', async () => {
    open('Folder of maps');
    render(<StudioBackgroundControl />);
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    expect(optionLabels()).toEqual(['None', 'MNI152 T1w (1mm)', 'MNI305 T1w']);
    expect(select().value).toBe('');
    expect(screen.queryByTestId('studio-background-note')).toBeNull();
  });

  it('records the choice, and says the alignment is assumed when the set declares no space', async () => {
    open('Folder of maps');
    render(<StudioBackgroundControl />);
    await waitFor(() => expect(optionLabels()).toHaveLength(3));

    fireEvent.change(select(), { target: { value: T1 } });
    expect(useSetStudioStore.getState().studioBackground).toEqual({ setId: 'set', sourcePath: T1 });
    expect(select().value).toBe(T1);
    expect(screen.getByTestId('studio-background-note').textContent).toBe(
      'Assumed to match these images; not checked.',
    );

    fireEvent.change(select(), { target: { value: '' } });
    expect(useSetStudioStore.getState().studioBackground).toEqual({ setId: 'set', sourcePath: null });
    expect(screen.queryByTestId('studio-background-note')).toBeNull();
  });

  it('hands the choice to the coordination service rather than writing the store', async () => {
    open('Folder of maps');
    const choose = vi
      .spyOn(getStudioCoordinationService(), 'chooseBackground')
      .mockImplementation(() => undefined);
    render(<StudioBackgroundControl />);
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    fireEvent.change(select(), { target: { value: T1 } });
    expect(choose).toHaveBeenCalledWith(T1);
    expect(useSetStudioStore.getState().studioBackground).toBeNull();
    fireEvent.change(select(), { target: { value: '' } });
    expect(choose).toHaveBeenLastCalledWith(null);
    choose.mockRestore();
  });

  it("shows a declared space's template as the value, without a note, even before the catalog is read", () => {
    getTemplateCatalog.mockReturnValue(new Promise(() => undefined));
    open('MNI152NLin2009cAsym (2mm)');
    render(<StudioBackgroundControl />);
    expect(select().value).toBe('template:MNI152NLin2009cAsym_brain_1mm');
    expect(optionLabels()).toEqual(['None', 'MNI152NLin2009cAsym_brain_1mm']);
    expect(screen.queryByTestId('studio-background-note')).toBeNull();
  });

  it('marks a template that could not be opened, for that template only', async () => {
    open('Folder of maps');
    useSetStudioStore.getState().setStudioBackground(T1);
    useSetStudioStore.getState().setStudioBackgroundIssue({
      sourcePath: T1,
      message: 'This template could not be opened.',
    });
    render(<StudioBackgroundControl />);
    await waitFor(() => expect(select().getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText('This template could not be opened.')).toBeTruthy();
    fireEvent.change(select(), { target: { value: '' } });
    expect(select().getAttribute('aria-invalid')).toBeNull();
  });

  it('still offers None and the current value when the catalog cannot be read', async () => {
    getTemplateCatalog.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open('Folder of maps');
    useSetStudioStore.getState().setStudioBackground(T1);
    render(<StudioBackgroundControl />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(optionLabels()).toEqual(['None', 'MNI152NLin2009cAsym_T1w_1mm']);
    warn.mockRestore();
  });
  describe('with a template matched from the image grid', () => {
    const NLIN6 = 'template:MNI152NLin6Asym_T1w_1mm';
    const header = (dims: number[], mm: number, first: number[], code = 1) => ({
      dims,
      voxelToWorld: [mm, 0, 0, first[0], 0, mm, 0, first[1], 0, 0, mm, first[2], 0, 0, 0, 1],
      sformCode: code,
      qformCode: code,
    });
    const evidence = (h: ReturnType<typeof header>) =>
      useSetStudioStore.getState().setStudioGridEvidence(studioGridEvidence('set', 'm1', h));

    it('shows the matched template as the value, and says it was matched, not chosen', async () => {
      open('Folder of maps');
      render(<StudioBackgroundControl />);
      await waitFor(() => expect(optionLabels()).toHaveLength(3));
      expect(select().value).toBe('');

      // The member's header arrives after the control is up.
      act(() => evidence(header([91, 109, 91], 2, [-90.5, -126.5, -72.5])));
      expect(select().value).toBe(NLIN6);
      expect(optionLabels()).toContain('MNI152NLin6Asym_T1w_1mm');
      expect(screen.getByTestId('studio-background-note').textContent).toBe(
        "MNI152 grid matched from this image (91 × 109 × 91, 2 mm); the other images were not checked.",
      );
      expect(useSetStudioStore.getState().studioBackground).toBeNull();
      // Readable without hovering in a narrow column: it takes the toolbar's
      // width on a row of its own and wraps to two lines; it is not cut to
      // one line at a fixed width.
      const note = screen.getByTestId('studio-background-note');
      expect(note.className).toMatch(/\bbasis-full\b/);
      expect(note.className).toMatch(/\bline-clamp-2\b/);
      expect(note.className).not.toMatch(/\btruncate\b|max-w-\[/);
      expect(note.textContent!.length).toBeLessThanOrEqual(100);
    });

    it('choosing None after the automatic fill sticks, and the note goes', async () => {
      open('Folder of maps');
      act(() => evidence(header([91, 109, 91], 2, [-90.5, -126.5, -72.5])));
      render(<StudioBackgroundControl />);
      await waitFor(() => expect(optionLabels()).toHaveLength(4));
      expect(select().value).toBe(NLIN6);

      fireEvent.change(select(), { target: { value: '' } });
      expect(useSetStudioStore.getState().studioBackground).toEqual({ setId: 'set', sourcePath: null });
      expect(select().value).toBe('');
      expect(screen.queryByTestId('studio-background-note')).toBeNull();
      // The next member is on the lattice too: None stays.
      act(() =>
        useSetStudioStore
          .getState()
          .setStudioGridEvidence(
            studioGridEvidence('set', 'm2', header([91, 109, 91], 2, [-90, -126, -72])),
          ),
      );
      expect(select().value).toBe('');
    });

    it('only suggests a template when the header names MNI152 on an unknown grid', async () => {
      open('Folder of maps');
      act(() => evidence(header([64, 64, 36], 3, [-96, -96, -54], 4)));
      render(<StudioBackgroundControl />);
      await waitFor(() => expect(optionLabels()).toHaveLength(3));
      expect(select().value).toBe('');
      expect(screen.getByTestId('studio-background-note').textContent).toBe(
        "This image's header says MNI152 space; choose a template.",
      );
    });
  });
});
