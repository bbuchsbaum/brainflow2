import React, { useMemo } from 'react';
import './FlatList.css';
import type { DragFileData, FileTreeNode } from '@/types/filesystem';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { beginFileRowDrag } from '@/utils/layerDrag';
import { inferFileType, type FileKind } from './shared/inferFileType';
import { FlatFileRow } from './FlatFileRow';
import { useRovingFocus } from '@/components/ui/bf';

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

  const rowsMemo = useMemo<FlatImageRow[]>(() => {
    if (!rootNode) return [];
    const out: FlatImageRow[] = [];
    flattenImages(rootNode.path, rootNode.children ?? [], fourDPaths, out);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rootNode, fourDPaths]);
  const rows = rowsMemo;
  const ids = useMemo(() => rows.map((r) => r.path), [rows]);
  const roving = useRovingFocus({ ids, activeId: selectedPath });

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

  function handleDragPointerDown(event: React.PointerEvent, row: FlatImageRow) {
    const extension = row.name.match(/\.[^.]+$/)?.[0];
    const dragData: DragFileData = {
      path: row.path,
      name: row.name,
      type: 'file',
      extension,
    };

    beginFileRowDrag(event, dragData);
  }

  return (
    <div
      className="fb-flat-list"
      role="listbox"
      aria-label="Imaging files"
      onKeyDown={roving.onKeyDown}
    >
      {rows.map((row) => (
        <FlatFileRow
          key={row.path}
          roving={roving.getItemProps(row.path)}
          selected={row.path === selectedPath}
          onSelect={() => selectFile(row.path)}
          info={inferFileType(row.path, false, { isFourD: row.isFourD })}
          name={row.name}
          meta={row.relativeDir || undefined}
          title={row.path}
          onDragPointerDown={(event) => handleDragPointerDown(event, row)}
        />
      ))}
    </div>
  );
};
