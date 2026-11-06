import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import {
  installLayerReadyRedraw,
  subscribeLayerReadyRedraw,
} from '@/services/render/redrawOnLayerReady';
import { useViewStateStore } from '@/stores/viewStateStore';
import { resetRenderLayerScope, setRenderLayerScope } from '@/services/render/RenderLayerScope';
import type { ViewLayer } from '@/types/viewState';

// R4 native forced-pressure run (2026-11-06): a front tab's layers were
// uploaded after the frame that left them out, and nothing drew the views
// again, so they showed 1-5 of 10 layers until the next interaction.
describe('subscribeLayerReadyRedraw', () => {
  let drawn: Set<string>;
  let redraw: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    drawn = new Set(['a', 'b', 'c']);
    redraw = vi.fn();
    stop = subscribeLayerReadyRedraw({
      drawsLayer: (id) => drawn.has(id),
      redraw,
      settleMs: 30,
    });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('redraws once a layer the views draw becomes resident', () => {
    getEventBus().emit('layer.gpu.ready', { layerId: 'a' });
    expect(redraw).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('redraws once for a burst, after the last layer', () => {
    for (const layerId of ['a', 'b', 'c']) {
      getEventBus().emit('layer.gpu.ready', { layerId });
      vi.advanceTimersByTime(10);
    }
    expect(redraw).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('ignores layers the views do not draw', () => {
    getEventBus().emit('layer.gpu.ready', { layerId: 'background-tab-layer' });
    vi.advanceTimersByTime(100);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('asks whether the views draw the layer when it is ready, not earlier', () => {
    drawn.delete('a');
    getEventBus().emit('layer.gpu.ready', { layerId: 'a' });
    drawn.add('a');
    vi.advanceTimersByTime(100);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('cancels a pending redraw when unsubscribed', () => {
    getEventBus().emit('layer.gpu.ready', { layerId: 'a' });
    stop();
    vi.advanceTimersByTime(100);
    expect(redraw).not.toHaveBeenCalled();
    getEventBus().emit('layer.gpu.ready', { layerId: 'b' });
    vi.advanceTimersByTime(100);
    expect(redraw).not.toHaveBeenCalled();
  });
});

describe('installLayerReadyRedraw (the app wiring)', () => {
  const layer = (id: string, visible: boolean): ViewLayer => ({
    id,
    name: id,
    volumeId: `vol-${id}`,
    visible,
    opacity: 1,
    colormap: 'gray',
    intensity: [0, 1],
    threshold: [0, 0],
  });
  let forceRenderAll: ReturnType<typeof vi.fn>;
  let stop: () => void;
  let saved: ReturnType<typeof useViewStateStore.getState>['viewState'];

  beforeEach(() => {
    vi.useFakeTimers();
    resetRenderLayerScope();
    saved = useViewStateStore.getState().viewState;
    useViewStateStore.setState({
      viewState: { ...saved, layers: [layer('shown', true), layer('hidden', false)] },
    });
    forceRenderAll = vi.fn().mockResolvedValue(undefined);
    stop = installLayerReadyRedraw({ forceRenderAll });
  });

  afterEach(() => {
    stop();
    resetRenderLayerScope();
    useViewStateStore.setState({ viewState: saved });
    vi.useRealTimers();
  });

  it('redraws the current view state when a visible layer becomes resident', () => {
    getEventBus().emit('layer.gpu.ready', { layerId: 'shown' });
    vi.advanceTimersByTime(100);
    expect(forceRenderAll).toHaveBeenCalledTimes(1);
    expect(forceRenderAll.mock.calls[0][0]).toBe(useViewStateStore.getState().viewState);
  });

  it('does not redraw for a hidden layer or one outside the store', () => {
    getEventBus().emit('layer.gpu.ready', { layerId: 'hidden' });
    getEventBus().emit('layer.gpu.ready', { layerId: 'not-in-this-workspace' });
    vi.advanceTimersByTime(100);
    expect(forceRenderAll).not.toHaveBeenCalled();
  });

  it('follows a borrowed view scope (Set studio Deck)', () => {
    setRenderLayerScope('deck', ['member']);
    getEventBus().emit('layer.gpu.ready', { layerId: 'shown' });
    vi.advanceTimersByTime(100);
    expect(forceRenderAll).not.toHaveBeenCalled();
  });
});
