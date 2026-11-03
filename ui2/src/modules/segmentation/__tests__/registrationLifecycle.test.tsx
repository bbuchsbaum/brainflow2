import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationPreview } from '@/modules/segmentation/components/RegistrationPreview';

const state = vi.hoisted(() => ({ active: 'view-a', epoch: 0, render: vi.fn(), native: vi.fn(), resident: vi.fn() }));
vi.mock('@/modules/api/host', () => ({
  useActiveWorkspaceId: () => state.active,
  captureActiveWorkspace: () => { const epoch = state.epoch; return { workspaceId: state.active, isCurrent: () => epoch === state.epoch }; },
  getLoadedVolumeInfo: async () => ({ volume_type: 'Volume3D', dims: [1, 1, 1] }),
  getLoadedNativePlane: (...args: unknown[]) => state.native(...args),
  formatModuleError: (error: unknown) => String(error),
  SliceViewport: () => <div data-testid="registration-image" />,
}));
vi.mock('@/modules/api/rendering', () => ({
  ensureModuleVolumeResident: (...args: unknown[]) => state.resident(...args),
  renderModulePlane: (...args: unknown[]) => state.render(...args),
}));
const plane = { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], width_px: 10, height_px: 10 };
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  state.active = 'view-a'; state.epoch = 0;
  state.native.mockReset().mockResolvedValue(plane);
  state.resident.mockReset().mockResolvedValue(undefined);
  state.render.mockReset();
});
describe('registration preview ownership', () => {
  it('retries after returning and never accepts the old pending render as reviewed', async () => {
    const first = deferred(), fresh = deferred();
    state.render.mockReturnValueOnce(first.promise).mockReturnValueOnce(fresh.promise);
    const onView = vi.fn();
    const props = { workspaceId: 'view-a', referenceId: 'reference', secondaryId: null, normalAxis: 2, onView };
    const view = render(<RegistrationPreview {...props} />);
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(1));
    state.active = 'view-b'; ++state.epoch; view.rerender(<RegistrationPreview {...props} />);
    await act(async () => { first.resolve(); });
    expect(onView.mock.calls.some(([value]) => value !== null)).toBe(false);
    expect(screen.queryByTestId('registration-image')).not.toBeInTheDocument();
    state.active = 'view-a'; ++state.epoch; view.rerender(<RegistrationPreview {...props} />);
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('registration-image')).not.toBeInTheDocument();
    await act(async () => { fresh.resolve(); });
    expect(screen.getByTestId('registration-image')).toBeInTheDocument();
    // The reviewed plane comes with its native slice, which the session opens on.
    expect(onView).toHaveBeenLastCalledWith({ ...plane, dim_px: [10, 10] }, 0);
    expect(state.native).toHaveBeenCalledTimes(2);
  });
});
