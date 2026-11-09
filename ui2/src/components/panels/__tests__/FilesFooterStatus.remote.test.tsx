import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke: invokeMock }),
}));

import { FilesFooterStatus } from '../files/FilesFooterStatus';
import { useRemoteMountStore } from '@/stores/remoteMountStore';
import type { FileTreeNode } from '@/types/filesystem';

const root = {
  id: '/cache/r',
  name: 'data',
  path: '/cache/r',
  type: 'directory',
  depth: 0,
  children: [],
  mountSource: { kind: 'remote', mountId: 'm1', host: 'h' },
} as FileTreeNode;

describe('FilesFooterStatus remote state', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(true);
    useRemoteMountStore.setState({ statuses: {}, prefetchJobs: {} });
  });

  it('says when the server is offline', () => {
    useRemoteMountStore.getState().setStatuses([
      { mount_id: 'm1', state: 'disconnected', shared_session_mounts: 1 },
    ]);
    render(<FilesFooterStatus rootNode={root} recentsCount={0} pinnedCount={0} />);
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('shows offline-download progress with a way to stop it', () => {
    useRemoteMountStore.getState().applyPrefetchProgress({
      job_id: 'job-1',
      mount_id: 'm1',
      folder: '/cache/r/sub-01',
      state: 'downloading',
      files_done: 2,
      files_total: 5,
      bytes_done: 2048,
      bytes_total: 5120,
      current: 'b.nii',
      error: null,
      truncated: false,
    });
    render(<FilesFooterStatus rootNode={root} recentsCount={0} pinnedCount={0} />);
    expect(screen.getByText(/offline copy of sub-01: 2\/5 · 2.0 KB of 5.0 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(invokeMock).toHaveBeenCalledWith('remote_prefetch_cancel', { jobId: 'job-1' });
  });
});
