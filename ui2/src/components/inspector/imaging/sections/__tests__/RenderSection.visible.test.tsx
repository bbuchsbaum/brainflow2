/**
 * QA 2026-10-31 N18 review: the Inspector's Visible switch wrote viewState and
 * the layer store itself, past the layer service's GPU-slot guard. It goes
 * through setLayerVisibleByUser (one undo step, refused shows undone).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneItem } from '@/types/sceneItem';

const viewStore = vi.hoisted(() => ({ current: null as any }));

vi.mock('@/stores/viewStateStore', async () => {
  const { create: createStore } = await import('zustand');
  const store = createStore<any>((set, get) => ({
    viewState: {
      layers: [
        {
          id: 'z',
          name: 'zstat1',
          visible: false,
          opacity: 1,
          colormap: 'fmri_redblue',
          intensity: [-6, 6],
          threshold: [-2.3, 2.3],
        },
      ],
      crosshair: { world_mm: [0, 0, 0] },
    },
    setViewState: (fn: (draft: any) => void) => {
      const draft = structuredClone(get().viewState);
      fn(draft);
      set({ viewState: draft });
    },
  }));
  viewStore.current = store;
  return { useViewStateStore: store };
});

const layerUpdate = vi.hoisted(() => vi.fn());
vi.mock('@/stores/layerStore', async () => {
  const { create: createStore } = await import('zustand');
  const store = createStore<any>(() => ({
    layers: [{ id: 'z', name: 'zstat1', type: 'volume', visible: false }],
    layerMetadata: new Map([['z', { dataRange: { min: -4.58, max: 6.15 } }]]),
    updateLayer: layerUpdate,
    selectLayer: vi.fn(),
  }));
  return { useLayerStore: store };
});

const setLayerVisibleByUser = vi.hoisted(() => vi.fn());
vi.mock('@/services/SceneHistoryService', () => ({
  getSceneHistory: () => ({ record: (_key: string, _label: string, edit: () => unknown) => edit() }),
  setLayerVisibleByUser,
}));

vi.mock('@/services/SamplingService', () => ({ sampleLayerAtWorld: vi.fn(async () => ({ value: null })) }));

import { RenderSection } from '../RenderSection';

const item = {
  id: 'z',
  kind: 'volume-overlay',
  group: 'volume',
  name: 'zstat1',
  subtitle: '',
  visible: false,
  opacity: 1,
  ref: { type: 'volume', layerId: 'z' },
} as SceneItem;

describe('Inspector Visible switch', () => {
  it('shows the layer through the guarded layer-service path only', () => {
    render(<RenderSection item={item} />);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    expect(setLayerVisibleByUser).toHaveBeenCalledWith('z', true);
    // Nothing written behind the guard's back.
    expect(viewStore.current.getState().viewState.layers[0].visible).toBe(false);
    expect(layerUpdate).not.toHaveBeenCalled();
  });
});
