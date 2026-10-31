import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadFile: vi.fn(),
  requestLayerGpuResources: vi.fn(),
  releaseLayerGpuResources: vi.fn(async () => undefined),
  unloadVolume: vi.fn(async () => undefined),
  applyAndRenderViewState: vi.fn(),
}));
vi.mock('@/services/apiService', () => ({ getApiService: () => api }));
vi.mock('@/components/views/SliceViewport', () => ({
  SliceViewport: ({
    tag,
    onWorldClick,
    mirrorX,
  }: {
    tag: string;
    onWorldClick: (world: [number, number, number]) => void;
    mirrorX?: boolean;
  }) => (
    <button
      data-testid="pane-viewport"
      data-mirror={mirrorX ? 'true' : 'false'}
      onClick={() => onWorldClick([3, -4, 5])}
    >
      {tag}
    </button>
  ),
}));
const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => transport }));

import { StudioDerivedPaneCanvas } from '../StudioDerivedPaneCanvas';
import { useAppModeStore } from '@/stores/appModeStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const AFFINE = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -10, -10, -10, 1];
const STUDIO = 'studio-ws';

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 200, height: 150 } } as ResizeObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
}

function inFront(id: string, mode: 'studio' | 'imaging') {
  act(() => {
    useWorkspaceStore.setState({
      workspaces: new Map([
        [STUDIO, { id: STUDIO, type: 'set-studio' } as never],
        ['ortho', { id: 'ortho', type: 'orthogonal-locked' } as never],
      ]),
      activeWorkspaceId: id,
    } as never);
    if (mode === 'studio') useAppModeStore.getState().enterStudioMode();
    else useAppModeStore.getState().enterImagingMode();
  });
}

