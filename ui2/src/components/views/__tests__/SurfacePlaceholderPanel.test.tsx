/**
 * qa-features-2026-10-31 §9: the placeholder shows the surface name and its
 * source, loads nothing until Reload, and offers Close when the source is gone.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SurfacePlaceholderPanel } from '../SurfacePlaceholderPanel';
import type { SavedSurfaceTab } from '@/stores/surfaceTabRestoreStore';
import type { SurfaceReloadBackend } from '@/services/surfaceTabReload';

const saved: SavedSurfaceTab = {
  surfaceViewId: 'sv-1',
  title: 'fsaverage5_pial_left',
  sources: [
    {
      kind: 'template',
      path: 'templateflow://fsaverage5_pial_left',
      space: 'fsaverage5',
      geometryType: 'pial',
      hemisphere: 'left',
    },
    { kind: 'file', path: '/data/rh.pial.gii' },
  ],
};

function makeBackend(files: string[]) {
  const api: SurfaceReloadBackend = {
    listDirectory: vi.fn(async (dir: string) => {
      if (dir !== '/data') throw new Error('gone');
      return files.map((name) => ({ name, isDir: false }));
    }),
    loadSurfaceFile: vi.fn(async () => 'handle-file'),
    loadSurfaceTemplate: vi.fn(async () => 'handle-template'),
  };
  return { api, backend: async () => api };
}

describe('SurfacePlaceholderPanel', () => {
  it('shows the name and source and loads nothing until Reload', async () => {
    const { api, backend } = makeBackend(['rh.pial.gii']);
    const onClose = vi.fn();
    render(<SurfacePlaceholderPanel saved={saved} onClose={onClose} backend={backend} />);

    expect(screen.getByText('fsaverage5_pial_left')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('surface-placeholder')).toHaveAttribute('data-status', 'ready'),
    );
    expect(screen.getByText(/TemplateFlow fsaverage5 pial \(left\)/)).toBeInTheDocument();
    expect(api.loadSurfaceFile).not.toHaveBeenCalled();
    expect(api.loadSurfaceTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('surface-placeholder-reload'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.loadSurfaceTemplate).toHaveBeenCalledWith({
      space: 'fsaverage5',
      geometry_type: 'pial',
      hemisphere: 'left',
    });
    expect(api.loadSurfaceFile).toHaveBeenCalledWith('/data/rh.pial.gii');
  });

  it('says the source is gone and offers Close', async () => {
    const { api, backend } = makeBackend([]);
    const onClose = vi.fn();
    const fileOnly: SavedSurfaceTab = { ...saved, sources: [saved.sources[1]] };
    render(<SurfacePlaceholderPanel saved={fileOnly} onClose={onClose} backend={backend} />);

    await waitFor(() =>
      expect(screen.getByTestId('surface-placeholder')).toHaveAttribute('data-status', 'missing'),
    );
    expect(screen.getByText(/The source is gone: \/data\/rh\.pial\.gii/)).toBeInTheDocument();
    expect(screen.queryByTestId('surface-placeholder-reload')).toBeNull();
    fireEvent.click(screen.getByTestId('surface-placeholder-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.loadSurfaceFile).not.toHaveBeenCalled();
  });

  it('stays open and says so when nothing reloads', async () => {
    const { api, backend } = makeBackend(['rh.pial.gii']);
    (api.loadSurfaceFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.loadSurfaceTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    render(<SurfacePlaceholderPanel saved={saved} onClose={onClose} backend={backend} />);
    await waitFor(() =>
      expect(screen.getByTestId('surface-placeholder')).toHaveAttribute('data-status', 'ready'),
    );
    fireEvent.click(screen.getByTestId('surface-placeholder-reload'));
    await waitFor(() =>
      expect(screen.getByTestId('surface-placeholder')).toHaveAttribute('data-status', 'failed'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
