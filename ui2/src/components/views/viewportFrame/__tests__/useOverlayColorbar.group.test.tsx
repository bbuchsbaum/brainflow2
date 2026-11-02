import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useOverlayColorbar } from '../useOverlayColorbar';
import { ColorbarGroupContext } from '../viewportFrameStore';

const viewLayer = (id: string, intensity: [number, number]) => ({
  id,
  name: id,
  volumeId: id,
  visible: true,
  opacity: 1,
  colormap: 'gray',
  intensity,
  threshold: [0, 0] as [number, number],
});

// The workspace stacks an anatomy base, the member and another overlay, and
// the other overlay is selected.
beforeEach(() => {
  useLayerStore.setState({
    layers: ['anat', 'member', 'other'].map((id, order) => ({ id, name: id, volumeId: id, visible: true, order })),
    selectedLayerId: 'other',
  } as never);
  const state = useViewStateStore.getState();
  act(() =>
    useViewStateStore.setState({
      viewState: {
        ...state.viewState,
        layers: [viewLayer('anat', [0, 900]), viewLayer('member', [0.4, 1.1]), viewLayer('other', [-6, 6])] as never,
      },
    } as never),
  );
});

describe('useOverlayColorbar in a colorbar group (QA N16, Studio Compare pane A)', () => {
  it('the main views follow the usual rule: the selected overlay', () => {
    expect(renderHook(() => useOverlayColorbar()).result.current?.layerId).toBe('other');
  });

  it('a group that names its layer describes that layer, whatever is selected or stacked', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ColorbarGroupContext.Provider value={{ group: 'studio', describeLayerId: 'member' }}>{children}</ColorbarGroupContext.Provider>
    );
    const bar = renderHook(() => useOverlayColorbar(), { wrapper }).result.current;
    expect(bar?.layerId).toBe('member');
    expect(bar?.intensity).toEqual([0.4, 1.1]);
  });

  it('describes the named layer even when it is the base', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ColorbarGroupContext.Provider value={{ group: 'studio', describeLayerId: 'anat' }}>{children}</ColorbarGroupContext.Provider>
    );
    expect(renderHook(() => useOverlayColorbar(), { wrapper }).result.current?.layerId).toBe('anat');
  });
});
