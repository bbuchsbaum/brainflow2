import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewportTool } from '@/modules/api/host';
import type { ViewPlane, SliceViewportPlacement } from '@/modules/api/rendering';
import { SegmentViewport } from '@/modules/segmentation/components/SegmentViewport';
import { document, info } from '@/modules/segmentation/__tests__/liveFixtures';
const state = vi.hoisted(() => ({ front: 'synthetic-view', residency: 'reference:1', hasImage: true, unlock: vi.fn(), live: true, ensureImage: vi.fn(), removeLayers: vi.fn(), session: null as unknown, pointer: null as unknown, render: vi.fn(), slice: vi.fn(), preview: vi.fn(), commit: vi.fn(), view: { layers: [], crosshair: { world_mm: [10, -18, 6], visible: true } } }));
vi.mock('@/modules/api/host', () => ({
  useActiveWorkspaceId: () => state.front,
  useVolumeResidencyKey: () => state.residency,
  captureActiveWorkspace: () => ({ workspaceId: 'synthetic-view', isCurrent: () => true }),
  isLiveDocument: () => state.live, isDocumentEditingFrozen: () => false,
  removeModuleLayers: (...args: unknown[]) => state.removeLayers(...args),
  useModuleCrosshairStyle: () => ({}), formatModuleError: String, useLoadedVolumeLayers: () => [],
  getModuleViewportTool: () => state.pointer,
  SliceViewport: ({ viewPlane, onWheel, onPlacementChange }: { viewPlane: ViewPlane; onWheel: React.WheelEventHandler<HTMLDivElement>; onPlacementChange(placement: SliceViewportPlacement): void }) => {
    useEffect(() => { onPlacementChange({ x: 0, y: 0, width: 512, height: 512, imageWidth: 512, imageHeight: 512 }); }, [viewPlane]); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="tracing-image" data-plane={JSON.stringify(viewPlane)} onWheel={onWheel} />;
  },
}));
vi.mock('@/modules/api/rendering', () => ({
  useWorkspaceRenderState: () => state.view, useHasRenderedImage: () => state.hasImage, ensureModuleLabelLayer: async () => {},
  ensureModuleImageLayer: (...args: unknown[]) => state.ensureImage(...args),
  renderModulePlane: (...args: unknown[]) => state.render(...args),
  resizeZoomedPlane: (plane: ViewPlane) => plane,
  zoomPanPlane: ({ plane }: { plane: ViewPlane }) => ({ ...plane, origin_mm: [11, -18, 5] }),
  setModuleCrosshair: vi.fn(),
}));
vi.mock('@/modules/segmentation/session', () => ({
  useSegmentationSession: () => state.session,
  getSegmentationSession: () => ({ controller: { slice: state.slice, preview: state.preview, cancelPreview: vi.fn() } }),
  reconcileSegmentationSession: async () => {}, setSegmentationPresentation: vi.fn(),
  commitSegmentationStroke: (...args: unknown[]) => state.commit(...args),
  segmentationSaveState: () => 'unsaved', segmentationFrames: () => '', segmentationFrameCounts: () => ({}),
  setSegmentationLabelState: (...args: unknown[]) => state.unlock(...args),
}));
vi.mock('@/modules/segmentation/toolBindings', () => ({ bindSegmentationViewport: (_id: string, pointer: ViewportTool) => { state.pointer = pointer; return () => pointer.cancel('unmount'); } }));
vi.mock('@/modules/segmentation/components/ContextViews', () => ({ ContextViews: () => null }));
const plane = { origin_mm: [10, -18, 5], u_mm: [.4, 0, 0], v_mm: [0, 0, .4], width_px: 512, height_px: 512 };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  state.session = { document, info: info(), activeLabelId: 1, hiddenLabelIds: [], sliceIndex: 1, tool: 'brush', radiusMm: .4, paintOver: 'unlocked', fill: false, busy: false, error: null };
  state.slice.mockReset().mockResolvedValue({ revision: 0, plane, labels: [], previousLabels: [], nextLabels: [] });
  state.live = true; state.ensureImage.mockReset().mockResolvedValue(undefined); state.removeLayers.mockReset().mockResolvedValue(undefined);
  state.preview.mockReset().mockResolvedValue(null); state.commit.mockReset(); state.render.mockReset().mockResolvedValue(undefined);
  state.unlock.mockReset().mockResolvedValue(null);
  state.front = document.workspaceId; state.residency = 'reference:1'; state.hasImage = true;
});
describe('tracing frame ownership', () => {
  it('cancels a held stroke and keeps the old frame up, inert, until the zoomed frame completes', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    state.render.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending);
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    const before = screen.getByTestId('tracing-image').getAttribute('data-plane');
    const pointer = state.pointer as ViewportTool;
    const samples = [{ world: [10.8, -18, 6.2], pressure: .5 }] as Parameters<ViewportTool['pointerDown']>[0];
    act(() => { pointer.pointerDown(samples); });
    fireEvent.wheel(screen.getByTestId('tracing-image'), { deltaY: -20, altKey: true });
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    // The last drawn frame stays on screen (no "Preparing" flash), still at its own plane ...
    expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', before!);
    // ... but nothing can be traced on it: the held stroke was cancelled and a new one is refused.
    act(() => { pointer.pointerMove(samples); pointer.pointerUp(samples); });
    act(() => { pointer.pointerDown(samples); pointer.pointerUp(samples); });
    expect(state.commit).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', expect.stringContaining('11'));
    act(() => { pointer.pointerUp(samples); });
    expect(state.commit).not.toHaveBeenCalled();
  });
  it('steps one slice per wheel notch even when several notches land before a render', async () => {
    const { setSegmentationPresentation } = await import('@/modules/segmentation/session');
    const patch = vi.mocked(setSegmentationPresentation); patch.mockClear();
    const base = info(); // 12 native slices, so the steps are not clamped
    state.session = { ...(state.session as object), info: { ...base, snapshot: { ...base.snapshot, dimensions: [5, 12, 7] } } };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    const image = await screen.findByTestId('tracing-image');
    for (let i = 0; i < 3; i++) fireEvent.wheel(image, { deltaY: 100 });
    expect(patch.mock.calls.map(([, value]) => value)).toEqual([{ sliceIndex: 2 }, { sliceIndex: 3 }, { sliceIndex: 4 }]);
  });
  it('adds up small trackpad deltas into slices', async () => {
    const { setSegmentationPresentation } = await import('@/modules/segmentation/session');
    const patch = vi.mocked(setSegmentationPresentation); patch.mockClear();
    const base = info(); // 12 native slices, so the steps are not clamped
    state.session = { ...(state.session as object), info: { ...base, snapshot: { ...base.snapshot, dimensions: [5, 12, 7] } } };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    const image = await screen.findByTestId('tracing-image');
    // 10 × 6 px = 60 px = two slices; the 4 px after them do nothing yet.
    for (let i = 0; i < 10; i++) fireEvent.wheel(image, { deltaY: 6 });
    fireEvent.wheel(image, { deltaY: 4 });
    expect(patch.mock.calls.map(([, value]) => value)).toEqual([{ sliceIndex: 2 }, { sliceIndex: 3 }]);
  });
  it('ignores zoom while a step is pending, so one slice is never drawn under another one\'s labels', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    let finishSlice!: (value: unknown) => void;
    state.slice.mockReturnValueOnce(new Promise((resolve) => { finishSlice = resolve; }));
    state.session = { ...(state.session as object), sliceIndex: 2 };
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.slice).toHaveBeenLastCalledWith(2, expect.anything()));
    fireEvent.wheel(screen.getByTestId('tracing-image'), { deltaY: -20, altKey: true });
    await act(async () => { finishSlice({ revision: 0, plane: { ...plane, origin_mm: [10, -17.6, 5] }, labels: [], previousLabels: [], nextLabels: [] }); });
    await waitFor(() => expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', expect.stringContaining('-17.6')));
    // The zoom mock moves the origin to x = 11; it must not have been applied.
    expect(state.render.mock.calls.some(([options]) => (options as { plane: { origin_mm: number[] } }).plane.origin_mm[0] === 11)).toBe(false);
  });
  it('fetches only the latest slice once the one in flight returns', async () => {
    const base = info();
    state.session = { ...(state.session as object), info: { ...base, snapshot: { ...base.snapshot, dimensions: [5, 12, 7] } } };
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    let finishSlice!: (value: unknown) => void;
    state.slice.mockReturnValueOnce(new Promise((resolve) => { finishSlice = resolve; }));
    const before = state.slice.mock.calls.length;
    for (const sliceIndex of [2, 3, 4, 5]) {
      state.session = { ...(state.session as object), sliceIndex };
      view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    }
    await waitFor(() => expect(state.slice.mock.calls.length).toBe(before + 1));
    await act(async () => { finishSlice({ revision: 0, plane, labels: [], previousLabels: [], nextLabels: [] }); });
    await waitFor(() => expect(state.slice.mock.calls.length).toBe(before + 2));
    expect(state.slice.mock.calls.slice(before).map(([index]) => index)).toEqual([2, 5]);
  });
  it('does not show an error from a render that a newer one has replaced', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    let fail!: (error: Error) => void;
    state.render.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    state.slice.mockResolvedValueOnce({ revision: 0, plane: { ...plane, origin_mm: [10, -17.6, 5] }, labels: [], previousLabels: [], nextLabels: [] });
    state.session = { ...(state.session as object), sliceIndex: 2 };
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    const renders = state.render.mock.calls.length;
    await waitFor(() => expect(state.render.mock.calls.length).toBeGreaterThanOrEqual(renders));
    // A newer plane is requested while that render is still out ...
    state.slice.mockResolvedValueOnce({ revision: 0, plane: { ...plane, origin_mm: [10, -17.2, 5] }, labels: [], previousLabels: [], nextLabels: [] });
    state.session = { ...(state.session as object), sliceIndex: 0 };
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.slice).toHaveBeenLastCalledWith(0, expect.anything()));
    // ... then the old one fails: no alert, and the newer frame is drawn.
    await act(async () => { fail(new Error('The comparison image is not attached to this workspace')); });
    await waitFor(() => expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', expect.stringContaining('-17.2')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps the view up while stepping slices and traces only once the new slice is drawn', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    let finishSlice!: (value: unknown) => void;
    state.slice.mockReturnValueOnce(new Promise((resolve) => { finishSlice = resolve; }));
    state.session = { ...(state.session as object), sliceIndex: 2 };
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.slice).toHaveBeenLastCalledWith(2, expect.anything()));
    // No placeholder while the next slice loads, and no tracing on the old one.
    expect(screen.getByTestId('tracing-image')).toBeInTheDocument();
    expect(screen.queryByText('Preparing the reference plane…')).not.toBeInTheDocument();
    const pointer = state.pointer as ViewportTool;
    const samples = [{ world: [10.8, -18, 6.2], pressure: .5 }] as Parameters<ViewportTool['pointerDown']>[0];
    act(() => { pointer.pointerDown(samples); pointer.pointerMove(samples); pointer.pointerUp(samples); });
    expect(state.commit).not.toHaveBeenCalled();
    const renders = state.render.mock.calls.length;
    await act(async () => { finishSlice({ revision: 0, plane: { ...plane, origin_mm: [10, -17.6, 5] }, labels: [], previousLabels: [], nextLabels: [] }); });
    await waitFor(() => expect(state.render.mock.calls.length).toBeGreaterThan(renders));
    await waitFor(() => expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', expect.stringContaining('-17.6')));
    act(() => { pointer.pointerDown(samples); pointer.pointerMove(samples); pointer.pointerUp(samples); });
    expect(state.commit).toHaveBeenCalledWith(document.workspaceId, expect.objectContaining({ sliceIndex: 2 }));
  });
  it('removes a frozen frame layer whose add finished after the document was discarded', async () => {
    const base = info();
    state.session = { ...(state.session as object), info: { ...base, referenceDisplayVolumeId: 'segmentation_frame_s_reference', snapshot: { ...base.snapshot, referenceFrame: 2 } } };
    let finish!: () => void;
    state.ensureImage.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.ensureImage).toHaveBeenCalledWith(expect.objectContaining({ volumeId: 'segmentation_frame_s_reference', displayLike: 'synthetic-reference' })));
    // Discard completes (and takes its layer list) while the add is pending.
    state.live = false;
    await act(async () => { finish(); });
    expect(state.removeLayers).toHaveBeenCalledWith(['segmentation_frame_s_reference']);
  });

  it('keeps the frame layer while its document is live', async () => {
    const base = info();
    state.session = { ...(state.session as object), info: { ...base, referenceDisplayVolumeId: 'segmentation_frame_s_reference', snapshot: { ...base.snapshot, referenceFrame: 2 } } };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.ensureImage).toHaveBeenCalled());
    await screen.findByTestId('tracing-image');
    expect(state.removeLayers).not.toHaveBeenCalled();
  });
});

