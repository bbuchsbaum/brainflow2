import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Tree } from 'react-arborist';
import { VscFolder } from 'react-icons/vsc';
import './FileBrowserPanel.css';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode } from '@/types/filesystem';
import { getEventBus } from '@/events/EventBus';
import type { DisplayOpenIntent } from '@/types/loadIntent';
import { getTransport } from '@/services/transport';
import {
  mountConnectedRemoteDirectory,
  type ConnectedRemoteMount,
} from '@/services/RemoteMountService';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { PanelHeader } from '@/components/ui/PanelHeader';
import { RemoteMountDialog } from './RemoteMountDialog';
import { FileTreeRow, type FileNodeData } from './files/FileTreeRow';
import { FilesStartPanel } from './files/FilesStartPanel';
import { SourceHeader } from './files/SourceHeader';
import { FilterBar } from './files/FilterBar';
import { SelectedFileSummary } from './files/SelectedFileSummary';
import { FilesFooterStatus } from './files/FilesFooterStatus';
import { ViewModeTabs } from './files/ViewModeTabs';
import { ImagesView } from './files/ImagesView';
import { LoadedView } from './files/LoadedView';
import { BidsView } from './files/BidsView';

const FileBrowserPanelContent: React.FC = () => {
  const fileBrowserStore = useFileBrowserStore();
  const [searchInput, setSearchInput] = useState('');
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [mountActionError, setMountActionError] = useState<string | null>(null);
  const [mountActionPending, setMountActionPending] = useState(false);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Reactive values from store
  const currentPath = useFileBrowserStore((state) => state.currentPath);
  const rootPath = useFileBrowserStore((state) => state.rootPath);
  const entries = useFileBrowserStore((state) => state.entries);
  const loading = useFileBrowserStore((state) => state.loading);
  const error = useFileBrowserStore((state) => state.error);
  const searchQuery = useFileBrowserStore((state) => state.searchQuery);
  const searchResults = useFileBrowserStore((state) => state.searchResults);
  const sortBy = useFileBrowserStore((state) => state.sortBy);
  const sortOrder = useFileBrowserStore((state) => state.sortOrder);
  const selectedPath = useFileBrowserStore((state) => state.selectedPath);
  const recentsCount = useFileBrowserStore((state) => state.recents.length);
  const pinnedCount = useFileBrowserStore((state) => state.pinned.length);
  const viewMode = useFileBrowserStore((state) => state.viewMode);
  const setViewMode = useFileBrowserStore((state) => state.setViewMode);
  const pinLocation = useFileBrowserStore((state) => state.pinLocation);
  const unpinLocation = useFileBrowserStore((state) => state.unpinLocation);
  const isPinned = useFileBrowserStore((state) => state.isPinned);

  const selectedRootMount = useMemo(() => {
    if (!selectedPath) return null;
    return (
      entries.find(
        (entry) => selectedPath === entry.path || selectedPath.startsWith(`${entry.path}/`)
      ) ?? null
    );
  }, [entries, selectedPath]);

  const rootNode = useMemo<FileTreeNode | null>(() => {
    if (entries.length === 0) return null;
    if (selectedRootMount) return selectedRootMount;
    return entries[0];
  }, [entries, selectedRootMount]);

  const selectedFileNode = useMemo<FileTreeNode | null>(() => {
    if (!selectedPath) return null;
    const visit = (nodes: FileTreeNode[]): FileTreeNode | null => {
      for (const node of nodes) {
        if (node.path === selectedPath) return node;
        if (node.children) {
          const found = visit(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(entries);
  }, [entries, selectedPath]);

  // Handle container resize
  useEffect(() => {
    if (!treeContainerRef.current) return;

    const rect = treeContainerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setTreeSize({ width: rect.width, height: rect.height });
    }

    const resizeObserver = new ResizeObserver((observed) => {
      for (const entry of observed) {
        const { width, height } = entry.contentRect;
        setTreeSize({ width, height });
      }
    });

    resizeObserver.observe(treeContainerRef.current);

    const timeoutId = setTimeout(() => {
      if (treeContainerRef.current) {
        const r = treeContainerRef.current.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (treeSize.width === 0 || treeSize.height === 0)) {
          setTreeSize({ width: r.width, height: r.height });
        }
      }
    }, 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  // Convert entries to format expected by react-arborist
  const treeData = useMemo(() => {
    const convertToTreeData = (nodes: FileTreeNode[]): FileNodeData[] => {
      return nodes.map((node) => ({
        id: node.id,
        name: node.name,
        path: node.path,
        type: node.type,
        size: node.size,
        extension: node.extension,
        modified: node.modified,
        mountSource: node.mountSource,
        children: node.children ? convertToTreeData(node.children) : undefined,
      }));
    };

    const data = searchQuery ? searchResults : entries;
    return convertToTreeData(data);
  }, [entries, searchResults, searchQuery]);

  function handleSearchInput(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setSearchInput(value);
    fileBrowserStore.setSearchQuery(value);
  }

  function clearSearch() {
    setSearchInput('');
    fileBrowserStore.clearSearch();
  }

  async function openMountDialog() {
    if (mountActionPending) return;
    setMountActionPending(true);
    setMountActionError(null);
    try {
      await getTransport().invoke<void>('open_mount_dialog');
    } catch (err) {
      console.error('Failed to open mount dialog:', err);
      setMountActionError('Could not open folder picker. Use File > Mount Directory…');
    } finally {
      setMountActionPending(false);
    }
  }

  async function openFileDialog() {
    if (mountActionPending) return;
    setMountActionPending(true);
    setMountActionError(null);
    try {
      await getTransport().invoke<void>('open_file_dialog');
    } catch (err) {
      console.error('Failed to open file dialog:', err);
      setMountActionError('Could not open file picker. Please try again.');
    } finally {
      setMountActionPending(false);
    }
  }

  function openRemoteMountDialog() {
    setMountActionError(null);
    setRemoteDialogOpen(true);
  }

  async function handleRemoteMounted(mount: ConnectedRemoteMount) {
    await mountConnectedRemoteDirectory(mount);
  }

  async function unmountSelectedRoot() {
    if (!selectedRootMount || mountActionPending) return;

    setMountActionPending(true);
    setMountActionError(null);

    try {
      if (
        selectedRootMount.mountSource?.kind === 'remote' &&
        selectedRootMount.mountSource.mountId
      ) {
        await getTransport().invoke('remote_mount_unmount', {
          mountId: selectedRootMount.mountSource.mountId,
          purgeCache: false,
        });
      }

      fileBrowserStore.unmountDirectory(selectedRootMount.path);
      if (
        selectedPath &&
        (selectedPath === selectedRootMount.path ||
          selectedPath.startsWith(`${selectedRootMount.path}/`))
      ) {
        fileBrowserStore.selectFile(null);
      }
    } catch (unmountError) {
      console.error('Failed to unmount selected root:', unmountError);
      setMountActionError(
        unmountError instanceof Error ? unmountError.message : 'Failed to unmount selected root.'
      );
    } finally {
      setMountActionPending(false);
    }
  }

  function pinSelectedRoot() {
    if (!selectedRootMount) return;
    pinLocation({
      id: selectedRootMount.path,
      label: selectedRootMount.name,
      path: selectedRootMount.path,
      mountSource: selectedRootMount.mountSource ?? { kind: 'local' },
    });
  }

  function unpinSelectedRoot() {
    if (!selectedRootMount) return;
    unpinLocation(selectedRootMount.path);
  }

  function handleNoResultsReset() {
    clearSearch();
    setMountActionError(null);
  }

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isEditable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target?.getAttribute('contenteditable') === 'true';

    const meta = event.metaKey || event.ctrlKey;

    // ⌘O / Ctrl+O — open mount dialog. Always honored, even from the search box.
    if (meta && (event.key === 'o' || event.key === 'O')) {
      event.preventDefault();
      void openMountDialog();
      return;
    }

    if (isEditable) return;

    // ⌘⌫ / Ctrl+Backspace — unmount the selected root.
    if (meta && (event.key === 'Backspace' || event.key === 'Delete')) {
      if (selectedRootMount) {
        event.preventDefault();
        void unmountSelectedRoot();
      }
      return;
    }

    const selectedFile = selectedFileNode;
    if (!selectedFile || selectedFile.type !== 'file' || !selectedPath) return;

    // Enter on selected file → default load.
    if (event.key === 'Enter') {
      event.preventDefault();
      getEventBus().emit('filebrowser.file.open', {
        path: selectedPath,
        intent: 'default' as DisplayOpenIntent,
      });
      return;
    }

    // Space → preview-only. The summary card already renders for the
    // current selection; this just prevents the page from scrolling and
    // re-affirms selection so the probe re-fires.
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      fileBrowserStore.selectFile(selectedPath);
    }
  }

  const hasMountedDirectory = rootPath.trim().length > 0 || entries.length > 0;
  const isSearchEmptyState = searchQuery.trim().length > 0 && hasMountedDirectory;
  const refreshTargetPath = currentPath || rootPath;
  const canRefresh = refreshTargetPath.trim().length > 0;
  const shortcutLabel = useMemo(
    () => (navigator.platform.toLowerCase().includes('mac') ? 'Cmd+O' : 'Ctrl+O'),
    []
  );
  const selectedRootIsPinned = selectedRootMount ? isPinned(selectedRootMount.path) : false;

  return (
    <div className="file-browser-panel" onKeyDown={handlePanelKeyDown} tabIndex={-1}>
      <PanelHeader
        title="Files"
        icon={<VscFolder className="h-4 w-4" />}
        hideTitle={true}
        primaryAction={
          hasMountedDirectory
            ? {
                label: 'Mount',
                onClick: () => {
                  void openMountDialog();
                },
                disabled: mountActionPending,
                title: 'Mount directory',
              }
            : undefined
        }
        overflowActions={[
          {
            id: 'mount-local',
            label: 'Mount Directory…',
            onClick: () => {
              void openMountDialog();
            },
            disabled: mountActionPending,
          },
          {
            id: 'mount-remote',
            label: 'Mount Remote (SSH)…',
            onClick: openRemoteMountDialog,
            disabled: mountActionPending,
          },
          {
            id: 'unmount-selected',
            label: 'Unmount Selected',
            onClick: () => {
              void unmountSelectedRoot();
            },
            disabled: mountActionPending || !selectedRootMount,
            danger: true,
          },
          {
            id: 'pin-selected',
            label: selectedRootIsPinned ? 'Unpin Selected' : 'Pin Selected',
            onClick: () => {
              if (selectedRootIsPinned) unpinSelectedRoot();
              else pinSelectedRoot();
            },
            disabled: !selectedRootMount,
          },
          {
            id: 'open-file',
            label: 'Open File…',
            onClick: () => {
              void openFileDialog();
            },
            disabled: mountActionPending,
          },
          {
            id: 'refresh',
            label: 'Refresh Directory',
            onClick: () => {
              if (!canRefresh) return;
              void fileBrowserStore.refreshDirectory(refreshTargetPath);
            },
            disabled: mountActionPending || !canRefresh,
          },
          {
            id: 'clear-search',
            label: 'Clear Search',
            onClick: handleNoResultsReset,
            disabled: searchQuery.trim().length === 0,
          },
        ]}
      />

      {hasMountedDirectory && (
        <SourceHeader rootNode={rootNode} selectedPath={selectedPath} />
      )}

      {hasMountedDirectory && (
        <ViewModeTabs value={viewMode} onChange={setViewMode} />
      )}

      {hasMountedDirectory && viewMode === 'tree' && (
        <FilterBar
          searchInput={searchInput}
          searchQuery={searchQuery}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSearchChange={handleSearchInput}
          onClearSearch={clearSearch}
          onSortByChange={(value) => fileBrowserStore.setSortBy(value)}
          onToggleSortOrder={() =>
            fileBrowserStore.setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
          }
        />
      )}

      {mountActionError && hasMountedDirectory && (
        <div className="fb-inline-error" role="status">
          {mountActionError}
        </div>
      )}

      <div className="tree-container">
        {loading && treeData.length === 0 ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span className="loading-text">Loading directory...</span>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠️</div>
            <div className="error-title">Error loading directory</div>
            <div className="error-message">{error}</div>
            <button
              type="button"
              className="retry-button"
              onClick={() => void fileBrowserStore.refreshDirectory(currentPath)}
            >
              Retry
            </button>
          </div>
        ) : !hasMountedDirectory ? (
          <FilesStartPanel
            shortcutLabel={shortcutLabel}
            pending={mountActionPending}
            errorMessage={mountActionError}
            onMountLocal={() => {
              void openMountDialog();
            }}
            onMountRemote={openRemoteMountDialog}
            onOpenFile={() => {
              void openFileDialog();
            }}
          />
        ) : viewMode === 'images' ? (
          <ImagesView rootNode={rootNode} selectedPath={selectedPath} />
        ) : viewMode === 'loaded' ? (
          <LoadedView />
        ) : viewMode === 'bids' ? (
          <BidsView rootNode={rootNode} />
        ) : isSearchEmptyState && treeData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-card">
              <p className="empty-state-kicker">No Matching Files</p>
              <p className="empty-state-message">
                No neuroimaging files match your current search. Reset search or mount another folder.
              </p>
              <div className="empty-state-actions">
                <button
                  type="button"
                  className="empty-state-button secondary"
                  onClick={handleNoResultsReset}
                >
                  Clear Search
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={treeContainerRef}
            style={{ width: '100%', height: '100%', position: 'relative' }}
          >
            {(treeSize.width > 0 && treeSize.height > 0) || treeData.length > 0 ? (
              <Tree
                key={`tree-v2-${entries.length}`}
                data={treeData}
                openByDefault={false}
                width={treeSize.width || 300}
                height={treeSize.height || 400}
                indent={24}
                rowHeight={28}
                overscanCount={5}
                className="react-arborist"
                onActivate={(node) => {
                  fileBrowserStore.selectFile(node.data.path);
                  if (node.isInternal) {
                    const wasOpen = node.isOpen;
                    node.toggle();
                    if (
                      !wasOpen &&
                      (!node.data.children || node.data.children.length === 0)
                    ) {
                      fileBrowserStore.loadDirectory(node.data.path);
                    }
                  }
                }}
                disableMultiSelection={true}
                disableEdit={true}
                disableDrag={true}
                disableDrop={true}
              >
                {FileTreeRow}
              </Tree>
            ) : (
              <div style={{ padding: '20px', color: 'var(--app-text-muted)' }}>
                Initializing file browser…
              </div>
            )}
          </div>
        )}
      </div>

      {hasMountedDirectory && selectedFileNode && selectedFileNode.type === 'file' && (
        <SelectedFileSummary
          selectedPath={selectedPath}
          selectedNode={{
            name: selectedFileNode.name,
            type: selectedFileNode.type,
            size: selectedFileNode.size,
          }}
        />
      )}

      {hasMountedDirectory && (
        <FilesFooterStatus
          rootNode={rootNode}
          recentsCount={recentsCount}
          pinnedCount={pinnedCount}
        />
      )}

      <RemoteMountDialog
        isOpen={remoteDialogOpen}
        onClose={() => {
          setRemoteDialogOpen(false);
        }}
        onMounted={handleRemoteMounted}
      />
    </div>
  );
};

export const FileBrowserPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="FileBrowserPanel">
      <FileBrowserPanelContent />
    </PanelErrorBoundary>
  );
};
