import React, { useMemo } from 'react';
import type { FileTreeNode } from '@/types/filesystem';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { inferFileType, type FileKind } from './shared/inferFileType';
import { FileTypeBadge } from './shared/FileTypeBadge';

interface ImagesViewProps {
  rootNode: FileTreeNode | null;
  selectedPath: string | null;
}

const IMAGE_KINDS: ReadonlySet<FileKind> = new Set([
  'nii',
  'niiGz',
  'fourDNii',
  'gii',
  'surfGii',
  'funcGii',
  'mgz',
  'mgh',
  'dicom',
  'analyze',
]);

interface FlatImageRow {
  path: string;
  name: string;
  relativeDir: string;
  isFourD: boolean;
}

function flattenImages(
  rootPath: string,
  nodes: FileTreeNode[] | undefined,
  fourDPaths: Set<string>,
  out: FlatImageRow[]
) {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type === 'file') {
      const info = inferFileType(node.path, false);
      if (IMAGE_KINDS.has(info.kind)) {
        const relativePath = node.path.startsWith(rootPath)
          ? node.path.slice(rootPath.length).replace(/^\/+/, '')
          : node.path;
        const lastSlash = relativePath.lastIndexOf('/');
        const relativeDir = lastSlash >= 0 ? relativePath.slice(0, lastSlash) : '';
        out.push({
          path: node.path,
          name: node.name,
          relativeDir,
          isFourD: fourDPaths.has(node.path),
        });
      }
    }
    if (node.children) {
      flattenImages(rootPath, node.children, fourDPaths, out);
    }
  }
}

export const ImagesView: React.FC<ImagesViewProps> = ({ rootNode, selectedPath }) => {
  const fourDPaths = useFileBrowserStore((state) => state.fourDPaths);
  const selectFile = useFileBrowserStore((state) => state.selectFile);

  const rows = useMemo<FlatImageRow[]>(() => {
    if (!rootNode) return [];
    const out: FlatImageRow[] = [];
    flattenImages(rootNode.path, rootNode.children ?? [], fourDPaths, out);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rootNode, fourDPaths]);

  if (!rootNode) {
    return null;
  }

  if (rows.length === 0) {
    return (
      <div className="fb-flat-empty" role="status">
        <p className="fb-flat-empty-kicker">No imaging files</p>
        <p className="fb-flat-empty-message">
          Expand directories in the Tree view to populate this list, or mount a folder
          that contains NIfTI/GIfTI/MGZ/DICOM files.
        </p>
      </div>
    );
  }

  return (
    <ul className="fb-flat-list" role="list">
      {rows.map((row) => {
        const info = inferFileType(row.path, false, { isFourD: row.isFourD });
        const isSelected = row.path === selectedPath;
        return (
          <li key={row.path}>
            <button
              type="button"
              className={`fb-flat-row${isSelected ? ' is-selected' : ''}`}
              onClick={() => selectFile(row.path)}
              title={row.path}
            >
              <FileTypeBadge info={info} />
              <span className="fb-flat-row-name">{row.name}</span>
              {row.relativeDir && (
                <span className="fb-flat-row-dir">{row.relativeDir}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
