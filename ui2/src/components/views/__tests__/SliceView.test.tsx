import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SliceView } from '../SliceView';
import type { ViewPlane } from '@/types/coordinates';
import { SLIDER_HEIGHT } from '../../views/constants';

type ViewId = 'axial' | 'sagittal' | 'coronal';

type ViewModelOverrides = Partial<ReturnType<typeof createBaseModel>> & {
  hasLayers?: boolean;
  isLoadingAnyLayer?: boolean;
  primaryLayer?: any;
};

const createViewPlane = (): ViewPlane => ({
  origin_mm: [0, 0, 0],
  u_mm: [1, 0, 0],
  v_mm: [0, 1, 0],
  dim_px: [512, 512],
});

const createBaseModel = (viewId: ViewId, dims: { width: number; height: number }, overrides: ViewModelOverrides = {}) => {
  const hasLayers = overrides.hasLayers ?? false;
  const layers = overrides.layers ?? (hasLayers ? [{ id: 'layer-1', visible: true }] : []);
  const canvasHeight = overrides.canvasHeight ?? (hasLayers ? Math.max(1, dims.height - SLIDER_HEIGHT) : dims.height);

  return {
    viewPlane: overrides.viewPlane ?? createViewPlane(),
    crosshair: overrides.crosshair ?? { world_mm: [0, 0, 0], visible: true },
    layers,
    loadingLayers: overrides.loadingLayers ?? new Set<string>(),
    hasLayers,
    isLoadingAnyLayer: overrides.isLoadingAnyLayer ?? false,
    canvasHeight,
    renderContext: overrides.renderContext ?? {
      id: viewId,
      type: 'slice' as const,
      dimensions: { width: dims.width, height: canvasHeight },
      metadata: { viewType: viewId },
    },
    primaryLayer: overrides.primaryLayer ?? (hasLayers ? layers[0] : undefined),
    primaryOptions: overrides.primaryOptions ?? {
      showBorder: false,
      borderThicknessPx: 1,
      showOrientationMarkers: true,
      showValueOnHover: true,
    },
    crosshairSettings: overrides.crosshairSettings ?? {
      visible: true,
      activeColor: '#ffffff',
      activeThickness: 1,
      activeStyle: 'solid' as const,
    },
  };
};

const sliceViewModelMock = vi.hoisted(() => ({
  factory: (viewId: ViewId, dims: { width: number; height: number }) => createBaseModel(viewId, dims),
  setFactory(fn: (viewId: ViewId, dims: { width: number; height: number }) => ReturnType<typeof createBaseModel>) {
    this.factory = fn;
  },
  reset() {
    this.factory = (viewId: ViewId, dims: { width: number; height: number }) => createBaseModel(viewId, dims);
  },
}));

vi.mock('@/hooks/useSliceViewModel', () => ({
  __esModule: true,
  useSliceViewModel: (viewId: ViewId, dims: { width: number; height: number }) => sliceViewModelMock.factory(viewId, dims),
}));

const sliceNavigationMock = vi.hoisted(() => ({
  getSliceRange: vi.fn(() => ({ min: -100, max: 100, step: 1, current: 0 })),
  updateSlicePosition: vi.fn(),
  has4DVolume: vi.fn(() => false),
  getMode: vi.fn(() => 'slice'),
  reset() {
    this.getSliceRange.mockReset().mockReturnValue({ min: -100, max: 100, step: 1, current: 0 });
    this.updateSlicePosition.mockReset();
    this.has4DVolume.mockReset().mockReturnValue(false);
    this.getMode.mockReset().mockReturnValue('slice');
  },
}));

vi.mock('@/services/SliceNavigationService', () => ({
  __esModule: true,
  getSliceNavigationService: () => sliceNavigationMock,
}));

beforeEach(() => {
  sliceViewModelMock.reset();
  sliceNavigationMock.reset();
});

describe('SliceView', () => {
  it('renders fallback placeholder when no layers are available', () => {
    sliceViewModelMock.setFactory((viewId, dims) => createBaseModel(viewId, dims, {
      hasLayers: false,
      layers: [],
    }));

    render(<SliceView viewId="axial" width={256} height={256} />);

    expect(screen.getByText('No volumes loaded')).toBeInTheDocument();
    expect(screen.getByText('Double-click a file or drag & drop')).toBeInTheDocument();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('shows slice controls when layers exist', () => {
    sliceViewModelMock.setFactory((viewId, dims) => createBaseModel(viewId, dims, {
      hasLayers: true,
      layers: [{ id: 'layer-1', visible: true }],
    }));

    render(<SliceView viewId="sagittal" width={320} height={240} />);

    expect(document.querySelector('input[type="range"]')).toBeTruthy();
    expect(screen.queryByText('No volumes loaded')).toBeNull();
  });

  it('queries the slice navigation service for the active view', () => {
    sliceViewModelMock.setFactory((viewId, dims) => createBaseModel(viewId, dims, {
      hasLayers: true,
      layers: [{ id: 'layer-1', visible: true }],
    }));

    render(<SliceView viewId="coronal" width={256} height={256} />);

    expect(sliceNavigationMock.getSliceRange).toHaveBeenCalledWith('coronal');
  });
});
