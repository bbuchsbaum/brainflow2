import { describe, expect, it } from 'vitest';
import { describeFolderSource, displayFolderFile } from '../folderSource';
import { selectedStudioFolder } from '../SetStudioService';
import type { FileTreeNode } from '@/types/filesystem';
const root: FileTreeNode = {
  id: 'mount',
  name: 'trillium',
  path: '/cache/mount',
  type: 'directory',
  depth: 0,
  mountSource: { kind: 'remote', host: 'trillium', remotePath: '/scratch/brad' },
  children: [{ id: 'full', name: 'full', path: '/cache/mount/full', type: 'directory', depth: 1 }],
};
describe('folder source handoff', () => {
  it('snapshots remote display provenance without changing the mounted I/O path', () => {
    const source = describeFolderSource('/cache/mount/full', [root]);
    expect(source).toEqual({
      root: '/cache/mount/full',
      displayPath: '/scratch/brad/full',
      label: 'trillium',
    });
    expect(displayFolderFile('/cache/mount/full/1001/rsa.nii.gz', source)).toBe(
      '/scratch/brad/full/1001/rsa.nii.gz',
    );
    expect(displayFolderFile('/cache/mount/full-other/file.nii', source)).toBe(
      '/cache/mount/full-other/file.nii',
    );
  });
  it('does not substitute a mount root for an absent selected folder', () => {
    expect(selectedStudioFolder([root], '/cache/mount/full')?.path).toBe('/cache/mount/full');
    expect(selectedStudioFolder([root], '/cache/mount/unknown')).toBeNull();
    expect(selectedStudioFolder([root], null)).toBeNull();
    expect(describeFolderSource('/cache/mount-other', [root]).displayPath).toBe(
      '/cache/mount-other',
    );
  });
});
