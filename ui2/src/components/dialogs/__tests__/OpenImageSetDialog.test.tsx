import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenImageSetDialog } from '../OpenImageSetDialog';
import { useImageSetStore } from '@/stores/imageSetStore';
const m = vi.hoisted(() => ({ confirm: vi.fn(), close: vi.fn() }));
vi.mock('@/services/ImageSetService', () => ({
  folderName: () => 'Statistics',
  getImageSetService: () => ({ confirmPreview: m.confirm, closePreview: m.close }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useImageSetStore.setState({
    preview: {
      id: 'preview',
      folder: '/data/statistics',
      workspaceId: 'A',
      loading: false,
      opening: false,
      error: null,
      members: ['z.nii.gz', 'variance.nii.gz', 'df.nii.gz'].map((name) => ({
        name,
        path: `/data/${name}`,
      })),
    },
  });
});
describe('image-set checklist', () => {
  it('starts checked, keeps choices across filtering, and opens only selected members', () => {
    render(<OpenImageSetDialog />);
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'df.nii.gz' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter images' }), {
      target: { value: 'z.nii' },
    });
    expect(screen.getByText('2 of 3 images selected · This folder only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open image set (2)' }));
    expect(m.confirm).toHaveBeenCalledWith(
      ['/data/z.nii.gz', '/data/variance.nii.gz'],
      'Statistics',
    );
  });
  it('supports None and All and disables opening an empty selection', () => {
    render(<OpenImageSetDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Open image set (0)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: 'Open image set (3)' })).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(m.close).toHaveBeenCalled();
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
