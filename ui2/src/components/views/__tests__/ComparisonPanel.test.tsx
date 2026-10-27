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
  SliceViewport: ({ width, height }: { width: number; height: number }) => (
    <div
      data-testid="slice-viewport"
      data-width={width}
      data-height={height}
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
    vi.unstubAllGlobals();
  });
});
