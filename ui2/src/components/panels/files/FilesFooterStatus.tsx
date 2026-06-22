import React from 'react';
import { VscFolder, VscRemote, VscPin, VscHistory } from 'react-icons/vsc';
import type { FileTreeNode } from '@/types/filesystem';
import './FilesFooterStatus.css';

interface FilesFooterStatusProps {
  rootNode: FileTreeNode | null;
  recentsCount: number;
  pinnedCount: number;
}

function countFiles(nodes: FileTreeNode[] | undefined): number {
  if (!nodes) return 0;
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'file') total += 1;
    if (node.children) total += countFiles(node.children);
  }
  return total;
}

export const FilesFooterStatus: React.FC<FilesFooterStatusProps> = ({
  rootNode,
  recentsCount,
  pinnedCount,
}) => {
  if (!rootNode) return null;

  const isRemote = rootNode.mountSource?.kind === 'remote';
  const KindIcon = isRemote ? VscRemote : VscFolder;
  const fileCount = countFiles(rootNode.children);

  return (
    <div className="fb-footer-status" role="status" aria-label="Files panel status">
      <span className="fb-footer-item" title={isRemote ? 'Remote (SSH) mount' : 'Local mount'}>
        <KindIcon aria-hidden="true" /> {isRemote ? 'remote' : 'local'}
      </span>
      <span className="fb-footer-sep" aria-hidden="true">·</span>
      <span className="fb-footer-item" title={`${fileCount} neuroimaging files`}>
        {fileCount} {fileCount === 1 ? 'file' : 'files'}
      </span>
      {recentsCount > 0 && (
        <>
          <span className="fb-footer-sep" aria-hidden="true">·</span>
          <span className="fb-footer-item fb-footer-item--secondary" title="Recent locations">
            <VscHistory aria-hidden="true" /> {recentsCount}
          </span>
        </>
      )}
      {pinnedCount > 0 && (
        <>
          <span className="fb-footer-sep" aria-hidden="true">·</span>
          <span className="fb-footer-item fb-footer-item--secondary" title="Pinned locations">
            <VscPin aria-hidden="true" /> {pinnedCount}
          </span>
        </>
      )}
    </div>
  );
};
