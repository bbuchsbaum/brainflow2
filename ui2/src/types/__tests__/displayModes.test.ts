import { describe, expect, it } from 'vitest';
import {
  DISPLAY_MODES,
  DISPLAY_MODE_LIST,
  getDisplayMode,
  type DisplayMode,
} from '@/types/displayModes';

describe('display modes', () => {
  it('covers the five PRD-required modes', () => {
    const expected: DisplayMode[] = ['orthogonal', 'surface', 'integrated', 'mosaic', 'compare'];
    expect(Object.keys(DISPLAY_MODES).sort()).toEqual([...expected].sort());
    expect(DISPLAY_MODE_LIST.map((m) => m.id)).toEqual(expected);
  });

  it('binds modes that have an existing workspace implementation', () => {
    expect(DISPLAY_MODES.orthogonal.defaultWorkspaceType).toBe('orthogonal-locked');
    expect(DISPLAY_MODES.mosaic.defaultWorkspaceType).toBe('mosaic');
    expect(DISPLAY_MODES.compare.defaultWorkspaceType).toBe('comparison');
    expect(DISPLAY_MODES.integrated.defaultWorkspaceType).toBe('integrated');
  });

  it('leaves Surface unbound until a surface workspace is implemented', () => {
    expect(DISPLAY_MODES.surface.defaultWorkspaceType).toBeNull();
  });

  it('gates Integrated behind the integrated-workspace-v1 feature flag', () => {
    expect(DISPLAY_MODES.integrated.featureFlag).toBe('integratedWorkspaceV1');
    expect(DISPLAY_MODES.orthogonal.featureFlag).toBeUndefined();
    expect(DISPLAY_MODES.mosaic.featureFlag).toBeUndefined();
    expect(DISPLAY_MODES.compare.featureFlag).toBeUndefined();
  });

  it('looks up modes by id', () => {
    expect(getDisplayMode('integrated').label).toBe('Integrated');
  });
});
