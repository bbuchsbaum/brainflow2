import { describe, expect, it } from 'vitest';
import {
  normalizeLateralHemisphere,
  normalizeSurfaceHemisphere,
  resolveTemplateflowSurfaceIdentity,
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
      })
    ).toBeNull();
  });
});
