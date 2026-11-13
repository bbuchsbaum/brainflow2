import type { FileTreeNode } from '@/types/filesystem';

export interface SearchSetOffer {
  folder: string;
  folderName: string;
  /** The matching images, in result order. */
  paths: string[];
}

const parentOf = (path: string) => path.replace(/\\/g, '/').replace(/\/[^/]*$/, '');

/**
 * The Files search can open its matches as an image set only when that is
 * unambiguous: the matching NIfTI images all sit directly in one folder.
 * Matching folders and other files (surfaces) are ignored, since a set holds
 * only volumes; a single image is not a set.
 */
export function imageSetOfferFromMatches(matches: readonly FileTreeNode[]): SearchSetOffer | null {
  const files = matches.filter(
    (node) => node.type === 'file' && /\.nii(\.gz)?$/i.test(node.name),
  );
  if (files.length < 2) return null;
  const folder = parentOf(files[0].path);
  if (!folder || !files.every((node) => parentOf(node.path) === folder)) return null;
  return {
    folder,
    folderName: folder.split('/').pop() || folder,
    paths: files.map((node) => node.path),
  };
}
