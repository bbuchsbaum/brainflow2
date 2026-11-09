import { describe, expect, it } from 'vitest';
import { directoryOf, surfaceSetFromListing, templateSurfaceSet } from '../surfaceSetDiscovery';

describe('surfaceSetFromListing', () => {
  it('finds the other geometries and hemisphere of a FreeSurfer-style mesh', () => {
    const members = surfaceSetFromListing('/s/surf/lh.pial.gii', [
      '/s/surf/lh.pial.gii',
      '/s/surf/lh.white.gii',
      '/s/surf/lh.inflated.gii',
      '/s/surf/rh.pial.gii',
      '/s/surf/rh.inflated.gii',
      '/s/surf/lh.thickness.shape.gii',
      '/s/surf/lh.zstat.func.gii',
      '/s/surf/lh.brain.gii',
      '/s/surf/notes.txt',
    ]);
    expect(members.map((m) => [m.geometry, m.hemisphere])).toEqual([
      ['pial', 'left'],
      ['white', 'left'],
      ['inflated', 'left'],
      ['pial', 'right'],
      ['inflated', 'right'],
    ]);
  });

  it('keeps to one BIDS subject and space', () => {
    const members = surfaceSetFromListing('/d/sub-01_hemi-L_space-T1w_pial.surf.gii', [
      '/d/sub-01_hemi-L_space-T1w_pial.surf.gii',
      '/d/sub-01_hemi-R_space-T1w_inflated.surf.gii',
      '/d/sub-01_hemi-L_space-fsLR_inflated.surf.gii',
      '/d/sub-02_hemi-L_space-T1w_inflated.surf.gii',
    ]);
    expect(members.map((m) => m.path)).toEqual([
      '/d/sub-01_hemi-L_space-T1w_pial.surf.gii',
      '/d/sub-01_hemi-R_space-T1w_inflated.surf.gii',
    ]);
  });

  it('finds nothing for a mesh without hemisphere or geometry in its name', () => {
    expect(surfaceSetFromListing('/s/brain.gii', ['/s/brain.gii', '/s/lh.pial.gii'])).toEqual([]);
  });
});

describe('templateSurfaceSet', () => {
  it('offers the geometries TemplateFlow ships, both hemispheres', () => {
    const members = templateSurfaceSet('templateflow://fsaverage5_pial_left')!;
    expect(members.map((m) => m.path)).toEqual([
      'templateflow://fsaverage5_pial_left',
      'templateflow://fsaverage5_white_left',
      'templateflow://fsaverage5_sphere_left',
      'templateflow://fsaverage5_pial_right',
      'templateflow://fsaverage5_white_right',
      'templateflow://fsaverage5_sphere_right',
    ]);
    expect(members[4].template).toEqual({
      space: 'fsaverage5',
      geometry_type: 'white',
      hemisphere: 'right',
    });
    expect(templateSurfaceSet('/s/lh.pial.gii')).toBeNull();
  });
});

describe('directoryOf', () => {
  it('strips the file name', () => {
    expect(directoryOf('/a/b/lh.pial.gii')).toBe('/a/b');
    expect(directoryOf('C:\\a\\lh.pial.gii')).toBe('C:\\a');
    expect(directoryOf('lh.pial.gii')).toBe('');
  });
});
