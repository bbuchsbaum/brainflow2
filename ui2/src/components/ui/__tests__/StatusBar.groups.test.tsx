/**
 * Status bar Crosshair / Pointer groups (QA design decisions 2026-10-30,
 * section 3) and the pointer-readout toggle (section 4).
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));
// The reading the hook returns: { world, value } or null (pending).
const reading = vi.hoisted(() => ({
  pointer: null as null | { world: [number, number, number]; value: number | null; timepoint?: number },
}));
vi.mock('@/hooks/useLayerValueAtWorld', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useLayerValueAtWorld')>()),
  useLayerValueAtWorld: (layerId: string | null, world: readonly number[] | null, delayMs?: number) => {
    if (!layerId || !world) return null;
    // The Pointer group asks with a short delay; the crosshair with the default.
    if (delayMs !== undefined) return reading.pointer ? { layerId, timepoint: 0, ...reading.pointer } : null;
    return { layerId, world, timepoint: 0, value: 1.5 };
  },
}));

import { StatusBar } from '../StatusBar';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useViewContextMenu } from '@/hooks/useViewContextMenu';

const V2W = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -95.5, -131.5, -77.5, 1];
const W2V = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 47.75, 65.75, 38.75, 1];

function seed() {
  useLayerStore.setState({
    layers: [{ id: 't1', name: 'T1.nii.gz', volumeId: 't1', type: 'volume', visible: true, order: 0 }] as never,
    selectedLayerId: 't1',
    layerMetadata: new Map([
      ['t1', { voxelToWorld: V2W, worldToVoxel: W2V, dimensions: [96, 114, 96] as [number, number, number] }],
    ]),
  });
  useStatusReadoutStore.setState({ override: null } as never);
  useViewStateStore.getState().setViewState((state) => {
    state.crosshair.world_mm = [42.5, -59.5, -9.5];
    state.layers = [
      { id: 't1', name: 't1', volumeId: 't1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0] },
    ] as never;
  });
}

const group = (c: HTMLElement, name: string) => c.querySelector(`[data-group="${name}"]`) as HTMLElement | null;
const slotText = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-slot="${id}"] .status-value`)?.textContent ?? null;

describe('StatusBar groups', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    useMouseCoordinateStore.getState().clearMousePosition();
    useHoverSettingsStore.getState().setShowInStatusBar(true);
    reading.pointer = null;
    seed();
  });

  it('labels a Crosshair group with mm, the named ijk and the value', () => {
    const { container } = render(<StatusBar />);
    const crosshair = group(container, 'crosshair')!;
    expect(screen.getByRole('group', { name: 'Crosshair' })).toBe(crosshair);
    expect(crosshair).toHaveTextContent('Crosshair');
    expect(crosshair.querySelector('[data-slot="voxel"]')).toHaveTextContent('ijk 69, 36, 34 (T1)');
    expect(crosshair.querySelector('[data-slot="value"]')).toHaveTextContent('1.5');
  });

  it('greys and blanks the Pointer group while the pointer is off the image', () => {
    const { container } = render(<StatusBar />);
    const pointer = group(container, 'pointer')!;
    expect(screen.getByRole('group', { name: 'Pointer' })).toBe(pointer);
    expect(pointer).toHaveAttribute('data-inactive');
    expect(slotText(container, 'mouse')).toBe('—');
    expect(slotText(container, 'pointerValue')).toBe('—');

    // Over the slice but outside the volume: still greyed, no value.
    act(() => useMouseCoordinateStore.getState().setMousePosition([500, 0, 0], 'axial'));
    reading.pointer = { world: [500, 0, 0], value: 7 };
    expect(group(container, 'pointer')).toHaveAttribute('data-inactive');
    expect(slotText(container, 'pointerValue')).toBe('—');
  });

  it('shows the pointer value only for the voxel under the pointer, never a stale one', () => {
    reading.pointer = { world: [10.5, 0.5, 0.5], value: 3.25 };
    const { container, rerender } = render(<StatusBar />);
    act(() => useMouseCoordinateStore.getState().setMousePosition([10.5, 0.5, 0.5], 'axial'));
    expect(group(container, 'pointer')).not.toHaveAttribute('data-inactive');
    expect(slotText(container, 'mouse')).toBe('(10.5, 0.5, 0.5)');
    expect(slotText(container, 'pointerValue')).toBe('3.25');

    // Same 2 mm voxel: the reading is still current.
    act(() => useMouseCoordinateStore.getState().setMousePosition([10.9, 0.5, 0.5], 'axial'));
    expect(slotText(container, 'pointerValue')).toBe('3.25');

    // Next voxel, its reading not in yet: blank, not 3.25.
    act(() => useMouseCoordinateStore.getState().setMousePosition([14.5, 0.5, 0.5], 'axial'));
    expect(slotText(container, 'pointerValue')).toBe('');

    // Leaving: greyed and blank at once.
    act(() => useMouseCoordinateStore.getState().clearMousePosition());
    rerender(<StatusBar />);
    expect(group(container, 'pointer')).toHaveAttribute('data-inactive');
    expect(slotText(container, 'pointerValue')).toBe('—');
  });

  it('the view menu toggles the Pointer group, persisted in hover settings', () => {
    const { container } = render(<StatusBar />);
    expect(group(container, 'pointer')).not.toBeNull();

    function Probe() {
      const onContextMenu = useViewContextMenu('ctx');
      return <div data-testid="view" onContextMenu={onContextMenu} />;
    }
    render(<Probe />);
    fireEvent.contextMenu(screen.getByTestId('view'));
    const item = useContextMenuStore.getState().items.find((i) => i.id === 'hover-settings')!;
    expect(item.label).toBe('Hide pointer readout');
    act(() => item.onClick!());
    expect(useHoverSettingsStore.getState().showInStatusBar).toBe(false);
    expect(group(container, 'pointer')).toBeNull();
    // Persisted with the other hover settings.
    expect(JSON.parse(localStorage.getItem('brainflow-hover-settings') ?? '{}').state?.showInStatusBar).toBe(false);

    fireEvent.contextMenu(screen.getByTestId('view'));
    const again = useContextMenuStore.getState().items.find((i) => i.id === 'hover-settings')!;
    expect(again.label).toBe('Show pointer readout');
    act(() => again.onClick!());
    expect(group(container, 'pointer')).not.toBeNull();
  });

  it('stays live over anatomy outside a partial-coverage stat map; only the value reads "—"', () => {
    // zstat covers a 20 mm cube around the origin only, on its own grid.
    useLayerStore.setState((state) => ({
      layers: [
        ...state.layers,
        { id: 'z', name: 'zstat1.nii.gz', volumeId: 'z', type: 'volume', visible: true, order: 1 },
      ] as never,
      selectedLayerId: 'z',
      layerMetadata: new Map([
        ...state.layerMetadata,
        [
          'z',
          {
            voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -9, -9, -9, 1],
            worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 4.5, 4.5, 4.5, 1],
            dimensions: [10, 10, 10] as [number, number, number],
          },
        ],
      ]),
    }));
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        ...state.layers,
        { id: 'z', name: 'z', volumeId: 'z', visible: true, opacity: 1, colormap: 'hot', intensity: [0, 1], threshold: [0, 0] },
      ] as never;
    });
    // Over the T1 at x = 40 mm, outside zstat1: the reading says null there.
    reading.pointer = { world: [40.5, 0.5, 0.5], value: null };
    const { container } = render(<StatusBar />);
    act(() => useMouseCoordinateStore.getState().setMousePosition([40.5, 0.5, 0.5], 'axial'));
    expect(group(container, 'pointer')).not.toHaveAttribute('data-inactive');
    expect(slotText(container, 'mouse')).toBe('(40.5, 0.5, 0.5)');
    expect(slotText(container, 'pointerValue')).toBe('—');
  });

  it('a reading of another timepoint is stale: blank until the current frame is read', () => {
    useLayerStore.setState((state) => ({
      layers: state.layers.map((l) => ({ ...l, currentTimepoint: 1 })) as never,
    }));
    reading.pointer = { world: [10.5, 0.5, 0.5], value: 3.25, timepoint: 0 };
    const { container, rerender } = render(<StatusBar />);
    act(() => useMouseCoordinateStore.getState().setMousePosition([10.5, 0.5, 0.5], 'axial'));
    expect(slotText(container, 'pointerValue')).toBe('');
    reading.pointer = { world: [10.5, 0.5, 0.5], value: 4.5, timepoint: 1 };
    rerender(<StatusBar />);
    expect(slotText(container, 'pointerValue')).toBe('4.5');
  });
});
