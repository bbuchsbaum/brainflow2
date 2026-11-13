import { describe, expect, it } from 'vitest';
import { imageSetOfferFromMatches } from '../searchSetOffer';
import type { FileTreeNode } from '@/types/filesystem';

const node = (path: string, type: 'file' | 'directory' = 'file') =>
  ({ id: path, path, name: path.split('/').pop()!, type, depth: 1 }) as FileTreeNode;

describe('imageSetOfferFromMatches', () => {
  it('offers the matching images of one folder, in result order', () => {
    const offer = imageSetOfferFromMatches([
      node('/mnt/group/obs/b_tfce.nii.gz'),
      node('/mnt/group/obs/a_tfce.nii'),
    ]);
    expect(offer).toEqual({
      folder: '/mnt/group/obs',
      folderName: 'obs',
      paths: ['/mnt/group/obs/b_tfce.nii.gz', '/mnt/group/obs/a_tfce.nii'],
    });
  });

  it('ignores matching folders', () => {
    const offer = imageSetOfferFromMatches([
      node('/mnt/tfce_runs', 'directory'),
      node('/mnt/obs/a_tfce.nii'),
      node('/mnt/obs/b_tfce.nii'),
    ]);
    expect(offer?.paths).toHaveLength(2);
  });

  it('offers nothing for one image or for images in several folders', () => {
    expect(imageSetOfferFromMatches([])).toBeNull();
    expect(imageSetOfferFromMatches([node('/mnt/obs/a_tfce.nii')])).toBeNull();
    expect(
      imageSetOfferFromMatches([node('/mnt/obs/a_tfce.nii'), node('/mnt/other/b_tfce.nii')]),
    ).toBeNull();
    expect(
      imageSetOfferFromMatches([node('/mnt/obs/a_tfce.nii'), node('/mnt/obs/lh_tfce.func.gii')]),
    ).toBeNull();
  });

  it('leaves matching surfaces out of the offer', () => {
    const offer = imageSetOfferFromMatches([
      node('/mnt/obs/a_tfce.nii'),
      node('/mnt/elsewhere/lh_tfce.func.gii'),
      node('/mnt/obs/b_tfce.nii.gz'),
    ]);
    expect(offer?.paths).toEqual(['/mnt/obs/a_tfce.nii', '/mnt/obs/b_tfce.nii.gz']);
  });

  it('reads Windows separators', () => {
    const offer = imageSetOfferFromMatches([
      node('C:\\data\\obs\\a_tfce.nii'),
      node('C:\\data\\obs\\b_tfce.nii'),
    ]);
    expect(offer).toMatchObject({ folder: 'C:/data/obs', folderName: 'obs' });
  });
});
