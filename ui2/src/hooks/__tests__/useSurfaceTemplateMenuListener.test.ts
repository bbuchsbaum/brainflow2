import { describe, expect, it } from 'vitest';
import { resolveSurfaceTemplateMenuPlacementOptions } from '../useSurfaceTemplateMenuListener';

describe('resolveSurfaceTemplateMenuPlacementOptions', () => {
  it('keeps surface template menu loads inline when the active workspace is Integrated', () => {
    expect(resolveSurfaceTemplateMenuPlacementOptions('integrated')).toEqual({
      openViewer: false,
      focusSurfacePanel: false,
    });
  });

  it('preserves standalone surface-view behavior outside Integrated', () => {
    expect(resolveSurfaceTemplateMenuPlacementOptions('orthogonal-flexible')).toBeUndefined();
    expect(resolveSurfaceTemplateMenuPlacementOptions('orthogonal-locked')).toBeUndefined();
    expect(resolveSurfaceTemplateMenuPlacementOptions('mosaic')).toBeUndefined();
    expect(resolveSurfaceTemplateMenuPlacementOptions(null)).toBeUndefined();
  });
});
