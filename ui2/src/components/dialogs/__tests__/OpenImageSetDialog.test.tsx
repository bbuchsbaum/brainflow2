import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenImageSetDialog } from '../OpenImageSetDialog';
import { useImageSetStore } from '@/stores/imageSetStore';
import type { ImageSetPreview } from '@/types/imageSet';
const m = vi.hoisted(() => ({ confirm: vi.fn(), close: vi.fn() }));
vi.mock('@/services/ImageSetService', () => ({
  folderName: () => 'Statistics',
  getImageSetService: () => ({ confirmPreview: m.confirm, closePreview: m.close }),
}));

const preview = (names: string[], extra: Partial<ImageSetPreview> = {}): ImageSetPreview => ({
  id: 'preview',
  folder: '/data/statistics',
  workspaceId: 'A',
  loading: false,
  opening: false,
  error: null,
  members: names.map((name) => ({ name, path: `/data/${name}` })),
  ...extra,
});
const PLAIN = ['z.nii.gz', 'variance.nii.gz', 'df.nii.gz'];
const CONTRASTS = ['mod_cue_old', 'mod_probe_old', 'xold_cue_old'];
const KINDS = ['t_g', 'tfce', 'fwer'];
const CROSSED = CONTRASTS.flatMap((c) => KINDS.map((k) => `contrast-${c}_${k}.nii.gz`));

const checked = () =>
  screen
    .getAllByRole('checkbox')
    .filter((box) => (box as HTMLInputElement).checked)
    .map((box) => box.getAttribute('aria-label') ?? box.closest('label')?.textContent);
const chip = (name: string) => within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name });
const filterBox = () => screen.getByRole('textbox', { name: 'Filter images' });

beforeEach(() => {
  vi.clearAllMocks();
  useImageSetStore.setState({ preview: preview(PLAIN) });
});

