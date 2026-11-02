import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewportTool } from '@/modules/api/host';
import type { ViewPlane, SliceViewportPlacement } from '@/modules/api/rendering';
import { SegmentViewport } from '@/modules/segmentation/components/SegmentViewport';
import { document, info } from '@/modules/segmentation/__tests__/liveFixtures';
const state = vi.hoisted(() => ({ session: null as unknown, pointer: null as unknown, render: vi.fn(), slice: vi.fn(), preview: vi.fn(), commit: vi.fn(), view: { layers: [], crosshair: { world_mm: [10, -18, 6], visible: true } } }));
vi.mock('@/modules/api/host', () => ({
  useActiveWorkspaceId: () => 'synthetic-view',
  captureActiveWorkspace: () => ({ workspaceId: 'synthetic-view', isCurrent: () => true }),
  isLiveDocument: () => true, isDocumentEditingFrozen: () => false,
  useModuleCrosshairStyle: () => ({}), formatModuleError: String,
  getModuleViewportTool: () => state.pointer,
  SliceViewport: ({ viewPlane, onWheel, onPlacementChange }: { viewPlane: ViewPlane; onWheel: React.WheelEventHandler<HTMLDivElement>; onPlacementChange(placement: SliceViewportPlacement): void }) => {
    useEffect(() => { onPlacementChange({ x: 0, y: 0, width: 512, height: 512, imageWidth: 512, imageHeight: 512 }); }, [viewPlane]); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="tracing-image" data-plane={JSON.stringify(viewPlane)} onWheel={onWheel} />;
  },
}));
vi.mock('@/modules/api/rendering', () => ({
  useWorkspaceRenderState: () => state.view, ensureModuleLabelLayer: async () => {},
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
  segmentationSaveState: () => 'unsaved', segmentationFrames: () => '',
}));
vi.mock('@/modules/segmentation/toolBindings', () => ({ bindSegmentationViewport: (_id: string, pointer: ViewportTool) => { state.pointer = pointer; return () => pointer.cancel('unmount'); } }));
vi.mock('@/modules/segmentation/components/ContextViews', () => ({ ContextViews: () => null }));
const plane = { origin_mm: [10, -18, 5], u_mm: [.4, 0, 0], v_mm: [0, 0, .4], width_px: 512, height_px: 512 };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  state.session = { document, info: info(), activeLabelId: 1, hiddenLabelIds: [], sliceIndex: 1, tool: 'brush', radiusMm: .4, paintOver: 'unlocked', fill: false, busy: false, error: null };
  state.slice.mockReset().mockResolvedValue({ revision: 0, plane, current: [], previous: [], next: [] });
  state.preview.mockReset().mockResolvedValue(null); state.commit.mockReset(); state.render.mockReset().mockResolvedValue(undefined);
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
});
