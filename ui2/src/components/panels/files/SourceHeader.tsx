import React from 'react';
import { VscFolder, VscRemote } from 'react-icons/vsc';
import type { FileTreeNode, MountSource } from '@/types/filesystem';
import './SourceHeader.css';

interface SourceHeaderProps {
  rootNode: FileTreeNode | null;
  selectedPath: string | null;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function formatHostLabel(mountSource: MountSource): string {
  if (mountSource.user && mountSource.host) {
    if (mountSource.port && mountSource.port !== 22) {
      return `${mountSource.user}@${mountSource.host}:${mountSource.port}`;
    }
    return `${mountSource.user}@${mountSource.host}`;
  }
  if (mountSource.host) return mountSource.host;
  return mountSource.label ?? 'remote';
}

function buildBreadcrumbs(rootPath: string, selectedPath: string | null): string[] {
  if (!selectedPath || !selectedPath.startsWith(rootPath)) return [];
  const remainder = selectedPath.slice(rootPath.length).replace(/^\/+/, '');
  if (!remainder) return [];
  const parts = remainder.split('/').filter(Boolean);
  return parts.slice(0, -1);
}

export const SourceHeader: React.FC<SourceHeaderProps> = ({ rootNode, selectedPath }) => {
  if (!rootNode) return null;

  const isRemote = rootNode.mountSource?.kind === 'remote';
  const Icon = isRemote ? VscRemote : VscFolder;
  const rootLabel = rootNode.name || basename(rootNode.path);
  const remoteRoot = isRemote ? rootNode.mountSource?.remotePath ?? null : null;
  const tooltip = isRemote && rootNode.mountSource
    ? `${formatHostLabel(rootNode.mountSource)}${remoteRoot ? `:${remoteRoot}` : ''}\nLocal cache: ${rootNode.path}`
    : rootNode.path;

  const crumbs = buildBreadcrumbs(rootNode.path, selectedPath);

  return (
    <div className="fb-source-header" role="region" aria-label="Mounted source" title={tooltip}>
      <span className="fb-source-icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="fb-source-body">
        <div className="fb-source-line">
          <span className="fb-source-label">{rootLabel}</span>
          <span className={`fb-source-kind fb-source-kind--${isRemote ? 'remote' : 'local'}`}>
            {isRemote ? 'SSH' : 'LOCAL'}
          </span>
        </div>
        {(remoteRoot || crumbs.length > 0) && (
          <div className="fb-source-breadcrumb" aria-label="Path">
            {remoteRoot && <span className="fb-source-remote-path">{remoteRoot}</span>}
            {crumbs.map((segment, idx) => (
              <React.Fragment key={`${segment}-${idx}`}>
                <span className="fb-source-sep" aria-hidden="true">/</span>
                <span className="fb-source-crumb">{segment}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