describe('image-set checklist', () => {
  it('starts checked, keeps choices across filtering, and opens only selected members', () => {
    render(<OpenImageSetDialog />);
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(screen.getByRole('status')).toHaveTextContent('3 images · 3 selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'df.nii.gz' }));
    fireEvent.change(filterBox(), { target: { value: 'z.nii' } });
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3 · 2 selected, 1 not shown');
    fireEvent.click(screen.getByRole('button', { name: 'Open 2 images' }));
    expect(m.confirm).toHaveBeenCalledWith(
      ['/data/z.nii.gz', '/data/variance.nii.gz'],
      'Statistics',
    );
  });

  it('clears and selects everything when nothing is filtered, and closes on Escape', () => {
    render(<OpenImageSetDialog />);
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('button', { name: 'Open 0 images' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Open 3 images' })).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(m.close).toHaveBeenCalled();
  });

  it('acts only on the rows shown when a filter is typed', () => {
    render(<OpenImageSetDialog />);
    fireEvent.change(filterBox(), { target: { value: 'z.nii' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear shown' }));
    // The two hidden images keep their checks, and the count says so.
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3 · 2 selected, 2 not shown');
    fireEvent.change(filterBox(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.change(filterBox(), { target: { value: 'z.nii' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select shown' }));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3 · 1 selected, none hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Open 1 image' }));
    expect(m.confirm).toHaveBeenCalledWith(['/data/z.nii.gz'], 'Statistics');
  });

  it('narrows to the shown images in two actions: type, then deselect the rest', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    fireEvent.change(filterBox(), { target: { value: 'tfce' } });
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 9 · 9 selected, 6 not shown');
    fireEvent.click(screen.getByRole('button', { name: 'Deselect the 6 not shown' }));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 9 · 3 selected, none hidden');
    expect(screen.queryByRole('button', { name: /not shown/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open 3 images' }));
    expect(m.confirm).toHaveBeenCalledWith(
      CONTRASTS.map((c) => `/data/contrast-${c}_tfce.nii.gz`),
      'Statistics',
    );
  });

  it('filters with several terms and exclusions', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    fireEvent.change(filterBox(), { target: { value: 'cue -fwer' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    fireEvent.change(filterBox(), { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No images match. Change the filter or release a kind.')).toBeInTheDocument();
  });

  it('offers no kind chips when the names give no grouping', () => {
    render(<OpenImageSetDialog />);
    expect(screen.queryByRole('group', { name: 'Kind' })).not.toBeInTheDocument();
  });

  it('selects exactly one kind with a chip and names the set after it', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    expect(screen.getByText('From the file names · 3 kinds × 3 names')).toBeInTheDocument();
    fireEvent.click(chip('tfce, 3'));
    expect(chip('tfce, 3')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 9 · 3 selected, none hidden');
    expect(screen.getByRole('textbox', { name: 'Set name' })).toHaveValue('Statistics · tfce');
    fireEvent.click(screen.getByRole('button', { name: 'Open 3 images' }));
    expect(m.confirm).toHaveBeenCalledWith(
      CONTRASTS.map((c) => `/data/contrast-${c}_tfce.nii.gz`),
      'Statistics · tfce',
    );
  });

  it('adds a second kind, combines chips with the typed filter, and keeps a typed name', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    fireEvent.change(filterBox(), { target: { value: 'cue' } });
    fireEvent.click(chip('tfce, 3'));
    // The chip did not overwrite the typed text, and selected only what is shown.
    expect(filterBox()).toHaveValue('cue');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 9 · 2 selected, none hidden');
    fireEvent.change(screen.getByRole('textbox', { name: 'Set name' }), { target: { value: 'Mine' } });
    fireEvent.click(chip('fwer, 3'));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 4 of 9 · 4 selected, none hidden');
    expect(screen.getByRole('textbox', { name: 'Set name' })).toHaveValue('Mine');
  });

  it('restores the earlier selection when the last chip is released', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    fireEvent.click(screen.getByRole('checkbox', { name: CROSSED[0] }));
    fireEvent.click(chip('tfce, 3'));
    fireEvent.click(chip('tfce, 3'));
    expect(screen.getByRole('status')).toHaveTextContent('9 images · 8 selected');
    expect(screen.getByRole('checkbox', { name: CROSSED[0] })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Set name' })).toHaveValue('Statistics');
  });

  it('keeps hand edits when a second chip is pressed and when the last is released', () => {
    useImageSetStore.setState({ preview: preview(CROSSED) });
    render(<OpenImageSetDialog />);
    const tfce = CONTRASTS.map((c) => `contrast-${c}_tfce.nii.gz`);
    fireEvent.click(chip('tfce, 3'));
    fireEvent.click(screen.getByRole('checkbox', { name: tfce[0] }));
    fireEvent.click(chip('fwer, 3'));
    // The unchecked tfce image stays unchecked; fwer adds its three.
    expect(screen.getByRole('status')).toHaveTextContent('Showing 6 of 9 · 5 selected, none hidden');
    expect(screen.getByRole('checkbox', { name: tfce[0] })).not.toBeChecked();
    fireEvent.click(chip('fwer, 3'));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 9 · 2 selected, none hidden');
    fireEvent.click(chip('tfce, 3'));
    // Rows were edited by hand, so releasing the last chip does not restore all nine.
    expect(screen.getByRole('status')).toHaveTextContent('9 images · 2 selected');
  });

  it('shows the ungrouped images as their own chip', () => {
    const stems = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const names = [...stems.flatMap((s) => [`${s}_t.nii`, `${s}_tfce.nii`]), 'mask.nii'];
    useImageSetStore.setState({ preview: preview(names) });
    render(<OpenImageSetDialog />);
    fireEvent.click(chip('Ungrouped, 1'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'mask.nii' })).toBeChecked();
  });

  it('disables every selection control while the first image opens', () => {
    useImageSetStore.setState({ preview: preview(CROSSED, { opening: true }) });
    render(<OpenImageSetDialog />);
    expect(chip('tfce, 3')).toBeDisabled();
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole('button', { name: 'Opening first image…' })).toBeDisabled();
  });

  it('starts from a caller selection, with its filter text when that shows the same images', () => {
    const tfce = CROSSED.filter((name) => name.includes('tfce')).map((name) => `/data/${name}`);
    useImageSetStore.setState({
      preview: preview(CROSSED, { initialSelected: [...tfce, '/elsewhere/x.nii'], initialQuery: 'tfce' }),
    });
    render(<OpenImageSetDialog />);
    expect(filterBox()).toHaveValue('tfce');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 9 · 3 selected, none hidden');
    expect(checked()).toHaveLength(3);
  });

  it('drops a caller filter text that would not show the same images', () => {
    useImageSetStore.setState({
      preview: preview(CROSSED, { initialSelected: [`/data/${CROSSED[0]}`], initialQuery: 'tfce' }),
    });
    render(<OpenImageSetDialog />);
    expect(filterBox()).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('9 images · 1 selected');
  });

  it('shows a failed first image without discarding the checklist', () => {
    render(<OpenImageSetDialog />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'df.nii.gz' }));
    act(() =>
      useImageSetStore.setState((state) => ({
        preview: { ...state.preview!, error: 'Remote mount is disconnected' },
      })),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Remote mount is disconnected');
    expect(screen.getByRole('checkbox', { name: 'df.nii.gz' })).not.toBeChecked();
  });
});