describe('StudioDerivedPaneCanvas (review H1/M1/M2/M4)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FixedResizeObserver);
    let volumes = 0;
    api.loadFile.mockImplementation(async () => ({ id: `vol-${++volumes}` }));
    api.requestLayerGpuResources.mockResolvedValue({
      voxel_to_world: AFFINE,
      dim: [10, 10, 10],
      data_range: { min: -1, max: 2 },
    });
    api.applyAndRenderViewState.mockResolvedValue({ width: 1, height: 1, close: vi.fn() });
    api.releaseLayerGpuResources.mockClear();
    api.unloadVolume.mockClear();
    api.loadFile.mockClear();
    api.applyAndRenderViewState.mockClear();
    inFront(STUDIO, 'studio');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    act(() => useAppModeStore.getState().enterImagingMode());
  });

  it('under StrictMode holds one map, never a layer-store layer, and frees it on unmount', async () => {
    const layersBefore = useLayerStore.getState().layers;
    const selectedBefore = useLayerStore.getState().selectedLayerId;
    const view = render(
      <StrictMode>
        <StudioDerivedPaneCanvas paneId="zscore" sourcePath="/c/z.nii.gz" label="Z-score" workspaceId={STUDIO} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('pane-viewport')).toBeInTheDocument());
    await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalled());
    // The StrictMode double mount did not drop the map the second mount holds.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(api.loadFile).toHaveBeenCalledTimes(1);
    expect(api.unloadVolume).not.toHaveBeenCalled();
    // Not in the layer store: no Scene row, legend, histogram or selection change.
    expect(useLayerStore.getState().layers).toBe(layersBefore);
    expect(useLayerStore.getState().selectedLayerId).toBe(selectedBefore);
    // Rendered from the Studio workspace, with its own map only.
    const state = api.applyAndRenderViewState.mock.calls.at(-1)![0];
    expect(state.layers.map((l: { volumeId: string }) => l.volumeId)).toEqual(['vol-1']);
    view.unmount();
    await waitFor(() => expect(api.unloadVolume).toHaveBeenCalledWith('vol-1'));
  });

  it('gives the map up when the Studio leaves the front and re-acquires it on return', async () => {
    render(
      <StudioDerivedPaneCanvas paneId="cohort-mean" sourcePath="/c/m.nii.gz" label="Mean" workspaceId={STUDIO} />,
    );
    await waitFor(() => expect(screen.getByTestId('pane-viewport')).toBeInTheDocument());
    inFront('ortho', 'imaging');
    await waitFor(() => expect(api.unloadVolume).toHaveBeenCalledWith('vol-1'));
    expect(screen.queryByTestId('pane-viewport')).toBeNull();
    // Another tab's view changes do not render the hidden Studio panes.
    api.applyAndRenderViewState.mockClear();
    act(() => useViewStateStore.getState().setViewState((draft) => {
      draft.crosshair.world_mm = [1, 2, 3];
    }));
    expect(api.applyAndRenderViewState).not.toHaveBeenCalled();
    inFront(STUDIO, 'studio');
    await waitFor(() => expect(screen.getByTestId('pane-viewport')).toBeInTheDocument());
    expect(api.loadFile).toHaveBeenCalledTimes(2);
  });

  it('unmounting while the map still loads leaks nothing: it is unloaded once it settles', async () => {
    let finish!: () => void;
    api.loadFile.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ id: 'vol-late' }))),
    );
    const view = render(
      <StudioDerivedPaneCanvas paneId="residual" sourcePath="/c/late.nii.gz" label="Residual" workspaceId={STUDIO} />,
    );
    await waitFor(() => expect(api.loadFile).toHaveBeenCalled());
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(api.unloadVolume).not.toHaveBeenCalledWith('vol-late');
    finish();
    await waitFor(() => expect(api.unloadVolume).toHaveBeenCalledWith('vol-late'));
    // Released before it settled: the GPU lease is returned and nothing drew it.
    expect(api.releaseLayerGpuResources).toHaveBeenCalledWith(expect.stringContaining('vol-late'));
    const drawn = api.applyAndRenderViewState.mock.calls.flatMap(([state]) =>
      state.layers.map((l: { volumeId: string }) => l.volumeId),
    );
    expect(drawn).not.toContain('vol-late');
  });

  it('a click puts the crosshair in the Studio workspace, not the one in front', async () => {
    const setCrosshair = vi.spyOn(useViewStateStore.getState(), 'setCrosshair').mockResolvedValue();
    render(<StudioDerivedPaneCanvas paneId="zscore" sourcePath="/c/z2.nii.gz" label="Z" workspaceId={STUDIO} />);
    fireEvent.click(await screen.findByTestId('pane-viewport'));
    expect(setCrosshair).toHaveBeenCalledWith([3, -4, 5], true, false, STUDIO);
    setCrosshair.mockRestore();
  });

  it('says the GPU texture slots are full instead of a generic failure (W1)', async () => {
    api.requestLayerGpuResources.mockRejectedValueOnce({
      GpuError: { code: 5000, details: 'Maximum texture limit 13 reached' },
    });
    render(<StudioDerivedPaneCanvas paneId="zscore" sourcePath="/c/full.nii.gz" label="Z" workspaceId={STUDIO} />);
    expect(await screen.findByText(/GPU texture slots full/)).toBeInTheDocument();
  });

  it('renders once per frame for a burst of crosshair moves, and not for other edits (W2)', async () => {
    render(<StudioDerivedPaneCanvas paneId="cohort-mean" sourcePath="/c/b.nii.gz" label="Mean" workspaceId={STUDIO} />);
    await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalledTimes(1));
    const crosshairOf = () => useViewStateStore.getState().getWorkspaceViewState(STUDIO).crosshair;
    act(() => {
      for (const z of [1, 2, 3, 4])
        useViewStateStore.getState().setViewState((draft) => {
          draft.crosshair.world_mm = [0, 0, z];
        }, STUDIO);
    });
    await waitFor(() => expect(api.applyAndRenderViewState).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.applyAndRenderViewState).toHaveBeenCalledTimes(2);
    expect(api.applyAndRenderViewState.mock.calls[1][0].crosshair.world_mm).toEqual(crosshairOf().world_mm);
    // A layer window edit elsewhere in the view state draws nothing new.
    act(() =>
      useViewStateStore.getState().setViewState((draft) => {
        draft.layers = [];
      }, STUDIO),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.applyAndRenderViewState).toHaveBeenCalledTimes(2);
  });

  it('draws axial and coronal mirrored under the radiological convention, never sagittal', async () => {
    const { useViewDisplaySettingsStore } = await import('@/stores/viewDisplaySettingsStore');
    act(() => useViewDisplaySettingsStore.getState().setRadiological(true));
    try {
      const view = render(
        <StudioDerivedPaneCanvas paneId="zscore" sourcePath="/c/mz.nii.gz" label="Z" workspaceId={STUDIO} />,
      );
      expect((await screen.findByTestId('pane-viewport')).dataset.mirror).toBe('true');
      view.rerender(
        <StudioDerivedPaneCanvas paneId="zscore" sourcePath="/c/mz.nii.gz" label="Z" workspaceId={STUDIO} plane="sagittal" />,
      );
      await waitFor(() => expect(screen.getByTestId('pane-viewport').dataset.mirror).toBe('false'));
    } finally {
      act(() => useViewDisplaySettingsStore.getState().setRadiological(false));
    }
  });

  it('draws the map diverging over the template anatomy, with its colourbar (N10)', async () => {
    transport.invoke.mockResolvedValue({ volume_handle_info: { id: 'template_t1' } });
    render(
      <StudioDerivedPaneCanvas
        paneId="cohort-mean"
        sourcePath="/c/mean-anat.nii.gz"
        label="All members"
        workspaceId={STUDIO}
        underlayPath="template:MNI152NLin2009cAsym_brain_1mm"
      />,
    );
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith('load_template_by_id', {
        templateId: 'MNI152NLin2009cAsym_brain_1mm',
      }),
    );
    await waitFor(() => {
      const state = api.applyAndRenderViewState.mock.calls.at(-1)?.[0];
      expect(state?.layers.map((l: { volumeId: string; colormap: string }) => [l.volumeId, l.colormap])).toEqual([
        ['template_t1', 'gray'],
        [expect.stringMatching(/^vol-/), 'fmri'],
      ]);
    });
    const bar = screen.getByTestId('studio-scale-bar');
    expect(bar.dataset.colormap).toBe('fmri');
    // Symmetric about zero for the mean, its near-zero band hidden.
    expect(bar.getAttribute('aria-label')).toMatch(/−2 to 2, −0\.2 to 0\.2 hidden/);
  });
});
