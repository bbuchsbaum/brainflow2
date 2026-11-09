import React from 'react';
import { VscFolder, VscRemote, VscPin, VscHistory } from 'react-icons/vsc';
import type { FileTreeNode } from '@/types/filesystem';
import { useRemoteMountStore, isPrefetchActive } from '@/stores/remoteMountStore';
import { formatBytes } from '@/services/RemoteMountService';
import { stopMakingAvailableOffline } from '@/services/remoteMountActions';
import { Button } from '@/components/ui/bf';
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
  const prefetchJobs = useRemoteMountStore((state) => state.prefetchJobs);
  const remoteMountId =
    rootNode?.mountSource?.kind === 'remote' ? rootNode.mountSource.mountId : undefined;
  const connection = useRemoteMountStore((state) =>
    remoteMountId ? state.statuses[remoteMountId]?.state : undefined
  );
  if (!rootNode) return null;

  const activeJobs = Object.values(prefetchJobs).filter(isPrefetchActive);
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
      {connection === 'disconnected' && (
        <>
          <span className="fb-footer-sep" aria-hidden="true">·</span>
          <span
            className="fb-footer-item fb-footer-item--offline"
            title="The server cannot be reached. Folders you visited and files you downloaded still open."
          >
            offline
          </span>
        </>
      )}
      {activeJobs.map((job) => {
        const folder = job.folder.split(/[\\/]/).filter(Boolean).pop() || job.folder;
        const detail =
          job.state === 'scanning'
            ? 'finding files…'
            : `${job.files_done}/${job.files_total}` +
              (job.bytes_total > 0 ? ` · ${formatBytes(job.bytes_done)} of ${formatBytes(job.bytes_total)}` : '');
        return (
          <React.Fragment key={job.job_id}>
            <span className="fb-footer-sep" aria-hidden="true">·</span>
            <span
              className="fb-footer-item fb-footer-item--job"
              title={`Making ${folder} available offline${job.current ? ` (${job.current})` : ''}`}
            >
              offline copy of {folder}: {detail}
            </span>
            <Button
              variant="link"
              size="sm"
              className="fb-footer-action"
              onClick={() => void stopMakingAvailableOffline(job.job_id)}
            >
              Stop
            </Button>
          </React.Fragment>
        );
      })}
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
