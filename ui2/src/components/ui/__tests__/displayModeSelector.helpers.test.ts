import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_TYPE_TO_DISPLAY_MODE,
  DISPLAY_MODE_PILL_ORDER,
  resolveActiveDisplayMode,
  getDisplayModePillMetadata,
} from '../displayModeSelector.helpers';

describe('resolveActiveDisplayMode', () => {
  it('returns null for null/undefined workspace types', () => {
    expect(resolveActiveDisplayMode(null)).toBeNull();
    expect(resolveActiveDisplayMode(undefined)).toBeNull();
  });

  it('maps both orthogonal-locked and orthogonal-flexible to "orthogonal"', () => {
    expect(resolveActiveDisplayMode('orthogonal-locked')).toBe('orthogonal');
    expect(resolveActiveDisplayMode('orthogonal-flexible')).toBe('orthogonal');
  });

  it('maps mosaic, comparison, and integrated to their corresponding display modes', () => {
    expect(resolveActiveDisplayMode('mosaic')).toBe('mosaic');
    expect(resolveActiveDisplayMode('comparison')).toBe('compare');
    expect(resolveActiveDisplayMode('integrated')).toBe('integrated');
  });

  it('returns null for workspace types intentionally not on the pill rail', () => {
    expect(resolveActiveDisplayMode('set-studio')).toBeNull();
    expect(resolveActiveDisplayMode('bids-explorer')).toBeNull();
    expect(resolveActiveDisplayMode('analysis-workbench')).toBeNull();
  });
});

describe('DISPLAY_MODE_PILL_ORDER', () => {
  it('renders Orthogonal, Surface, Integrated, Mosaic, Compare in that order', () => {
    expect(DISPLAY_MODE_PILL_ORDER).toEqual([
      'orthogonal',
      'surface',
      'integrated',
      'mosaic',
      'compare',
    ]);
  });
});

describe('getDisplayModePillMetadata', () => {
  it('returns five metadata entries with stable ids in pill order', () => {
    const meta = getDisplayModePillMetadata();
    expect(meta).toHaveLength(5);
    expect(meta.map((m) => m.id)).toEqual([...DISPLAY_MODE_PILL_ORDER]);
  });

  it('marks integrated mode as flag-gated by integratedWorkspaceV1', () => {
    const integrated = getDisplayModePillMetadata().find((m) => m.id === 'integrated');
    expect(integrated?.featureFlag).toBe('integratedWorkspaceV1');
  });

  it('leaves surface mode without a default workspace type (renders disabled)', () => {
    const surface = getDisplayModePillMetadata().find((m) => m.id === 'surface');
    expect(surface?.defaultWorkspaceType).toBeNull();
  });
});

describe('WORKSPACE_TYPE_TO_DISPLAY_MODE map', () => {
  it('does not include set-studio / bids-explorer / analysis-workbench (mode pills are visualization-only)', () => {
    expect(WORKSPACE_TYPE_TO_DISPLAY_MODE['set-studio' as never]).toBeUndefined();
    expect(WORKSPACE_TYPE_TO_DISPLAY_MODE['bids-explorer' as never]).toBeUndefined();
    expect(WORKSPACE_TYPE_TO_DISPLAY_MODE['analysis-workbench' as never]).toBeUndefined();
  });
});
