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
  state.slice.mockReset().mockResolvedValue({ revision: 0, plane, current: [], previous: [], next: [] });
  state.live = true; state.ensureImage.mockReset().mockResolvedValue(undefined); state.removeLayers.mockReset().mockResolvedValue(undefined);
  state.preview.mockReset().mockResolvedValue(null); state.commit.mockReset(); state.render.mockReset().mockResolvedValue(undefined);
  state.unlock.mockReset().mockResolvedValue(null);
  state.front = document.workspaceId; state.residency = 'reference:1'; state.hasImage = true;
});
describe('tracing frame ownership', () => {
  it('cancels a held stroke and hides the old surface until the zoomed frame completes', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    state.render.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending);
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    await screen.findByTestId('tracing-image');
    const pointer = state.pointer as ViewportTool;
    const samples = [{ world: [10.8, -18, 6.2], pressure: .5 }] as Parameters<ViewportTool['pointerDown']>[0];
    act(() => { pointer.pointerDown(samples); });
    fireEvent.wheel(screen.getByTestId('tracing-image'), { deltaY: -20, altKey: true });
    await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('tracing-image')).not.toBeInTheDocument();
    act(() => { pointer.pointerMove(samples); pointer.pointerUp(samples); });
    expect(state.commit).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(screen.getByTestId('tracing-image')).toHaveAttribute('data-plane', expect.stringContaining('11'));
    act(() => { pointer.pointerUp(samples); });
    expect(state.commit).not.toHaveBeenCalled();
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

  it('still offers Retry session for other failures', async () => {
    state.session = { ...(state.session as object), error: 'Editable texture upload failed' };
    render(<SegmentViewport workspaceId={document.workspaceId} />);
    expect(await screen.findByRole('button', { name: 'Retry session' })).toBeInTheDocument();
  });
});
