import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REGISTRATION_PREVIEW_TIMEOUT_MS,
  RegistrationPreview,
} from '@/modules/segmentation/components/RegistrationPreview';

const state = vi.hoisted(() => ({
  active: 'view-a',
  epoch: 0,
  render: vi.fn(),
  native: vi.fn(),
  resident: vi.fn(),
}));
vi.mock('@/modules/api/host', () => ({
  useActiveWorkspaceId: () => state.active,
  captureActiveWorkspace: () => {
    const epoch = state.epoch;
    return { workspaceId: state.active, isCurrent: () => epoch === state.epoch };
  },
  getLoadedVolumeInfo: async () => ({ volume_type: 'Volume3D', dims: [1, 1, 1] }),
  getLoadedNativePlane: (...args: unknown[]) => state.native(...args),
  formatModuleError: (error: unknown) => String(error),
  SliceViewport: () => <div data-testid="registration-image" />,
}));
vi.mock('@/modules/api/rendering', () => ({
  ensureModuleVolumeResident: (...args: unknown[]) => state.resident(...args),
  renderModulePlane: (...args: unknown[]) => state.render(...args),
}));
const plane = {
  origin_mm: [0, 0, 0],
  u_mm: [1, 0, 0],
  v_mm: [0, 1, 0],
  width_px: 10,
  height_px: 10,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  state.active = 'view-a';
  state.epoch = 0;
  state.native.mockReset().mockResolvedValue(plane);
  state.resident.mockReset().mockResolvedValue(undefined);
  state.render.mockReset();
});
describe('registration preview ownership', () => {
  it('retries after returning and never accepts the old pending render as reviewed', async () => {
    const first = deferred(),
      fresh = deferred();
    state.render.mockReturnValueOnce(first.promise).mockReturnValueOnce(fresh.promise);
    const onView = vi.fn();
    const props = {
      workspaceId: 'view-a',
      referenceId: 'reference',
      secondaryId: null,
      normalAxis: 2,
      onView,
    };
    const view = render(<RegistrationPreview {...props} />);
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(1));
    state.active = 'view-b';
    ++state.epoch;
    view.rerender(<RegistrationPreview {...props} />);
    await act(async () => {
      first.resolve();
    });
    expect(onView.mock.calls.some(([value]) => value !== null)).toBe(false);
    expect(screen.queryByTestId('registration-image')).not.toBeInTheDocument();
    state.active = 'view-a';
    ++state.epoch;
    view.rerender(<RegistrationPreview {...props} />);
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('registration-image')).not.toBeInTheDocument();
    await act(async () => {
      fresh.resolve();
    });
    expect(screen.getByTestId('registration-image')).toBeInTheDocument();
    // The reviewed plane comes with its native slice, which the session opens on.
    expect(onView).toHaveBeenLastCalledWith({ ...plane, dim_px: [10, 10] }, 0);
    expect(state.native).toHaveBeenCalledTimes(2);
  });

  it('asks again when a view change drops the request while the tab stays in front', async () => {
    const first = deferred(),
      fresh = deferred();
    state.render.mockReturnValueOnce(first.promise).mockReturnValueOnce(fresh.promise);
    const onView = vi.fn();
    render(
      <RegistrationPreview
        workspaceId="view-a"
        referenceId="reference"
        secondaryId={null}
        normalAxis={2}
        onView={onView}
      />,
    );
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(1));
    // Entering Segment mode, say: the lease goes stale, the tab stays in front.
    ++state.epoch;
    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    await act(async () => {
      fresh.resolve();
    });
    expect(screen.getByTestId('registration-image')).toBeInTheDocument();
  });

  it('shows a failure in place of the image, not under the dock', async () => {
    state.resident.mockRejectedValue(
      new Error('The comparison image is not attached to this workspace'),
    );
    render(
      <RegistrationPreview
        workspaceId="view-a"
        referenceId="reference"
        secondaryId={null}
        normalAxis={2}
        onView={vi.fn()}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('not attached to this workspace');
    expect(alert.className).not.toMatch(/absolute/);
    expect(screen.queryByText('Preparing the loaded reference…')).not.toBeInTheDocument();
  });

  it('says so when the reference never shows', async () => {
    vi.useFakeTimers();
    try {
      state.render.mockReturnValue(new Promise<void>(() => {}));
      render(
        <RegistrationPreview
          workspaceId="view-a"
          referenceId="reference"
          secondaryId={null}
          normalAxis={2}
          onView={vi.fn()}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REGISTRATION_PREVIEW_TIMEOUT_MS - 1);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole('alert')).toHaveTextContent('has not loaded');
      expect(screen.queryByTestId('registration-image')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
