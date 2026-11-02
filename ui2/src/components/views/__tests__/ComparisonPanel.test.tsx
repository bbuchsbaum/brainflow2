import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonPanel } from '../ComparisonPanel';
import { volumeEdgeBounds } from '../clickDataBounds';
import { resolveCommonViewType } from '../ComparisonWorkspace';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ComparisonPanelConfig } from '@/types/comparison';

const comparisonService = vi.hoisted(() => ({
  renderPanel: vi.fn(),
  cancelRenders: vi.fn(),
}));

vi.mock('@/services/ComparisonRenderService', () => ({
  comparisonTag: (panelId: string, viewType: string) => `comp-${panelId}-${viewType}`,
  getComparisonRenderService: () => comparisonService,
}));

vi.mock('../SliceViewport', () => ({
  SliceViewport: ({
    width,
    height,
    crosshairWorldBounds,
  }: {
    width: number;
    height: number;
    crosshairWorldBounds?: unknown;
  }) => (
    <div
      data-testid="slice-viewport"
      data-width={width}
      data-height={height}
      data-crosshair-bounds={JSON.stringify(crosshairWorldBounds ?? null)}
    />
  ),
}));

describe('ComparisonPanel', () => {
  let resizeCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    resizeCallback = null;
    comparisonService.renderPanel.mockReset();
    comparisonService.renderPanel.mockResolvedValue(undefined);
    comparisonService.cancelRenders.mockReset();

    vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => {
      // The panel's canvas-size observer is created first; later observers
      // (the crosshair knockout re-measure) must not replace it here.
      resizeCallback ??= callback;
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the measured canvas viewport dimensions for rendering', async () => {
    const panel: ComparisonPanelConfig = {
      id: 'panel-1',
      label: 'MNI152 T1w',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial',
    };

    render(
      <ComparisonPanel
        workspaceId="comparison-workspace"
        panel={panel}
        width={640}
        height={420}
        layerNames={new Map([['layer-1', 'MNI152 T1w']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />
    );

    act(() => {
      resizeCallback?.(
        [{
          contentRect: { width: 617.8, height: 381.4 },
        } as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });

    await waitFor(() => {
      expect(comparisonService.renderPanel).toHaveBeenLastCalledWith({
        workspaceId: 'comparison-workspace',
        panel,
        width: 617,
        height: 381,
      });
    });

    expect(screen.getByTestId('slice-viewport')).toHaveAttribute('data-width', '617');
    expect(screen.getByTestId('slice-viewport')).toHaveAttribute('data-height', '381');
  });

  it('re-renders when a sibling pane changes size or layers: one scale across panes (QA N23)', async () => {
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    act(() => useComparisonStore.getState().initFromLayers('comparison-n23', ['layer-1', 'layer-2']));
    const [a, b] = useComparisonStore.getState().getPanels('comparison-n23');
    act(() => useComparisonStore.getState().setPanelCanvasSize(a.id, { width: 400, height: 480 }));
    const { unmount } = render(
      <ComparisonPanel
        workspaceId="comparison-n23"
        panel={b}
        width={400}
        height={504}
        layerNames={new Map([['layer-2', 'T1']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    // B publishes its own canvas size for its siblings.
    await waitFor(() => expect(useComparisonStore.getState().panelCanvasSizes.get(b.id)).toBeDefined());
    const calls = () => comparisonService.renderPanel.mock.calls.length;
    const before = calls();
    // A narrows (its colorbar column appears): B renders again at the shared scale.
    act(() => useComparisonStore.getState().setPanelCanvasSize(a.id, { width: 272, height: 480 }));
    await waitFor(() => expect(calls()).toBeGreaterThan(before));
    // A no-op size write does not.
    const settled = calls();
    act(() => useComparisonStore.getState().setPanelCanvasSize(a.id, { width: 272, height: 480 }));
    expect(calls()).toBe(settled);
    // A's layer changes: the shared frame does, so B renders again.
    act(() => useComparisonStore.getState().setPanelLayer('comparison-n23', a.id, 'layer-2', 'layer-1'));
    await waitFor(() => expect(calls()).toBeGreaterThan(settled));
    // Unmounting removes B's size.
    unmount();
    expect(useComparisonStore.getState().panelCanvasSizes.get(b.id)).toBeUndefined();
  });

  it('is a frame: header with the panel layer, actions slot, rail, no card header', () => {
    const panel: ComparisonPanelConfig = {
      id: 'panel-2',
      label: 'Motor zstat1',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'coronal',
    };
    const onRemovePanel = vi.fn();
    const onViewTypeChange = vi.fn();
    render(
      <ComparisonPanel
        workspaceId="comparison-workspace"
        panel={panel}
        width={640}
        height={420}
        layerNames={new Map([['layer-1', 'Motor zstat1']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={onRemovePanel}
        onViewTypeChange={onViewTypeChange}
      />
    );
    // Actions are in the header's right slot and keyboard reachable.
    const actions = screen.getByTestId('comparison-panel-actions');
    expect(actions.className).toContain('focus-within:opacity-100');
    const select = screen.getByLabelText('Panel orientation, Motor zstat1') as HTMLSelectElement;
    expect(select.value).toBe('coronal');
    screen.getByLabelText('Remove panel Motor zstat1').click();
    expect(onRemovePanel).toHaveBeenCalledWith('panel-2');
    // Rail scrubber for the panel's slice axis.
    // Accessible names carry the panel's layer, so two panels never share them.
    expect(screen.getByRole('slider', { name: 'Coronal slice position, Motor zstat1' })).toBeInTheDocument();
    // The panel header is the frame header overlay (no card header row).
    expect(screen.queryByText('Drop a layer or file here')).toBeNull();
  });
});

describe('Compare status readout follows the pointer', () => {
  // The panel's layer must be in the workspace's view state.
  const original = useViewStateStore.getState().getWorkspaceViewState;
  const workspace = {
    ...useViewStateStore.getState().viewState,
    layers: [{ ...(useViewStateStore.getState().viewState.layers[0] ?? {}), id: 'stat', name: 'Motor zstat1', visible: true }],
  };
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    useStatusReadoutStore.getState().release(null);
    useViewStateStore.setState({ getWorkspaceViewState: (() => workspace) as any });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useViewStateStore.setState({ getWorkspaceViewState: original });
  });

  const renderPanel = () =>
    render(
      <ComparisonPanel
        workspaceId="w"
        panel={{ id: 'panel-1', label: 'Motor zstat1', visibleLayerIds: new Set(['stat']), viewType: 'axial' }}
        width={640}
        height={420}
        layerNames={new Map([['stat', 'Motor zstat1']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );

  it('claims on pointer enter and releases on pointer leave (back to the global rule)', () => {
    renderPanel();
    const panel = screen.getByTestId('comparison-panel');
    fireEvent.pointerEnter(panel);
    expect(useStatusReadoutStore.getState().override).toMatchObject({ layerId: 'stat', name: 'Motor zstat1' });
    fireEvent.pointerLeave(panel);
    expect(useStatusReadoutStore.getState().override).toBeNull();
  });

  it('a focus claim is released when focus leaves the panel', () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: /Axial slice position/ });
    fireEvent.focus(slider);
    expect(useStatusReadoutStore.getState().override?.layerId).toBe('stat');
    fireEvent.blur(slider, { relatedTarget: document.body });
    expect(useStatusReadoutStore.getState().override).toBeNull();
  });

  it('aligns the per-pane value to the header line (top-aligned slot)', () => {
    renderPanel();
    const slot = screen.getByTestId('comparison-panel-actions').parentElement as HTMLElement;
    expect(slot.className).toContain('items-start');
    expect(slot.className).toContain('top-1');
  });
});

describe('Compare frame helpers', () => {
  it('clips the crosshair at the outer voxel edges, half a voxel past the centres', () => {
    expect(
      volumeEdgeBounds({
        worldBounds: { min: [-95.5, -131.5, -77.5], max: [86.5, 84.5, 102.5] },
        dimensions: [92, 109, 91],
      }),
    ).toEqual({ min: [-96.5, -132.5, -78.5], max: [87.5, 85.5, 103.5] });
    expect(volumeEdgeBounds(undefined)).toBeNull();
  });

  it('presses a global plane only while every panel shows it', () => {
    expect(resolveCommonViewType([{ viewType: 'axial' }, { viewType: 'axial' }], 'axial')).toBe('axial');
    expect(resolveCommonViewType([{ viewType: 'axial' }, { viewType: 'sagittal' }], 'axial')).toBeNull();
    expect(resolveCommonViewType([], 'coronal')).toBe('coronal');
  });
});

describe('Compare status readout claim', () => {
  it('only the claiming panel can release the status-bar readout', () => {
    const store = useStatusReadoutStore.getState();
    store.release(null);
    store.claim({ source: 'compare:w:panel-1', layerId: 'base', name: 'MNI152' });
    store.claim({ source: 'compare:w:panel-2', layerId: 'stat', name: 'Motor zstat1' });
    useStatusReadoutStore.getState().release('compare:w:panel-1'); // stale owner: no-op
    expect(useStatusReadoutStore.getState().override?.layerId).toBe('stat');
    useStatusReadoutStore.getState().release('compare:w:panel-2');
    expect(useStatusReadoutStore.getState().override).toBeNull();
  });

  it('adds a loaded layer to the panel without dragging ("Add layer…", native v6)', async () => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    // A wide pane: "Add layer…" sits in the header from 520 px (QA 2026-10-31 F7.3).
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 400, width: 640, height: 400, toJSON: () => ({}) } as DOMRect);
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    useLayerStore.setState({
      layers: [
        { id: 'layer-1', name: 'MNI152 T1w', volumeId: 'v1', type: 'volume', visible: true, order: 0 },
        { id: 'layer-z', name: 'zmap_synthetic.nii', volumeId: 'vz', type: 'volume', visible: true, order: 1 },
      ] as never,
    });
    const addLayerToPanel = vi.fn();
    const original = useComparisonStore.getState().addLayerToPanel;
    useComparisonStore.setState({ addLayerToPanel });
    const panel: ComparisonPanelConfig = {
      id: 'panel-3',
      label: 'MNI152 T1w',
      visibleLayerIds: new Set(['layer-1']),
      viewType: 'axial',
    };
    render(
      <ComparisonPanel
        workspaceId="comparison-workspace"
        panel={panel}
        width={640}
        height={420}
        layerNames={new Map([['layer-1', 'MNI152 T1w']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Add a layer to panel MNI152 T1w' });
    // Only the layer this panel does not show is offered.
    expect(select).toHaveTextContent('zmap_synthetic.nii');
    expect(select).not.toHaveTextContent('MNI152 T1w');
    fireEvent.change(select, { target: { value: 'layer-z' } });
    expect(addLayerToPanel).toHaveBeenCalledWith('comparison-workspace', 'panel-3', 'layer-z');
    useComparisonStore.setState({ addLayerToPanel: original });
    rect.mockRestore();
    vi.unstubAllGlobals();
  });

  it('the header picker swaps the pane layer and keeps the name visible (QA features 2026-10-31 §6)', async () => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    const { useLayerStore } = await import('@/stores/layerStore');
    const { useComparisonStore } = await import('@/stores/comparisonStore');
    useLayerStore.setState({
      layers: [
        { id: 'layer-1', name: 'MNI152 T1w', volumeId: 'v1', type: 'volume', visible: true, order: 0 },
        { id: 'layer-z', name: 'zmap_synthetic.nii', volumeId: 'vz', type: 'volume', visible: true, order: 1 },
      ] as never,
    });
    const workspace = {
      ...useViewStateStore.getState().viewState,
      layers: [
        { ...(useViewStateStore.getState().viewState.layers[0] ?? {}), id: 'layer-1', visible: true },
        { ...(useViewStateStore.getState().viewState.layers[0] ?? {}), id: 'layer-z', visible: true },
      ],
    };
    const originalView = useViewStateStore.getState().getWorkspaceViewState;
    useViewStateStore.setState({ getWorkspaceViewState: (() => workspace) as never });
    const setPanelLayer = vi.fn();
    const original = useComparisonStore.getState().setPanelLayer;
    useComparisonStore.setState({ setPanelLayer });
    render(
      <ComparisonPanel
        workspaceId="comparison-workspace"
        panel={{ id: 'panel-4', label: 'zmap', visibleLayerIds: new Set(['layer-z']), viewType: 'axial' }}
        letter="B"
        width={140}
        height={60}
        layerNames={new Map([['layer-1', 'MNI152 T1w'], ['layer-z', 'zmap_synthetic.nii']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    // Even a 140 × 60 pane keeps its header and name (the overlay header hid below 90 px).
    const picker = screen.getByTestId('compare-pane-picker') as HTMLSelectElement;
    expect(picker.value).toBe('layer-z');
    expect(picker.title).toBe('zmap_synthetic.nii');
    fireEvent.change(picker, { target: { value: 'layer-1' } });
    expect(setPanelLayer).toHaveBeenCalledWith('comparison-workspace', 'panel-4', 'layer-1', 'layer-z', 'MNI152 T1w');
    useComparisonStore.setState({ setPanelLayer: original });
    useViewStateStore.setState({ getWorkspaceViewState: originalView });
    vi.unstubAllGlobals();
  });

  it('header controls sit in the header in the position’s place; the name keeps its room (QA 2026-10-31 F7.3)', async () => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 380, bottom: 300, width: 380, height: 300, toJSON: () => ({}) } as DOMRect);
    render(
      <ComparisonPanel
        workspaceId="comparison-workspace"
        panel={{ id: 'panel-5', label: 'FreeSurfer ASEG', visibleLayerIds: new Set(['x']), viewType: 'axial' }}
        letter="A"
        width={380}
        height={320}
        layerNames={new Map([['x', 'FreeSurfer ASEG']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    const header = screen.getByTestId('compare-pane-header');
    // The plane select and remove button are header controls, not an overlay on the name.
    const controls = screen.getByTestId('compare-pane-controls');
    expect(header.contains(controls)).toBe(true);
    expect(controls.contains(screen.getByLabelText(/Panel orientation/))).toBe(true);
    expect(controls.contains(screen.getByLabelText(/Remove panel/))).toBe(true);
    const picker = screen.getByTestId('compare-pane-picker') as HTMLSelectElement;
    expect(parseFloat(picker.style.maxWidth)).toBeGreaterThanOrEqual(140);
    rect.mockRestore();
    vi.unstubAllGlobals();
  });

  it('clips the crosshair to the pane’s layer AND the anatomy under it (QA 2026-10-31 F7.3)', async () => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
    const { useLayerStore } = await import('@/stores/layerStore');
    const meta = (min: number[], max: number[]) => ({
      worldBounds: { min, max },
      dimensions: [11, 11, 11],
      spacing: [1, 1, 1],
    });
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true },
        { id: 'obl', name: 'oblique', volumeId: 'obl', type: 'volume', visible: true },
      ] as never,
      layerMetadata: new Map([
        ['t1', meta([-90, -120, -70], [90, 90, 100])],
        ['obl', meta([-10, -10, -10], [0, 0, 0])],
      ]) as never,
    });
    render(
      <ComparisonPanel
        workspaceId="w"
        panel={{ id: 'panel-6', label: 'oblique', visibleLayerIds: new Set(['obl']), viewType: 'axial' }}
        width={400}
        height={300}
        layerNames={new Map([['obl', 'oblique']])}
        onRemoveLayer={vi.fn()}
        onRemovePanel={vi.fn()}
        onViewTypeChange={vi.fn()}
      />,
    );
    const bounds = JSON.parse(screen.getByTestId('slice-viewport').getAttribute('data-crosshair-bounds')!);
    // The union reaches the T1's edges, not only the small oblique map's.
    expect(bounds.min[0]).toBeLessThanOrEqual(-90);
    expect(bounds.max[2]).toBeGreaterThanOrEqual(100);
    vi.unstubAllGlobals();
  });
});
