import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/services/ViewZoomService', () => ({ fitView: vi.fn(async () => {}) }));
// Two runs of one series: run1 and run2 (useOverlayColorbar's run-group rule).
vi.mock('@/services/series/runWindow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/series/runWindow')>()),
  runGroupIds: (id: string) => (id === 'run1' || id === 'run2' ? ['run1', 'run2'] : [id]),
}));

import { useViewContextMenu } from '../useViewContextMenu';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';

/** QA 2026-10-31: with an atlas selected, the stat map's colorbar had no "Hide colorbar". */
const open = () => {
  const { result } = renderHook(() => useViewContextMenu('axial'));
  result.current({ preventDefault() {}, stopPropagation() {}, clientX: 5, clientY: 5 } as React.MouseEvent<HTMLDivElement>);
  return useContextMenuStore.getState().items;
};
const view = (id: string, layerMode: 'scalar' | 'label' = 'scalar') => ({
  id, name: id, volumeId: id, visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0], layerMode,
});

describe('view context menu colorbar toggle', () => {
  it('targets the shown overlay colorbar even with an atlas selected', () => {
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true },
        { id: 'z', name: 'zmap', volumeId: 'z', type: 'volume', visible: true },
        { id: 'aseg', name: 'ASEG', volumeId: 'aseg', type: 'label', source: 'atlas', visible: true },
      ] as never,
      selectedLayerId: 'aseg',
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('t1'), view('z'), view('aseg', 'label')] as never;
    });
    const toggle = open().find((item) => item.id === 'toggle-colorbar');
    expect(toggle?.label).toBe('Hide colorbar');
    toggle!.onClick!();
    expect(useDisplayOptionsStore.getState().getOptions('z').showColorbar).toBe(false);
    useDisplayOptionsStore.getState().setOptions('z', { showColorbar: true });
  });

  it('no toggle when no overlay colorbar is shown', () => {
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true },
        { id: 'aseg', name: 'ASEG', volumeId: 'aseg', type: 'label', source: 'atlas', visible: true },
      ] as never,
      selectedLayerId: 'aseg',
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('t1'), view('aseg', 'label')] as never;
    });
    expect(open().some((item) => item.id === 'toggle-colorbar')).toBe(false);
  });

  it('a selected run-group base (the colorbar the view shows) gets the toggle too (review L1)', () => {
    useLayerStore.setState({
      layers: [
        { id: 'run1', name: 'run1', volumeId: 'run1', type: 'volume', visible: true },
        { id: 'run2', name: 'run2', volumeId: 'run2', type: 'volume', visible: false },
      ] as never,
      selectedLayerId: 'run1',
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [view('run1'), { ...view('run2'), visible: false }] as never;
    });
    const toggle = open().find((item) => item.id === 'toggle-colorbar');
    expect(toggle?.label).toBe('Hide colorbar');
    toggle!.onClick!();
    expect(useDisplayOptionsStore.getState().getOptions('run1').showColorbar).toBe(false);
    useDisplayOptionsStore.getState().setOptions('run1', { showColorbar: true });
  });
});