describe('native view across tab switches and re-uploads (QA r0 N34)', () => {
  it('does not show the native view on an empty canvas when its tab comes back', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    // Another tab (the Set studio) comes to the front: the viewport unmounts,
    // which drops its image from the render store.
    state.front = 'set-studio-1';
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(screen.queryByTestId('tracing-image')).not.toBeInTheDocument());
    // Back on the view tab, the new frame takes a while.
    let finish!: () => void;
    state.render.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const before = state.render.mock.calls.length;
    state.front = document.workspaceId;
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.render.mock.calls.length).toBeGreaterThan(before));
    // Not ready (no strokes, no viewport) until that frame is drawn.
    expect(screen.queryByTestId('tracing-image')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing the reference plane…')).toBeInTheDocument();
    await act(async () => { finish(); });
    expect(await screen.findByTestId('tracing-image')).toBeInTheDocument();
  });

  it('draws the frame again when its image is dropped while the view believes it is drawn', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    const before = state.render.mock.calls.length;
    let finish!: () => void;
    state.render.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    // The render store lost the image (a viewport of this context unmounted).
    state.hasImage = false;
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.render.mock.calls.length).toBe(before + 1));
    // No tracing on an empty canvas meanwhile.
    expect(screen.queryByTestId('tracing-image')).not.toBeInTheDocument();
    state.hasImage = true;
    await act(async () => { finish(); });
    expect(await screen.findByTestId('tracing-image')).toBeInTheDocument();
  });

  it('draws the native slice again when the traced image is evicted or uploaded again', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    const before = state.render.mock.calls.length;
    // The reference lost its GPU slot (eviction, watchdog) ...
    state.residency = 'reference:0';
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.render.mock.calls.length).toBe(before + 1));
    // ... and is resident again: the frame on screen is redrawn without user action.
    state.residency = 'reference:1';
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    await waitFor(() => expect(state.render.mock.calls.length).toBe(before + 2));
    expect(screen.getByTestId('tracing-image')).toBeInTheDocument();
  });
});

