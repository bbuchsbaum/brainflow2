import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSurfaceViewSettings,
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { getViewExportService, type ExportOptions } from '@/services/ViewExportService';

const neuroSurfaceCanvasState = vi.hoisted(() => ({
  latestProps: null as any,
}));

vi.mock('../surfaceViewer', async () => {
  const React = await import('react');
  return {
    NeuroSurfaceCanvas: (props: any) => {
      neuroSurfaceCanvasState.latestProps = props;
      return React.createElement('div', {
        'data-testid': 'neuro-surface-canvas',
        onPointerDown: props.onActivate,
        onMouseEnter: props.onActivate,
        onContextMenu: props.onContextMenu,
      });
    },
  };
});

// Controlled crosshair for the linked-cursor assertions. The component reads
// `viewState.crosshair.{world_mm,visible}` via useViewStateStore(selector).
const crosshairMock = vi.hoisted(() => ({
  value: { world_mm: [0, 0, 0] as [number, number, number], visible: true },
}));

vi.mock('@/stores/viewStateStore', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const hook = (selector: any) => selector({ viewState: { crosshair: crosshairMock.value } });
  // Preserve getState/setState/etc. for any other consumer in the tree.
  Object.assign(hook, actual.useViewStateStore);
  return { ...actual, useViewStateStore: hook };
});

import { useViewStateStore } from '@/stores/viewStateStore';
import { SurfaceViewCanvas } from '../SurfaceViewCanvas';

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 3,
      faceCount: 1,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `/tmp/${handle}.gii`,
    },
  };
}

describe('SurfaceViewCanvas Brainflow wrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    neuroSurfaceCanvasState.latestProps = null;
    crosshairMock.value = { world_mm: [0, 0, 0], visible: true };
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      viewpoint: 'lateral',
      showControls: false,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
  });

  it('passes deduplicated surfaces and per-view settings into the reusable canvas', () => {
    const left = makeSurface('lh');
    const right = makeSurface('rh');
    const settings = createDefaultSurfaceViewSettings();
    settings.projectionSettings.useGPUProjection = true;
    settings.materialSettings.surfaceColor = '#123456';
    settings.displaySettings.smoothing = 0.4;

    useSurfaceStore.setState({
      viewpoint: 'medial',
      showControls: true,
      surfaceViewSettings: new Map([['view-1', settings]]),
    });

    render(
      <SurfaceViewCanvas
        surface={left}
        renderSurfaces={[left, right, left]}
        surfaceViewId="view-1"
        width={320}
        height={240}
      />,
    );

    expect(screen.getByTestId('neuro-surface-canvas')).toBeInTheDocument();
    expect(
      neuroSurfaceCanvasState.latestProps.surfaces.map((item: LoadedSurface) => item.handle),
    ).toEqual(['lh', 'rh']);
    expect(neuroSurfaceCanvasState.latestProps.viewpoint).toBe('medial');
    expect(neuroSurfaceCanvasState.latestProps.showControls).toBe(true);
    expect(neuroSurfaceCanvasState.latestProps.projectionSettings.useGPUProjection).toBe(true);
    expect(neuroSurfaceCanvasState.latestProps.materialSettings.surfaceColor).toBe('#123456');
    expect(neuroSurfaceCanvasState.latestProps.displaySettings.smoothing).toBe(0.4);
  });

  it('registers reusable canvas exporters under the Brainflow surface context key', () => {
    const surface = makeSurface('lh');
    const exportService = getViewExportService();
    const registerSpy = vi.spyOn(exportService, 'registerExporter');
    const unregisterSpy = vi.spyOn(exportService, 'unregisterExporter');
    const exporter = vi.fn(
      async (_options: Required<Pick<ExportOptions, 'format' | 'transparentBackground'>>) =>
        new Uint8Array([1, 2, 3]),
    );

    render(<SurfaceViewCanvas surface={surface} surfaceViewId="view-1" width={320} height={240} />);

    act(() => {
      neuroSurfaceCanvasState.latestProps.onExporterChange(exporter);
    });
    expect(registerSpy).toHaveBeenCalledWith('surfaceview:lh:view-1', exporter);

    act(() => {
      neuroSurfaceCanvasState.latestProps.onExporterChange(null);
    });
    expect(unregisterSpy).toHaveBeenCalledWith('surfaceview:lh:view-1');
  });

  it('marks the scoped render context active through the injected activation callback', () => {
    const surface = makeSurface('lh');
    const onActivateSurface = vi.fn();

    render(
      <SurfaceViewCanvas
        surface={surface}
        surfaceViewId="view-1"
        onActivateSurface={onActivateSurface}
        width={320}
        height={240}
      />,
    );

    act(() => {
      neuroSurfaceCanvasState.latestProps.onActivate();
    });

    expect(useActiveRenderContextStore.getState().activeId).toBe('surfaceview:lh:view-1');
    expect(onActivateSurface).toHaveBeenCalledTimes(1);
  });

  it('preserves affine world coordinates already exported by the backend', () => {
    crosshairMock.value = { world_mm: [43.2, -55.4, 18], visible: true };
    const surface = makeSurface('lh');

    render(<SurfaceViewCanvas surface={surface} surfaceViewId="view-1" width={320} height={240} />);

    expect(neuroSurfaceCanvasState.latestProps.markerWorldPosition).toEqual([43.2, -55.4, 18]);
    expect(neuroSurfaceCanvasState.latestProps.cursorAnatomy.get('lh')).toBe(surface.geometry.vertices);
    expect(neuroSurfaceCanvasState.latestProps.markerSnapToSurface).toBe(true);
    expect(neuroSurfaceCanvasState.latestProps.markerMaxSnapDistanceMm).toBe(20);
  });

  it('passes a surface pick back to the volume without reflection', () => {
    const update = vi.spyOn(useViewStateStore.getState(), 'setCrosshair');
    render(<SurfaceViewCanvas surface={makeSurface('lh')} width={320} height={240} />);
    act(() => neuroSurfaceCanvasState.latestProps.onSurfacePick([-31, 17, 29]));
    expect(update).toHaveBeenCalledWith([-31, 17, 29], true);
  });

  it('hides the surface marker when the crosshair is not visible', () => {
    crosshairMock.value = { world_mm: [43.2, -55.4, 18], visible: false };
    const surface = makeSurface('lh');

    render(<SurfaceViewCanvas surface={surface} surfaceViewId="view-1" width={320} height={240} />);

    expect(neuroSurfaceCanvasState.latestProps.markerWorldPosition).toBeNull();
  });
});
