import type { FileTreeNode } from '@/types/filesystem';

export type FolderSource = NonNullable<
  import('@/types/studio').StudioImportDialogState['folderSource']
>;

/** Snapshot display provenance without changing the mount-backed I/O path. */
export function describeFolderSource(root: string, entries: FileTreeNode[]): FolderSource {
  const mount = entries
    .filter(
      (entry) =>
        entry.mountSource?.kind === 'remote' &&
        (root === entry.path || root.startsWith(`${entry.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  const origin = mount?.mountSource;
  if (!mount || !origin?.remotePath) return { root, displayPath: root };
  return {
    root,
    displayPath: origin.remotePath.replace(/\/$/, '') + root.slice(mount.path.length),
    label: origin.label ?? origin.host,
  };
}

export function displayFolderFile(path: string, source?: FolderSource): string {
  return source && (path === source.root || path.startsWith(`${source.root}/`))
    ? source.displayPath + path.slice(source.root.length)
    : path;
}
