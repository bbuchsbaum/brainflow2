import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({
  invoke: vi.fn(),
  render: vi.fn(),
  retain: vi.fn(),
  remove: vi.fn(),
  layers: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/modules/api/host', () => ({
  bridgeClient: () => ({ invoke: host.invoke }),
  formatModuleError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  captureActiveWorkspace: () => ({
    workspaceId: 'synthetic-view',
    timestamp: 1,
    isCurrent: () => true,
  }),
  isLiveDocument: () => true,
  isDocumentEditingFrozen: () => false,
  useActiveWorkspaceId: () => 'synthetic-view',
  useModuleCrosshairStyle: () => ({ color: 'rgb(0 255 0)' }),
  useSelectedLayer: () => host.layers[0],
  useLoadedVolumeLayers: () => host.layers,
  useLayerMetadata: () => ({
    voxelToWorld: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  }),
  removeModuleLayers: (...args: unknown[]) => host.remove(...args),
  retainDocument: (...args: unknown[]) => {
    host.retain(...args);
    return { workspaceId: 'synthetic-view', workspaceInstance: 'frames-owner' };
  },
  getLoadedVolumeInfo: async () => ({ volume_type: 'TimeSeries4D', dims: [5, 3, 7, 6] }),
  getLoadedNativePlane: async () => ({
    origin_mm: [0, 0, 0],
    u_mm: [1, 0, 0],
    v_mm: [0, 1, 0],
    width_px: 10,
    height_px: 10,
  }),
  SliceViewport: () => <div data-testid="registration-image" />,
}));
vi.mock('@/modules/api/rendering', () => ({
  ensureModuleVolumeResident: async () => undefined,
  renderModulePlane: (...args: unknown[]) => host.render(...args),
}));
vi.mock('@/modules/segmentation/components/SegmentViewport', () => ({ SegmentViewport: () => <div data-testid="segment-viewport" /> }));
import { SegmentationMode } from '@/modules/segmentation/components/SegmentationMode';
import { SegmentationInspector } from '@/modules/segmentation/components/SegmentationInspector';
import {
  createSegmentationSession,
  ensureSegmentationSession,
  forgetSegmentationSession,
  getSegmentationSession,
} from '@/modules/segmentation/session';
import { info, setup } from './liveFixtures';

const series = {
  id: 'layer-series',
  volumeId: 'series',
  name: 'Synthetic series',
  type: 'anatomical',
  visible: true,
  order: 0,
  volumeType: 'TimeSeries4D',
  timeSeriesInfo: { num_timepoints: 6, tr: 2, temporal_unit: 's', acquisition_time: 12 },
  currentTimepoint: 4,
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host.invoke.mockReset();
  host.render.mockReset().mockResolvedValue(undefined);
  host.retain.mockReset();
  host.layers = [series];
  forgetSegmentationSession({ workspaceId: 'synthetic-view', workspaceInstance: 'frames-owner' });
});

describe('4D sources choose one explicit frame', () => {
  it('defaults to the current time point, previews that frame and sends the chosen frame at setup', async () => {
    render(<SegmentationMode workspaceId="synthetic-view" />);
    const frame = screen.getByLabelText('Reference frame (1–6)') as HTMLInputElement;
    // Shown 1-based like the status-bar time slider (t = 4 is frame 5 of 6).
    expect(frame.value).toBe('5');
    await waitFor(() => expect(host.render).toHaveBeenCalled());
    expect(host.render.mock.calls.at(-1)?.[0]).toMatchObject({
      timepoint: 4,
      volumeIds: ['series'],
    });
    fireEvent.change(frame, { target: { value: '3' } });
    await waitFor(() => expect(host.render.mock.calls.at(-1)?.[0]).toMatchObject({ timepoint: 2 }));
    expect(screen.getByText(/frame 3 of 6/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'synthetic-01' } });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Rater'), { target: { value: 'rater-a' } });
    host.invoke.mockResolvedValueOnce({
      ...info(),
      referenceDisplayVolumeId: 'segmentation_frame_x_reference',
      snapshot: { ...info().snapshot, referenceVolumeId: 'series', referenceFrame: 2 },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create segmentation' })).not.toBeDisabled(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create segmentation' }));
    });
    expect(host.invoke).toHaveBeenCalledWith('segmentation_create_session', {
      request: expect.objectContaining({
        referenceVolumeId: 'series',
        referenceFrame: 2,
        secondaryFrame: null,
      }),
    });
    // The session opens on the native slice the preview showed (the middle
    // of three), not on the first slice.
    expect(getSegmentationSession('synthetic-view')?.snapshot.sliceIndex).toBe(1);
    expect(host.retain.mock.calls[0][1]).toMatchObject({ protectedVolumeIds: ['series'] });
    // The frozen frame the viewport will attach is protected like a source.
    expect(host.retain.mock.calls.at(-1)?.[1]).toEqual({ moduleId: 'segmentation', protectedVolumeIds: ['segmentation_frame_x_reference'] });
    // Discarding the document removes the frame's layer, which unloads it.
    forgetSegmentationSession({ workspaceId: 'synthetic-view', workspaceInstance: 'frames-owner' });
    expect(host.remove).toHaveBeenCalledWith(['segmentation_frame_x_reference']);
  });

  it('refuses an empty or out-of-range frame instead of using frame 0', async () => {
    render(<SegmentationMode workspaceId="synthetic-view" />);
    const frame = screen.getByLabelText('Reference frame (1–6)') as HTMLInputElement;
    await waitFor(() => expect(host.render).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'synthetic-01' } });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Rater'), { target: { value: 'rater-a' } });
    for (const value of ['', '0', '7', '1.5']) {
      fireEvent.change(frame, { target: { value } });
      expect(frame.value).toBe(value);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create segmentation' })).not.toBeDisabled());
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create segmentation' })); });
      // Either the field's own constraint or setup validation stops the submit.
      expect(frame).toHaveAttribute('aria-invalid', 'true');
      const alert = screen.queryByRole('alert');
      if (alert) expect(alert).toHaveTextContent('Enter a reference frame from 1 to 6.');
      else expect(frame.checkValidity()).toBe(false);
    }
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it('shows the traced frames in the Inspector', async () => {
    const owner = { workspaceId: 'synthetic-view', workspaceInstance: 'frames-owner' };
    const record = ensureSegmentationSession(
      { workspaceId: owner.workspaceId, timestamp: 1, isCurrent: () => true },
      owner,
    );
    host.invoke.mockResolvedValueOnce({
      ...info(),
      snapshot: { ...info().snapshot, ...owner, referenceVolumeId: 'series', referenceFrame: 2, secondaryFrame: 0 },
    });
    await createSegmentationSession(record, { ...setup, referenceFrame: 2 });
    render(<SegmentationInspector />);
    expect(screen.getByTestId('segmentation-frames')).toHaveTextContent(
      'reference frame 3 of 6 · secondary frame 1 (recorded in the saved header)',
    );
  });
});
