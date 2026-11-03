import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({
  epoch: 0,
  active: 'synthetic-view',
  live: true,
  frozen: false,
  invoke: vi.fn(),
}));
vi.mock('@/modules/api/host', () => ({
  bridgeClient: () => ({ invoke: host.invoke }),
  formatModuleError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  captureActiveWorkspace: () => {
    const epoch = host.epoch,
      workspaceId = host.active;
    return {
      workspaceId,
      timestamp: 1,
      isCurrent: () => epoch === host.epoch && workspaceId === host.active,
    };
  },
  isLiveDocument: () => host.live,
  isDocumentEditingFrozen: () => host.frozen,
  useActiveWorkspaceId: () => host.active,
  useLoadedVolumeLayers: () => [],
}));
import {
  createSegmentationSession,
  ensureSegmentationSession,
  forgetSegmentationSession,
  saveSegmentationLabels,
  commitSegmentationStroke,
  travelSegmentationHistory,
  type SegmentationRecord,
} from '@/modules/segmentation/session';
import { SegmentationInspector } from '@/modules/segmentation/components/SegmentationInspector';
import { document, info, setup, stroke } from './liveFixtures';

const saved = (revision: number) => ({
  sessionId: 'synthetic-session',
  revision,
  labelRevision: revision,
  labelPath: '/data/sub-synthetic01_dseg.nii.gz',
  tablePath: '/data/sub-synthetic01_dseg.tsv',
});
let record: SegmentationRecord;
beforeEach(async () => {
  host.epoch = 0;
  host.active = document.workspaceId;
  host.live = true;
  host.frozen = false;
  host.invoke.mockReset();
  forgetSegmentationSession(document);
  record = ensureSegmentationSession(
    { workspaceId: document.workspaceId, timestamp: 1, isCurrent: () => true },
    document,
  );
  host.invoke.mockResolvedValueOnce(info(1));
  await createSegmentationSession(record, setup);
  host.invoke.mockReset();
});

describe('saving live segmentation labels', () => {
  it('saves the displayed revision through the native dialog and reports the files', async () => {
    host.invoke.mockResolvedValueOnce(saved(1));
    render(<SegmentationInspector />);
    expect(screen.getByTestId('segmentation-save-state')).toHaveTextContent('unsaved');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save labels as NIfTI…' }));
    });
    expect(host.invoke).toHaveBeenCalledWith('segmentation_save_labels', {
      owner: { ...document, sessionId: 'synthetic-session', baseRevision: 1 },
    });
    expect(screen.getByTestId('segmentation-save-state')).toHaveTextContent(/^saved$/);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saved revision 1 to sub-synthetic01_dseg.nii.gz with its label table sub-synthetic01_dseg.tsv.',
    );
    expect(record.snapshot.busy).toBe(false);
  });

  it('keeps edits out while the dialog is open and treats cancel as no save', async () => {
    let finish!: (value: null) => void;
    host.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const saving = saveSegmentationLabels(document.workspaceId);
    expect(record.snapshot.busy).toBe(true);
    // A stroke, an undo and a second save are all refused while the dialog is open.
    expect(await commitSegmentationStroke(document.workspaceId, stroke)).toBeNull();
    expect(await travelSegmentationHistory(document.workspaceId)).toBeNull();
    expect(await saveSegmentationLabels(document.workspaceId)).toBeNull();
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual(['segmentation_save_labels']);
    finish(null);
    expect(await saving).toBeNull();
    expect(record.snapshot).toMatchObject({ busy: false, lastSave: null, error: null });
  });

  it('shows a later edit as changed since the last save', async () => {
    host.invoke.mockResolvedValueOnce(saved(1));
    await saveSegmentationLabels(document.workspaceId);
    act(() => {
      record.snapshot = { ...record.snapshot, info: info(2) };
    });
    render(<SegmentationInspector />);
    expect(screen.getByTestId('segmentation-save-state')).toHaveTextContent(
      'changed since the last save',
    );
  });

  it('refuses a closing workspace before IPC and leaves the document as it was', async () => {
    host.frozen = true;
    expect(await saveSegmentationLabels(document.workspaceId)).toBeNull();
    expect(host.invoke).not.toHaveBeenCalled();
    expect(record.snapshot.error).toBe(
      'Labels cannot be saved while this workspace is closing. Cancel closing to save.',
    );
    expect(record.snapshot.info?.snapshot.revision).toBe(1);
  });

  it('saves only the displayed revision, never a newer reply that was not displayed', async () => {
    // The controller accepted revision 1; the tab still shows revision 0.
    act(() => { record.snapshot = { ...record.snapshot, info: info(0) }; });
    host.invoke.mockResolvedValueOnce(info(1));
    expect(await saveSegmentationLabels(document.workspaceId)).toBeNull();
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual(['segmentation_get_session']);
    expect(record.snapshot.error).toBe('The labels changed since they were displayed. Review them and save again.');
    expect(record.snapshot.info?.snapshot.revision).toBe(1);
  });

  it('adopts the current native document when a save is refused as stale', async () => {
    host.invoke
      .mockRejectedValueOnce(new Error('Session revision conflict: expected 1, current 2'))
      .mockResolvedValueOnce(info(2));
    expect(await saveSegmentationLabels(document.workspaceId)).toBeNull();
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual([
      'segmentation_save_labels',
      'segmentation_get_session',
    ]);
    expect(record.snapshot.info?.snapshot.revision).toBe(2);
    expect(record.snapshot.error).toContain('revision conflict');
    expect(record.snapshot.lastSave).toBeNull();
  });
});
