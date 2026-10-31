/**
 * The colorbar keeps below a container control only where there is one
 * (HiDPI / plane-toggle review L4: 48 px were reserved in the Studio Deck,
 * which has no lock button).
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SLIDER_HEIGHT } from '../constants';

const colorbar = vi.hoisted(() => ({ topReserve: undefined as number | undefined }));
vi.mock('../SliceViewport', () => ({ SliceViewport: () => <div /> }));
vi.mock('../viewportFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../viewportFrame')>()),
  ViewportColorbar: (props: { topReserve?: number }) => {
    colorbar.topReserve = props.topReserve;
    return null;
  },
  useOverlayColorbar: () => ({ layerId: 'z', name: 'z', colormap: 'fmri', intensity: [-6, 6], threshold: [-3, 3] }),
  useColorbarHostPlane: () => 'axial',
}));
vi.mock('@/hooks/useSliceViewModel', () => ({
  __esModule: true,
  useSliceViewModel: (viewId: string, dims: { width: number; height: number }) => ({
    viewPlane: { origin_mm: [-50, 50, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [100, 100] },
    crosshair: { world_mm: [0, 0, 0], visible: true },
    layers: [{ id: 'z', visible: true }],
    loadingLayers: new Set<string>(),
    hasLayers: true,
    isLoadingAnyLayer: false,
    canvasHeight: dims.height - SLIDER_HEIGHT,
    renderContext: { id: viewId, type: 'slice', dimensions: dims, metadata: { viewType: viewId } },
    primaryLayer: { id: 'z', visible: true },
    primaryOptions: { showBorder: false, borderThicknessPx: 1, showOrientationMarkers: false, showValueOnHover: false },
    crosshairSettings: { visible: true, activeColor: '#fff', activeThickness: 1, activeStyle: 'solid' },
  }),
}));

describe('top-right reserve', () => {
  it('is 0 by default and the lock button value where the container passes it', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    const { SliceViewCanvas } = await import('../SliceViewCanvas');
    const { LAYOUT_BUTTON_RESERVE } = await import('../constants');
    const { rerender } = render(<SliceViewCanvas viewId="axial" width={300} height={300} />);
    expect(colorbar.topReserve).toBe(0);
    rerender(<SliceViewCanvas viewId="axial" width={300} height={300} topRightReserve={LAYOUT_BUTTON_RESERVE} />);
    expect(colorbar.topReserve).toBe(48);
    vi.unstubAllGlobals();
  });
});
