import { describe, expect, it } from 'vitest';
import type { LoadedSurface } from '@/stores/surfaceStore';
import { collectRenderSurfaces } from '../surfaceRenderSurfaces';

function createSurface(
  handle: string,
  path: string,
  hemisphere: 'left' | 'right' | 'both',
  surfaceType: 'pial' | 'white' | 'inflated' = 'pial',
): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere,
      surfaceType,
    },
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere,
      surfaceType,
      path,
    },
  };
}

describe('collectRenderSurfaces', () => {
  it('returns only the active surface for non-template paths', () => {
    const left = createSurface('lh', '/tmp/lh.pial.gii', 'left');
    const surfaces = new Map<string, LoadedSurface>([['lh', left]]);

    const result = collectRenderSurfaces(surfaces, 'lh');
    expect(result.map((item) => item.handle)).toEqual(['lh']);
  });

  it('pairs local hemispheres without mixing subjects or geometry types', () => {
    const surfaces = new Map([
      ['left', createSurface('left', '/subject-a/lh.pial.gii', 'left')],
      ['right', createSurface('right', '/subject-a/rh.pial.gii', 'right')],
      ['other', createSurface('other', '/subject-b/rh.pial.gii', 'right')],
      ['white', createSurface('white', '/subject-a/rh.white.gii', 'right', 'white')],
    ]);
    expect(collectRenderSurfaces(surfaces, 'left').map(s => s.handle)).toEqual(['left', 'right']);
  });

  it('returns template-flow hemisphere pair when available', () => {
    const left = createSurface('lh', 'templateflow://fsaverage_pial_left', 'left', 'pial');
    const right = createSurface('rh', 'templateflow://fsaverage_pial_right', 'right', 'pial');
    const other = createSurface(
      'inflated-lh',
      'templateflow://fsaverage_inflated_left',
      'left',
      'inflated',
    );

    const surfaces = new Map<string, LoadedSurface>([
      ['inflated-lh', other],
      ['rh', right],
      ['lh', left],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh');
    expect(result.map((item) => item.handle)).toEqual(['lh', 'rh']);
  });

  it('falls back to active surface when pair is missing', () => {
    const right = createSurface('rh', 'templateflow://fsaverage_pial_right', 'right', 'pial');
    const surfaces = new Map<string, LoadedSurface>([['rh', right]]);

    const result = collectRenderSurfaces(surfaces, 'rh');
    expect(result.map((item) => item.handle)).toEqual(['rh']);
  });

  it('excludes hidden hemisphere from template pair', () => {
    const left = createSurface('lh', 'templateflow://fsaverage_pial_left', 'left', 'pial');
    const right = createSurface('rh', 'templateflow://fsaverage_pial_right', 'right', 'pial');
    right.visible = false;

    const surfaces = new Map<string, LoadedSurface>([
      ['lh', left],
      ['rh', right],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh');
    expect(result.map((item) => item.handle)).toEqual(['lh']);
  });

  it('falls back to first visible surface when active is hidden', () => {
    const left = createSurface('lh', 'templateflow://fsaverage_pial_left', 'left', 'pial');
    left.visible = false;

    const right = createSurface('rh', 'templateflow://fsaverage_pial_right', 'right', 'pial');

    const surfaces = new Map<string, LoadedSurface>([
      ['lh', left],
      ['rh', right],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh');
    expect(result.map((item) => item.handle)).toEqual(['rh']);
  });

  it('pairs hemispheres even when surface types differ', () => {
    const leftInflated = createSurface(
      'lh-inflated',
      'templateflow://fsaverage_inflated_left',
      'left',
      'inflated',
    );
    const rightPial = createSurface(
      'rh-pial',
      'templateflow://fsaverage_inflated_right',
      'right',
      'pial',
    );

    const surfaces = new Map<string, LoadedSurface>([
      ['lh-inflated', leftInflated],
      ['rh-pial', rightPial],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh-inflated');
    expect(result.map((item) => item.handle)).toEqual(['lh-inflated', 'rh-pial']);
  });

  it('prefers active-hemisphere surface when duplicates exist', () => {
    const leftPial = createSurface('lh-pial', 'templateflow://fsaverage_pial_left', 'left', 'pial');
    const leftInflated = createSurface(
      'lh-inflated',
      'templateflow://fsaverage_pial_left',
      'left',
      'inflated',
    );
    const rightPial = createSurface(
      'rh-pial',
      'templateflow://fsaverage_pial_right',
      'right',
      'pial',
    );

    const surfaces = new Map<string, LoadedSurface>([
      ['lh-pial', leftPial],
      ['lh-inflated', leftInflated],
      ['rh-pial', rightPial],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh-inflated');
    expect(result.map((item) => item.handle)).toEqual(['lh-inflated', 'rh-pial']);
  });

  it('pairs hemispheres when template path uses capitalized tokens', () => {
    const left = createSurface('lh', 'templateflow://fsaverage_pial_Left', 'left', 'pial');
    const right = createSurface('rh', 'templateflow://fsaverage_pial_Right', 'right', 'pial');

    const surfaces = new Map<string, LoadedSurface>([
      ['lh', left],
      ['rh', right],
    ]);

    const result = collectRenderSurfaces(surfaces, 'lh');
    expect(result.map((item) => item.handle)).toEqual(['lh', 'rh']);
  });

  describe('group-scoped (standalone tab)', () => {
    function mixedGroups(): Map<string, LoadedSurface> {
      return new Map<string, LoadedSurface>([
        ['pial-lh', createSurface('pial-lh', 'templateflow://fsaverage_pial_left', 'left', 'pial')],
        [
          'pial-rh',
          createSurface('pial-rh', 'templateflow://fsaverage_pial_right', 'right', 'pial'),
        ],
        [
          'white-lh',
          createSurface('white-lh', 'templateflow://fsaverage_white_left', 'left', 'white'),
        ],
        [
          'white-rh',
          createSurface('white-rh', 'templateflow://fsaverage_white_right', 'right', 'white'),
        ],
      ]);
    }

    it('renders only the pinned group, ignoring other loaded groups', () => {
      const result = collectRenderSurfaces(
        mixedGroups(),
        'pial-lh',
        'templateflow://fsaverage_pial',
      );
      expect(result.map((item) => item.handle)).toEqual(['pial-lh', 'pial-rh']);
    });

    it('stays pinned to its group even when the active anchor is in another group', () => {
      // Globally-active surface is white, but this tab is pinned to pial.
      const result = collectRenderSurfaces(
        mixedGroups(),
        'white-lh',
        'templateflow://fsaverage_pial',
      );
      expect(result.map((item) => item.handle)).toEqual(['pial-lh', 'pial-rh']);
    });

    it('without a group key keeps global anchor pairing (Integrated pane)', () => {
      const result = collectRenderSurfaces(mixedGroups(), 'white-lh');
      expect(result.map((item) => item.handle)).toEqual(['white-lh', 'white-rh']);
    });
  });
});
