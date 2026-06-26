import { describe, expect, it } from 'vitest';
import {
  normalizeLateralHemisphere,
  normalizeSurfaceHemisphere,
  resolveTemplateflowSurfaceIdentity,
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
      basePath: 'templateflow://fsaverage_pial',
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
      basePath: 'templateflow://fsaverage_pial',
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

describe('surfaceGroupKey', () => {
  it('collapses left and right of the same template to one key', () => {
    const left = surfaceGroupKey('templateflow://fsaverage_pial_left');
    const right = surfaceGroupKey('templateflow://fsaverage_pial_right');
    expect(left).toBe('templateflow://fsaverage_pial');
    expect(right).toBe(left);
  });

  it('keeps different geometries in distinct keys', () => {
    expect(surfaceGroupKey('templateflow://fsaverage_white_left')).not.toBe(
      surfaceGroupKey('templateflow://fsaverage_pial_left'),
    );
  });

  it('accepts the full identity arg shape with hemisphere fallback', () => {
    expect(
      surfaceGroupKey({
        path: 'templateflow://fsaverage_inflated_hemiL',
        metadataHemisphere: 'right',
        surfaceType: 'inflated',
      }),
    ).toBe('templateflow://fsaverage_inflated');
  });

  it('returns null for ungroupable (local) surfaces', () => {
    expect(surfaceGroupKey('/tmp/lh.pial.gii')).toBeNull();
    expect(surfaceGroupKey({ path: null })).toBeNull();
  });
});
