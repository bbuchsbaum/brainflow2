import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ epoch: 0, active: 'synthetic-view', live: true, frozen: false, invoke: vi.fn() }));
vi.mock('@/modules/api/host', () => ({
  bridgeClient: () => ({ invoke: host.invoke }),
  formatModuleError: (error: unknown) => String(error),
  captureActiveWorkspace: () => { const epoch = host.epoch, workspaceId = host.active; return { workspaceId, timestamp: 1, isCurrent: () => epoch === host.epoch && workspaceId === host.active }; },
  isLiveDocument: () => host.live, isDocumentEditingFrozen: () => host.frozen,
}));
import { SegmentationSessionController, createSegmentationSession, ensureSegmentationSession, setSegmentationPresentation, useSegmentationSession } from '@/modules/segmentation/session';
import { document, info, setup, stroke } from './liveFixtures';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const leaveAndReturn = () => { host.active = 'another-view'; host.epoch++; host.active = document.workspaceId; host.epoch++; };
beforeEach(() => { host.epoch = 0; host.active = document.workspaceId; host.live = true; host.frozen = false; host.invoke.mockReset(); });
describe('live native segmentation session ownership', () => {
  it('retains a late accepted create while rejecting its old navigation epoch, then reconciles on return', async () => {
    const pending = deferred<ReturnType<typeof info>>(); host.invoke.mockReturnValueOnce(pending.promise);
    const controller = new SegmentationSessionController(document);
    const result = controller.create(setup); leaveAndReturn(); pending.resolve(info());
    expect(await result).toBeNull();
    host.invoke.mockResolvedValueOnce(info(1));
    expect((await controller.refresh())?.snapshot.revision).toBe(1);
    expect(host.invoke.mock.calls[1]).toEqual(['segmentation_get_session', { access: { workspace: document, sessionId: 'synthetic-session' } }]);
  });
  it('remembers a stale accepted edit and never rolls its revision back with an older read', async () => {
    const controller = new SegmentationSessionController(document); host.invoke.mockResolvedValueOnce(info()); await controller.create(setup);
    const read = deferred<ReturnType<typeof info>>(); host.invoke.mockReturnValueOnce(read.promise); const refreshing = controller.refresh();
    host.invoke.mockResolvedValueOnce({ session: info(1), preview: null }); await controller.commit(stroke);
    read.resolve(info()); expect(await refreshing).toBeNull(); expect(controller.operation()?.baseRevision).toBe(1);
    const edit = deferred<{ session: ReturnType<typeof info>; preview: null }>(); host.invoke.mockReturnValueOnce(edit.promise); const painting = controller.commit(stroke);
    leaveAndReturn(); edit.resolve({ session: info(2), preview: null }); expect(await painting).toBeNull(); expect(controller.operation()?.baseRevision).toBe(2);
    host.invoke.mockResolvedValueOnce(info(2)); expect((await controller.refresh())?.snapshot.revision).toBe(2);
  });
  it('refuses closed and frozen documents before IPC admission', async () => {
    const controller = new SegmentationSessionController(document); host.frozen = true;
    expect(await controller.create(setup)).toBeNull(); host.frozen = false; host.live = false;
    expect(await controller.create(setup)).toBeNull(); expect(host.invoke).not.toHaveBeenCalled();
  });
  it('does not publish a preview after a later preview or revision change', async () => {
    const controller = new SegmentationSessionController(document); host.invoke.mockResolvedValueOnce(info()); await controller.create(setup);
    const old = deferred<object>(); host.invoke.mockReturnValueOnce(old.promise); const preview = controller.preview(stroke);
    host.invoke.mockResolvedValueOnce({ revision: 0, written: [[2, 1, 3]], blocked: [], blockedLabels: [] }); expect(await controller.preview(stroke)).not.toBeNull();
    old.resolve({ revision: 0, written: [[1, 1, 3]], blocked: [], blockedLabels: [] }); expect(await preview).toBeNull();
  });
  it('notifies a hook subscribed before setup and publishes immutable snapshots', async () => {
    const workspaceId = 'synthetic-reactive-view'; host.active = workspaceId;
    const owner = { ...document, workspaceId, workspaceInstance: 'reactive-owner' };
    const { result } = renderHook(() => useSegmentationSession(workspaceId)); expect(result.current).toBeNull();
    let record!: ReturnType<typeof ensureSegmentationSession>;
    act(() => { record = ensureSegmentationSession({ workspaceId, timestamp: 1, isCurrent: () => true }, owner); });
    const initial = result.current; expect(initial?.busy).toBe(false);
    host.invoke.mockResolvedValueOnce({ ...info(), snapshot: { ...info().snapshot, ...owner } });
    await act(async () => { await createSegmentationSession(record, setup); });
    expect(result.current).not.toBe(initial); expect(result.current?.info?.snapshot.sessionId).toBe('synthetic-session');
    act(() => setSegmentationPresentation(workspaceId, { activeLabelId: 2 })); expect(result.current?.activeLabelId).toBe(2); expect(initial?.activeLabelId).toBe(1);
  });
});
