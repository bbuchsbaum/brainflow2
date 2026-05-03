import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonPanel } from '../ComparisonPanel';
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
      resizeCallback = callback;
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
});
