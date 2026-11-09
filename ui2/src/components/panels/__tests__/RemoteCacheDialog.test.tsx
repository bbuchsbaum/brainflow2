import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteCacheDialog } from '../RemoteCacheDialog';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke: invokeMock }),
}));

const GB = 1024 ** 3;
const usage = (overrides = {}) => ({
  total_bytes: 3 * GB,
  budget_bytes: 4 * GB,
  budget_from_env: false,
  folders: [
    { mount_id: 'm1', label: 'alice@cluster:/data', bytes: 2 * GB, last_used_ms: Date.now() },
    { mount_id: null, label: 'alice@old:/scratch', bytes: GB, last_used_ms: null },
  ],
  ...overrides,
});

describe('RemoteCacheDialog', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('shows usage per folder, changes the limit and clears unused downloads', async () => {
    invokeMock.mockImplementation((cmd: string, args?: { budgetBytes?: number }) => {
      if (cmd === 'remote_cache_usage') return Promise.resolve(usage());
      if (cmd === 'set_remote_cache_budget') {
        expect(args?.budgetBytes).toBe(16 * GB);
        return Promise.resolve(usage({ budget_bytes: 16 * GB }));
      }
      if (cmd === 'clear_inactive_remote_caches') {
        return Promise.resolve(usage({ total_bytes: 2 * GB, folders: [usage().folders[0]] }));
      }
      return Promise.reject(new Error(cmd));
    });

    render(<RemoteCacheDialog isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('3.0 GB of 4.0 GB used')).toBeInTheDocument();
      expect(screen.getByText('alice@cluster:/data')).toBeInTheDocument();
      expect(screen.getByText('Mounted')).toBeInTheDocument();
      expect(screen.getByText('not used yet')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: String(16 * GB) } });
    await waitFor(() => {
      expect(screen.getByText('3.0 GB of 16.0 GB used')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear unused (1.0 GB)' }));
    await waitFor(() => {
      expect(screen.queryByText('alice@old:/scratch')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear unused' })).toBeDisabled();
    });
  });

  it('cannot change a limit fixed by the environment', async () => {
    invokeMock.mockResolvedValue(usage({ budget_from_env: true }));
    render(<RemoteCacheDialog isOpen onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Set by BRAINFLOW_REMOTE_CACHE_BYTES.')).toBeInTheDocument();
      expect(screen.getByLabelText('Limit')).toBeDisabled();
    });
  });
});
