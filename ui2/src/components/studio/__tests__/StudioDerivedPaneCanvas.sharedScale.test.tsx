/**
 * A computed pane that shares the member's scale (the group mean, pane B) is
 * drawn with the member's display and tells the member how wide its own
 * robust window is; a pane that does not share keeps its own symmetric range.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadFile: vi.fn(),
  requestLayerGpuResources: vi.fn(),
  releaseLayerGpuResources: vi.fn(async () => undefined),
  unloadVolume: vi.fn(async () => undefined),
  applyAndRenderViewState: vi.fn(),
}));
vi.mock('@/services/apiService', () => ({ getApiService: () => api }));
vi.mock('@/components/views/SliceViewport', () => ({
  SliceViewport: ({ tag }: { tag: string }) => <div data-testid="pane-viewport">{tag}</div>,
}));
const limit = vi.hoisted(() => ({ fetch: vi.fn(), forget: vi.fn() }));
vi.mock('@/services/studio/studioMapLimit', () => ({
  fetchStudioRobustLimit: limit.fetch,
  forgetStudioHistogram: limit.forget,
}));

import { StudioDerivedPaneCanvas } from '../StudioDerivedPaneCanvas';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { useAppModeStore } from '@/stores/appModeStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const AFFINE = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -10, -10, -10, 1];
const STUDIO = 'studio-ws';
const SHARED = {
  colormap: 'fmri',
  intensity: [-0.0145, 0.0145] as [number, number],
  threshold: [-0.00145, 0.00145] as [number, number],
};

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 200, height: 150 } } as ResizeObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
}

let meanLimit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  let volumes = 0;
  api.loadFile.mockReset().mockImplementation(async () => ({ id: `vol-${++volumes}` }));
  // The mean: smaller values than a member's, a few extreme voxels.
  api.requestLayerGpuResources.mockReset().mockResolvedValue({
    voxel_to_world: AFFINE,
    dim: [10, 10, 10],
    data_range: { min: -0.004, max: 0.03 },
  });
  api.applyAndRenderViewState.mockReset().mockResolvedValue({ width: 1, height: 1, close: vi.fn() });
  limit.fetch.mockReset().mockResolvedValue(0.006);
  limit.forget.mockReset();
  meanLimit = vi.spyOn(getStudioDisplayService(), 'setCompareMeanLimit').mockImplementation(() => undefined);
  act(() => {
    useWorkspaceStore.setState({
      workspaces: new Map([[STUDIO, { id: STUDIO, type: 'set-studio' } as never]]),
      activeWorkspaceId: STUDIO,
    } as never);
    useAppModeStore.getState().enterStudioMode();
  });
});
afterEach(() => {
  cleanup();
  meanLimit.mockRestore();
  vi.unstubAllGlobals();
  act(() => useAppModeStore.getState().enterImagingMode());
});

const drawnMap = () => {
  const state = api.applyAndRenderViewState.mock.calls.at(-1)![0] as {
    layers: Array<{ colormap: string; intensity: [number, number]; threshold: [number, number] }>;
  };
  const { colormap, intensity, threshold } = state.layers.at(-1)!;
  return { colormap, intensity, threshold };
};

it('the mean is drawn with the member’s display, and its legend shows that window', async () => {
  render(
    <StudioDerivedPaneCanvas
      paneId="cohort-mean"
      sourcePath="/c/mean.nii.gz"
      label="Mean"
      workspaceId={STUDIO}
      shareMemberScale
      sharedDisplay={SHARED}
    />,
  );
  await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalled());
  await waitFor(() => expect(drawnMap()).toEqual(SHARED));
  const bar = await screen.findByTestId('studio-scale-bar');
  // Window ends in full (not "0.01"), the true minus sign, 0 marked, tabular numerals.
  expect(bar).toHaveTextContent('0.0145');
  expect(bar).toHaveTextContent('−0.0145');
  expect(bar.textContent).toContain('0.0145' + '0' + '−0.0145');
  expect(bar.className).toContain('tabular-nums');
  expect(bar.dataset.colormap).toBe('fmri');
});

it('tells the member its robust window end (the percentile rule), and takes it back on leaving', async () => {
  const view = render(
    <StudioDerivedPaneCanvas
      paneId="cohort-mean"
      sourcePath="/c/mean.nii.gz"
      label="Mean"
      workspaceId={STUDIO}
      shareMemberScale
      sharedDisplay={SHARED}
    />,
  );
  await waitFor(() => expect(meanLimit).toHaveBeenCalledWith(0.006));
  // The mean has negative values: its limit is the signed one.
  expect(limit.fetch).toHaveBeenCalledWith(expect.stringContaining('vol-1'), 'diverging');
  view.unmount();
  expect(meanLimit).toHaveBeenLastCalledWith(null);
  expect(limit.forget).toHaveBeenCalledWith(expect.stringContaining('vol-1'));
});

it('with the scale not shared, the mean keeps its own symmetric range and reports nothing', async () => {
  render(
    <StudioDerivedPaneCanvas
      paneId="cohort-mean"
      sourcePath="/c/mean.nii.gz"
      label="Mean"
      workspaceId={STUDIO}
      sharedDisplay={SHARED}
    />,
  );
  await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalled());
  expect(drawnMap()).toMatchObject({ colormap: 'cold_hot', intensity: [-0.03, 0.03] });
  expect(limit.fetch).not.toHaveBeenCalled();
  expect(meanLimit).not.toHaveBeenCalled();
});

it('the residual and the z-score keep their own symmetric ranges', async () => {
  for (const paneId of ['residual', 'zscore']) {
    api.applyAndRenderViewState.mockClear();
    const view = render(
      <StudioDerivedPaneCanvas paneId={paneId} sourcePath={`/c/${paneId}.nii.gz`} label={paneId} workspaceId={STUDIO} />,
    );
    await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalled());
    expect(drawnMap(), paneId).toMatchObject({ colormap: 'cold_hot', intensity: [-0.03, 0.03] });
    view.unmount();
  }
  expect(limit.fetch).not.toHaveBeenCalled();
});
