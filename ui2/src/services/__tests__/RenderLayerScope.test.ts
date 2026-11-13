import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState } from '@/types/viewState';
import {
  applyRenderLayerScope,
  getRenderLayerScopeRevision,
  resetRenderLayerScope,
  setRenderLayerScope,
  subscribeRenderLayerScope,
} from '@/services/render/RenderLayerScope';

const scene = (...ids: string[]) => ({ layers: ids.map((id) => ({ id })) }) as unknown as ViewState;
const drawn = (viewState: ViewState) => applyRenderLayerScope(viewState).layers.map((l) => l.id);

describe('RenderLayerScope order', () => {
  beforeEach(resetRenderLayerScope);

  it('draws the scope bottom first, whatever order the workspace stacks its layers in', () => {
    // The workspace has the template above the member.
    const workspace = scene('t1', 'member', 'template');
    setRenderLayerScope('deck', ['template', 'member']);
    expect(drawn(workspace)).toEqual(['template', 'member']);
    expect(drawn(scene('template', 'other', 'member'))).toEqual(['template', 'member']);
  });

  it('leaves out scope layers the workspace does not have, and repeats none', () => {
    setRenderLayerScope('deck', ['template', 'member', 'template']);
    expect(drawn(scene('member'))).toEqual(['member']);
    expect(drawn(scene('member', 'template'))).toEqual(['template', 'member']);
  });

  it('notifies for a change of order, not for the same scope again', () => {
    const listener = vi.fn();
    subscribeRenderLayerScope(listener);
    setRenderLayerScope('deck', ['template', 'member']);
    const revision = getRenderLayerScopeRevision();
    setRenderLayerScope('deck', ['template', 'member']);
    expect(getRenderLayerScopeRevision()).toBe(revision);
    expect(listener).toHaveBeenCalledTimes(1);
    setRenderLayerScope('deck', ['member', 'template']);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(drawn(scene('template', 'member'))).toEqual(['member', 'template']);
  });
});
