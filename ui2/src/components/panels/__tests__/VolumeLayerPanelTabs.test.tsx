import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VolumeLayerPanel } from '../VolumeLayerPanel';

type MockViewLayer = {
  id: string;
  name: string;
  opacity: number;
  intensity: [number, number];
  threshold: [number, number];
  colormap: string;
  interpolation: 'nearest' | 'linear';
  visible: boolean;
  volumeId: string;
  order: number;
};

const testState = vi.hoisted(() => {
  const selectLayer = vi.fn();
  const viewLayers: MockViewLayer[] = [
    {
      id: 'layer-1',
      name: 'Layer One',
      opacity: 1,
      intensity: [0, 100],
      threshold: [0, 100],
      colormap: 'gray',
      interpolation: 'linear',
      visible: true,
      volumeId: 'vol-1',
      order: 0,
    },
  ];

  const selectedLayer = {
    id: 'layer-1',
    name: 'Layer One',
    type: 'label',
    source: 'atlas',
    sourcePath: '/tmp/layer.nii.gz',
    visible: true,
    volumeId: 'vol-1',
    order: 0,
  };

  return {
    activeWorkspaceId: 'ws-1',
    layers: [selectedLayer],
    selectedLayer,
    selectedLayerId: 'layer-1',
    selectLayer,
    viewLayers,
  };
});

vi.mock('@/stores/layerStore', () => ({
  useLayers: () => testState.layers,
  useSelectedLayerId: () => testState.selectedLayerId,
  useSelectedLayer: () => testState.selectedLayer,
  layerSelectors: {
    getLayerMetadata: () => undefined,
  },
  useLayer: () => undefined,
  useLayerStore: (
    selector: (state: {
      selectLayer: typeof testState.selectLayer;
      layers: typeof testState.layers;
      getLayerMetadata: (id: string) => undefined;
    }) => unknown
  ) =>
    selector({
      selectLayer: testState.selectLayer,
      layers: testState.layers,
      getLayerMetadata: () => undefined,
    }),
}));

vi.mock('@/stores/viewStateStore', () => {
  const storeFn = ((selector: (state: { viewState: { layers: MockViewLayer[] } }) => unknown) =>
    selector({ viewState: { layers: testState.viewLayers } })) as (
      selector: (state: { viewState: { layers: MockViewLayer[] } }) => unknown
    ) => unknown;

  return {
    useViewStateStore: Object.assign(storeFn, {
      getState: () => ({
        viewState: { layers: testState.viewLayers },
        setViewState: vi.fn(),
      }),
    }),
  };
});

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: { activeWorkspaceId: string | null }) => string | null) =>
    selector({ activeWorkspaceId: testState.activeWorkspaceId }),
}));

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({
    toggleVisibility: vi.fn(),
    reorderLayers: vi.fn(),
    removeLayer: vi.fn(),
  }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLayerPanelServices', () => ({
  useLayerPanelServices: () => ({
    isInitialized: true,
    error: null,
  }),
}));

vi.mock('@/hooks/useMetadataShortcut', () => ({
  useMetadataShortcut: () => undefined,
}));

vi.mock('@/components/ui/LayerTable', () => ({
  LayerTable: () => <div data-testid="layer-table">LayerTable</div>,
}));

vi.mock('@/components/panels/LayerPropertiesManager', () => ({
  LayerPropertiesManager: ({ sectionMode }: { sectionMode?: string }) => (
    <div data-testid="layer-properties-manager" data-mode={sectionMode ?? 'all'}>
      LayerPropertiesManager
    </div>
  ),
}));

vi.mock('@/components/panels/LayerEmptyState', () => ({
  LayerEmptyState: () => <div data-testid="layer-empty-state">LayerEmptyState</div>,
}));

vi.mock('@/components/panels/LayerStatusBar', () => ({
  LayerStatusBar: () => <div data-testid="layer-status-bar">LayerStatusBar</div>,
}));

vi.mock('@/components/panels/PlotPanel', () => ({
  PlotPanel: () => <div data-testid="plot-panel">PlotPanel</div>,
}));

vi.mock('@/components/common/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/MetadataDrawer', () => ({
  MetadataDrawer: () => null,
}));

describe('VolumeLayerPanel tab shell', () => {
  beforeEach(() => {
    testState.activeWorkspaceId = 'ws-1';
    testState.selectLayer.mockReset();
    window.localStorage.clear();
  });

  it('renders tabs and routes modules to the correct tab panels', () => {
    render(<VolumeLayerPanel />);

    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('layer-table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(screen.getByTestId('layer-properties-manager')).toHaveAttribute('data-mode', 'inspect');

    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    expect(screen.getByTestId('layer-properties-manager')).toHaveAttribute('data-mode', 'mapping');

    fireEvent.click(screen.getByRole('tab', { name: 'Plots' }));
    expect(screen.getByTestId('plot-panel')).toBeInTheDocument();
  });

  it('supports keyboard tab navigation with arrow keys', () => {
    render(<VolumeLayerPanel />);

    const layersTab = screen.getByRole('tab', { name: 'Layers' });
    fireEvent.keyDown(layersTab, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');

    const mappingTab = screen.getByRole('tab', { name: 'Mapping' });
    fireEvent.keyDown(mappingTab, { key: 'ArrowUp' });
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(layersTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Inspect' })).toHaveAttribute('aria-selected', 'true');

    const inspectTab = screen.getByRole('tab', { name: 'Inspect' });
    fireEvent.keyDown(inspectTab, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Plots' })).toHaveAttribute('aria-selected', 'true');

    const plotsTab = screen.getByRole('tab', { name: 'Plots' });
    fireEvent.keyDown(plotsTab, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');
  });

  it('persists selected tab per workspace and restores on workspace switch', () => {
    const { rerender } = render(<VolumeLayerPanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    let prefs = JSON.parse(window.localStorage.getItem('brainflow2-right-sidebar-tabs') || '{}') as Record<string, string>;
    expect(prefs['ws-1']).toBe('mapping');

    testState.activeWorkspaceId = 'ws-2';
    rerender(<VolumeLayerPanel />);
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Plots' }));
    prefs = JSON.parse(window.localStorage.getItem('brainflow2-right-sidebar-tabs') || '{}') as Record<string, string>;
    expect(prefs['ws-2']).toBe('plots');

    testState.activeWorkspaceId = 'ws-1';
    rerender(<VolumeLayerPanel />);
    expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
  });
});
