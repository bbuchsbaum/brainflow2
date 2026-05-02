import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileBrowserPanel } from '../FileBrowserPanel';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode, MountSource } from '@/types/filesystem';

vi.mock('react-arborist', () => ({
  Tree: ({ data, children }: any) => {
    const renderNode = (item: any, level: number) => {
      const node = {
        data: item,
        isOpen: true,
        isInternal: item.type === 'directory',
        level,
        toggle: vi.fn(),
      };

      return (
        <React.Fragment key={item.id}>
          {children({ node, style: {}, dragHandle: undefined })}
          {Array.isArray(item.children)
            ? item.children.map((child: any) => renderNode(child, level + 1))
            : null}
        </React.Fragment>
      );
    };

    return <div data-testid="mock-tree">{data.map((item: any) => renderNode(item, 0))}</div>;
  },
}));

vi.mock('../RemoteMountDialog', () => ({
  RemoteMountDialog: () => null,
}));

function makeRootNode(
  path: string,
  mountSource: MountSource,
  children: FileTreeNode[] = []
): FileTreeNode {
  return {
    id: path,
    name: 'mounted-root',
    path,
    type: 'directory',
    depth: 0,
    expanded: true,
    mountSource,
    children,
    modified: new Date(),
  };
}

function resetStore(entries: FileTreeNode[]) {
  useFileBrowserStore.setState({
    currentPath: entries[0]?.path ?? '',
    rootPath: entries[0]?.path ?? '',
    entries,
    expandedPaths: new Set(entries.map((entry) => entry.path)),
    selectedPath: null,
    loading: false,
    error: null,
    searchQuery: '',
    searchResults: [],
    showHidden: false,
    sortBy: 'name',
    sortOrder: 'asc',
  });
}

describe('FileBrowserPanel remote origin indicator', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  it('shows the remote origin indicator only on the mounted root row', () => {
    const remoteRoot = '/tmp/brainflow/mounts/mount-remote-1';
    resetStore([
      makeRootNode(
        remoteRoot,
        {
          kind: 'remote',
          label: 'alice@login.example.org:/data/study',
          mountId: 'mount-remote-1',
          host: 'login.example.org',
          port: 2222,
          user: 'alice',
          remotePath: '/data/study',
        },
        [
          {
            id: `${remoteRoot}/child`,
            name: 'child-folder',
            path: `${remoteRoot}/child`,
            type: 'directory',
            depth: 1,
            expanded: true,
            children: [
              {
                id: `${remoteRoot}/child/brain.nii.gz`,
                name: 'brain.nii.gz',
                path: `${remoteRoot}/child/brain.nii.gz`,
                type: 'file',
                depth: 2,
                size: 1024,
              },
            ],
          },
        ]
      ),
    ]);

    const { container } = render(<FileBrowserPanel />);

    const originBadges = container.querySelectorAll('.remote-origin-badge');
    const rootBadges = container.querySelectorAll('.remote-root-badge');

    expect(originBadges).toHaveLength(1);
    expect(rootBadges).toHaveLength(1);
    expect(screen.getByText('alice@login.example.org:2222')).toBeInTheDocument();
    expect(originBadges[0]).toHaveAttribute('title', 'ssh://alice@login.example.org:2222/data/study');
    expect(rootBadges[0]).toHaveAttribute('title', 'Remote root: /data/study');
    expect(screen.getByText('child-folder')).toBeInTheDocument();
    expect(screen.getByText('brain.nii.gz')).toBeInTheDocument();
  });
});
