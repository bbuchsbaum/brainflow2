import { describe, expect, it } from 'vitest';
import {
  normalizeLateralHemisphere,
  normalizeSurfaceHemisphere,
  resolveTemplateflowSurfaceIdentity,
  surfaceGeometryFromPath,
  surfaceGroupKey,
} from '../surfaceIdentity';

describe('surfaceIdentity', () => {
  it('normalizes common hemisphere tokens', () => {
    expect(normalizeSurfaceHemisphere('Left')).toBe('left');
    expect(normalizeSurfaceHemisphere('lh')).toBe('left');
    expect(normalizeSurfaceHemisphere('R')).toBe('right');
    expect(normalizeSurfaceHemisphere('bilateral')).toBe('both');
    expect(normalizeSurfaceHemisphere('unknown')).toBeNull();
  });

  it('normalizes lateral hemispheres only', () => {
    expect(normalizeLateralHemisphere('right')).toBe('right');
    expect(normalizeLateralHemisphere('both')).toBeNull();
    expect(normalizeLateralHemisphere(undefined)).toBeNull();
  });

  it('resolves template identity from path and surface fields', () => {
    const identity = resolveTemplateflowSurfaceIdentity({
      path: 'templateflow://fsaverage_pial_Left',
      geometryHemisphere: 'lh',
      metadataHemisphere: 'Left',
      surfaceType: 'Pial',
    });

    expect(identity).toEqual({
      basePath: 'templateflow://fsaverage_{geometry}',
      hemisphere: 'left',
      surfaceType: 'pial',
    });
  });

  it('falls back to metadata hemisphere when path token is non-standard', () => {
    const identity = resolveTemplateflowSurfaceIdentity({
      path: 'templateflow://fsaverage_pial_hemiL',
      metadataHemisphere: 'right',
      surfaceType: 'inflated',
    });

    expect(identity).toEqual({
      basePath: 'templateflow://fsaverage_{geometry}',
      hemisphere: 'right',
      surfaceType: 'inflated',
    });
  });

  it('returns null for non-templateflow paths', () => {
    expect(
      resolveTemplateflowSurfaceIdentity({
        path: '/tmp/lh.pial.gii',
        metadataHemisphere: 'left',
      }),
    ).toBeNull();
  });
});

describe('surfaceGeometryFromPath', () => {
  it('reads the geometry a file name declares', () => {
    expect(surfaceGeometryFromPath('/s/lh.inflated.gii')).toBe('inflated');
    expect(surfaceGeometryFromPath('sub-01_hemi-L_pial.surf.gii')).toBe('pial');
    expect(surfaceGeometryFromPath('lh.wm.gii')).toBe('white');
    expect(surfaceGeometryFromPath('/pial/lh.brain.gii')).toBeNull();
  });
});

describe('surfaceGroupKey', () => {
  it('collapses left and right of the same template to one key', () => {
    const left = surfaceGroupKey('templateflow://fsaverage_pial_left');
    const right = surfaceGroupKey('templateflow://fsaverage_pial_right');
    expect(left).toBe('templateflow://fsaverage_{geometry}');
    expect(right).toBe(left);
  });

  it('puts the geometries of one template in one scene', () => {
    expect(surfaceGroupKey('templateflow://fsaverage_white_left')).toBe(
      surfaceGroupKey('templateflow://fsaverage_pial_left'),
    );
    expect(surfaceGroupKey('templateflow://fsaverage_white_left')).not.toBe(
      surfaceGroupKey('templateflow://fsaverage5_white_left'),
    );
  });

  it('puts the geometries of one subject in one scene', () => {
    const pial = surfaceGroupKey('/s/surf/lh.pial.gii');
    expect(pial).toBe('/s/surf/hemi-pair.{geometry}.gii');
    expect(surfaceGroupKey('/s/surf/rh.white.gii')).toBe(pial);
    expect(surfaceGroupKey('/s/surf/lh.inflated.gii')).toBe(pial);
    expect(surfaceGroupKey('/other/surf/lh.inflated.gii')).not.toBe(pial);
    const bids = surfaceGroupKey('/d/sub-01_hemi-L_pial.surf.gii');
    expect(bids).toBe('/d/sub-01_hemi-pair_{geometry}.surf.gii');
    expect(surfaceGroupKey('/d/sub-01_hemi-R_inflated.surf.gii')).toBe(bids);
    expect(surfaceGroupKey('/d/sub-02_hemi-R_inflated.surf.gii')).not.toBe(bids);
  });

  it('accepts the full identity arg shape with hemisphere fallback', () => {
    expect(
      surfaceGroupKey({
        path: 'templateflow://fsaverage_inflated_hemiL',
        metadataHemisphere: 'right',
        surfaceType: 'inflated',
      }),
    ).toBe('templateflow://fsaverage_{geometry}');
  });

  it('returns null for ungroupable (local) surfaces', () => {
    expect(surfaceGroupKey('/tmp/lh.pial.gii')).toBe('/tmp/hemi-pair.{geometry}.gii');
    expect(surfaceGroupKey('/tmp/brain.gii')).toBeNull();
    expect(surfaceGroupKey({ path: null })).toBeNull();
  });
});