describe('tracing controls', () => {
  it('selects the radius on focus, lets it be cleared and retyped, and keeps tool letters out of it', async () => {
    const { setSegmentationPresentation } = await import('@/modules/segmentation/session');
    const patch = vi.mocked(setSegmentationPresentation); patch.mockClear();
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    const radius = screen.getByLabelText(/Radius/) as HTMLInputElement;
    const select = vi.spyOn(radius, 'select');
    fireEvent.focus(radius);
    expect(select).toHaveBeenCalled();
    fireEvent.mouseUp(radius, { detail: 3 });
    expect(select).toHaveBeenCalledTimes(2);
    // Clearing the field while retyping does not snap back to the old value.
    fireEvent.change(radius, { target: { value: '' } });
    expect(radius.value).toBe('');
    fireEvent.change(radius, { target: { value: '5' } });
    expect(patch).toHaveBeenLastCalledWith(document.workspaceId, { radiusMm: 5 });
    expect(patch).not.toHaveBeenCalledWith(document.workspaceId, { radiusMm: 25 });
    for (const key of ['b', 'e', 'c']) expect(fireEvent.keyDown(radius, { key })).toBe(false);
    expect(fireEvent.keyDown(radius, { key: 'ArrowUp' })).toBe(true);
    fireEvent.blur(radius);
    expect(radius.value).toBe('0.4');
  });

  it('offers to unlock the active label, not to retry the session, when a stroke is refused by a lock', async () => {
    const base = info();
    const locked = { ...base, snapshot: { ...base.snapshot, labels: base.snapshot.labels.map((row, index) => index === 0 ? { ...row, locked: true } : row) } };
    state.session = { ...(state.session as object), info: locked, error: 'The active label is locked. Unlock it in the Inspector before tracing.' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The active label is locked');
    expect(screen.queryByRole('button', { name: 'Retry session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock ROI A' }));
    expect(state.unlock).toHaveBeenCalledWith(document.workspaceId, 1, false, false);
  });

  it('offers Retry session, not Unlock, for an OS lock error while the label is unlocked', async () => {
    state.session = { ...(state.session as object), error: 'Could not save labels: the file is locked' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    expect(await screen.findByRole('button', { name: 'Retry session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlock/ })).not.toBeInTheDocument();
  });

  it('offers two paint-over choices that differ, and shows an old "all" session as unlocked', async () => {
    state.session = { ...(state.session as object), paintOver: 'all' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    const select = screen.getByLabelText('Paint over') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['Empty space only', 'Unlocked labels']);
    expect(select.value).toBe('unlocked');
  });
  it('shows a radius change made elsewhere instead of a stale draft', async () => {
    const view = render(<SegmentViewport workspaceId={document.workspaceId} />);
    const radius = screen.getByLabelText(/Radius/) as HTMLInputElement;
    fireEvent.focus(radius);
    fireEvent.change(radius, { target: { value: '' } });
    expect(radius.value).toBe('');
    // Another control (or a restored session) changes the radius meanwhile.
    state.session = { ...(state.session as object), radiusMm: 3 };
    view.rerender(<SegmentViewport workspaceId={document.workspaceId} />);
    expect(radius.value).toBe('3');
  });

  it('explains a contour click at the pointer instead of sending a contour of fewer than three points', async () => {
    const { setSegmentationPresentation } = await import('@/modules/segmentation/session');
    const patch = vi.mocked(setSegmentationPresentation); patch.mockClear();
    state.session = { ...(state.session as object), tool: 'contour' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    const pointer = state.pointer as ViewportTool;
    const at = (x: number) => [{ world: [x, -18, 6.2], pressure: .5 }] as Parameters<ViewportTool['pointerDown']>[0];
    act(() => { pointer.pointerDown(at(10.8)); pointer.pointerUp(at(10.8)); });
    expect(state.commit).not.toHaveBeenCalled();
    expect(await screen.findByText('Drag to draw a closed outline.')).toBeInTheDocument();
    // Not a session error: no banner, no Retry session.
    expect(patch).not.toHaveBeenCalledWith(document.workspaceId, expect.objectContaining({ error: expect.anything() }));
    expect(screen.queryByRole('button', { name: 'Retry session' })).not.toBeInTheDocument();
    // A real drag still commits.
    act(() => { pointer.pointerDown(at(10.8)); pointer.pointerMove(at(11.2)); pointer.pointerUp(at(11.6)); });
    expect(state.commit).toHaveBeenCalledWith(document.workspaceId, expect.objectContaining({ tool: 'contour', pointsWorld: expect.arrayContaining([[11.6, -18, 6.2]]) }));
  });

  it('still offers Retry session for other failures', async () => {
    state.session = { ...(state.session as object), error: 'Editable texture upload failed' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    expect(await screen.findByRole('button', { name: 'Retry session' })).toBeInTheDocument();
  });
});
