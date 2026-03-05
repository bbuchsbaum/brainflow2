import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Tree } from 'react-arborist';
import { 
  VscChevronRight, 
  VscChevronDown, 
  VscChevronUp,
  VscFolder, 
  VscFolderOpened,
  VscFile,
  VscJson,
  VscTable,
  VscMarkdown,
  VscFileCode,
  VscFileBinary
} from 'react-icons/vsc';
import './FileBrowserPanel.css';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode, DragFileData, MountSource } from '@/types/filesystem';
import { getEventBus } from '@/events/EventBus';
import { getTransport } from '@/services/transport';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { PanelHeader } from '@/components/ui/PanelHeader';

interface FileNodeData {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  modified?: Date;
  children?: FileNodeData[];
  mountSource?: MountSource;
}

interface RemoteHostKeyChallenge {
  challenge_id: string;
  host: string;
  port: number;
  algorithm: string;
  sha256_fingerprint: string;
  disposition: 'unknown' | 'mismatch' | string;
}

interface RemoteAuthPrompt {
  prompt: string;
  echo: boolean;
}

interface RemoteAuthChallenge {
  conversation_id: string;
  name: string;
  instructions: string;
  prompts: RemoteAuthPrompt[];
}

type RemoteMountConnectResult =
  | {
      status: 'connected';
      mount: {
        mount_id: string;
        local_path: string;
        display_name: string;
        origin: {
          label: string;
          host: string;
          port: number;
          user: string;
          remote_path: string;
        };
      };
    }
  | { status: 'need_host_key'; challenge: RemoteHostKeyChallenge }
  | { status: 'need_auth'; challenge: RemoteAuthChallenge };

interface RemoteMountRequest {
  host: string;
  port?: number;
  user: string;
  remotePath: string;
  authMethod?: 'password' | 'key_file' | 'agent' | 'keyboard_interactive';
  password?: string;
  rememberPassword?: boolean;
  saveProfile?: boolean;
  profileName?: string;
}

interface FileTreeItemProps {
  node: any;
  style: React.CSSProperties;
  dragHandle?: React.Ref<HTMLDivElement>;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, style, dragHandle }) => {
  const { data } = node;
  const fileBrowserStore = useFileBrowserStore();
  const selectedPath = useFileBrowserStore(state => state.selectedPath);
  const searchQuery = useFileBrowserStore(state => state.searchQuery);
  
  const isSelected = selectedPath === data.path;
  const isDirectory = data.type === 'directory';
  const remoteOriginLabel =
    isDirectory && node.level === 0 && data.mountSource?.kind === 'remote'
      ? data.mountSource.label ?? 'remote'
      : null;
  
  // File type detection
  const { icon: FileIcon, color: fileColor } = getFileIcon(data, node.isOpen);
  
  function getFileIcon(node: FileNodeData, isOpen: boolean = false): { icon: React.ComponentType; color: string } {
    if (node.type === 'directory') {
      return { 
        icon: isOpen ? VscFolderOpened : VscFolder, 
        color: 'var(--app-text-secondary)' 
      };
    }
    
    const path = node.path.toLowerCase();
    
    // Neuroimaging files
    if (path.endsWith('.nii') || path.endsWith('.nii.gz')) {
      return { icon: VscFileBinary, color: 'var(--blue-500)' };
    }
    if (path.endsWith('.gii')) {
      return { icon: VscFileBinary, color: '#10b981' };
    }
    if (path.endsWith('.img') || path.endsWith('.hdr')) {
      return { icon: VscFileBinary, color: 'var(--app-warning)' };
    }
    if (path.endsWith('.dcm') || path.endsWith('.dicom')) {
      return { icon: VscFileBinary, color: 'var(--app-error)' };
    }
    if (path.endsWith('.mgz') || path.endsWith('.mgh')) {
      return { icon: VscFileBinary, color: '#8b5cf6' };
    }
    
    // Data files
    if (path.endsWith('.json')) {
      return { icon: VscJson, color: 'var(--app-text-secondary)' };
    }
    if (path.endsWith('.tsv') || path.endsWith('.csv')) {
      return { icon: VscTable, color: 'var(--app-text-secondary)' };
    }
    
    // Text files
    if (path.endsWith('.md')) {
      return { icon: VscMarkdown, color: 'var(--app-text-secondary)' };
    }
    if (path.endsWith('.txt')) {
      return { icon: VscFileCode, color: 'var(--app-text-secondary)' };
    }
    
    // Default
    return { icon: VscFile, color: 'var(--app-text-secondary)' };
  }
  
  function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
  }
  
  function highlightText(text: string, query: string): string {
    if (!query) return text;
    
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
  }
  
  
  function handleDoubleClick() {
    if (!isDirectory) {
      // Double-click to load file
      const eventBus = getEventBus();
      eventBus.emit('filebrowser.file.doubleclick', { path: data.path });
    }
  }
  
  function handleDragStart(event: React.DragEvent) {
    if (!event.dataTransfer) return;
    
    const dragData: DragFileData = {
      path: data.path,
      name: data.name,
      type: data.type,
      extension: data.extension
    };
    
    event.dataTransfer.setData('application/json', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'copy';
  }
  
  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    // TODO: Show context menu
    console.log('Context menu for:', data.path);
  }
  
  return (
    <div
      ref={dragHandle}
      style={{
        ...style,
        paddingLeft: `${style.paddingLeft || 0}px`
      }}
      className={`file-tree-item ${isSelected ? 'selected' : ''} ${isDirectory ? 'font-medium' : ''}`}
      draggable={data.type === 'file'}
      onDoubleClick={handleDoubleClick}
      onDragStart={handleDragStart}
      onContextMenu={handleContextMenu}
    >
      {/* Expand/collapse indicator for directories */}
      {isDirectory ? (
        <button
          type="button"
          className="expand-button"
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
            
            // Load directory contents when opening
            if (!node.isOpen && (!data.children || data.children.length === 0)) {
              fileBrowserStore.loadDirectory(data.path);
            }
          }}
        >
          {node.isOpen ? <VscChevronDown /> : <VscChevronRight />}
        </button>
      ) : (
        <div className="expand-spacer" />
      )}
      
      {/* File/folder icon */}
      <span 
        className="file-icon"
        style={{ color: fileColor }}
      >
        <FileIcon />
      </span>
      
      {/* File/folder name */}
      <div className="file-name">
        <span
          className="file-name-text"
          dangerouslySetInnerHTML={{ __html: highlightText(data.name, searchQuery) }}
        />
        {remoteOriginLabel && (
          <span className="remote-origin-badge" title={remoteOriginLabel}>
            {remoteOriginLabel}
          </span>
        )}
      </div>
      
      {/* File metadata */}
      <div className="file-meta">
        {/* File size (for files only) */}
        {data.type === 'file' && data.size && (
          <span className="file-size">
            {formatFileSize(data.size)}
          </span>
        )}
        
        {/* Modified date */}
        {data.modified && (
          <span className="file-date">
            {data.modified.toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
};

const FileBrowserPanelContent: React.FC = () => {
  const fileBrowserStore = useFileBrowserStore();
  const [searchInput, setSearchInput] = useState('');
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [mountActionError, setMountActionError] = useState<string | null>(null);
  const [mountActionPending, setMountActionPending] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  
  // Debug store instance
  useEffect(() => {
    console.log('FileBrowserPanel mounted with store:', {
      storeInstance: fileBrowserStore,
      isWindowStore: window.__fileBrowserStore === fileBrowserStore,
      windowStore: window.__fileBrowserStore
    });
  }, []);
  
  // Reactive values from store
  const currentPath = useFileBrowserStore(state => state.currentPath);
  const rootPath = useFileBrowserStore(state => state.rootPath);
  const entries = useFileBrowserStore(state => state.entries);
  const loading = useFileBrowserStore(state => state.loading);
  const error = useFileBrowserStore(state => state.error);
  const searchQuery = useFileBrowserStore(state => state.searchQuery);
  const searchResults = useFileBrowserStore(state => state.searchResults);
  const sortBy = useFileBrowserStore(state => state.sortBy);
  const sortOrder = useFileBrowserStore(state => state.sortOrder);
  const selectedPath = useFileBrowserStore(state => state.selectedPath);
  
  // Debug: log when component re-renders
  useEffect(() => {
    console.log('FileBrowserPanel re-rendered with entries:', entries.length, 'currentPath:', currentPath);
  });
  
  // Debug: Subscribe to store changes
  useEffect(() => {
    const unsubscribe = useFileBrowserStore.subscribe(
      (state) => state.entries,
      (entries) => {
        console.log('FileBrowserPanel: Store entries changed:', {
          entriesLength: entries.length,
          entries: entries.map(e => ({ path: e.path, name: e.name }))
        });
      }
    );
    
    return unsubscribe;
  }, []);
  
  // Handle container resize
  useEffect(() => {
    if (!treeContainerRef.current) return;
    
    // Initial size check
    const rect = treeContainerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setTreeSize({ width: rect.width, height: rect.height });
    }
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setTreeSize({ width, height });
      }
    });
    
    resizeObserver.observe(treeContainerRef.current);
    
    // Fallback: check size after a delay
    const timeoutId = setTimeout(() => {
      if (treeContainerRef.current) {
        const rect = treeContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (treeSize.width === 0 || treeSize.height === 0)) {
          setTreeSize({ width: rect.width, height: rect.height });
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
      return nodes.map(node => ({
        id: node.id,
        name: node.name,
        path: node.path,
        type: node.type,
        size: node.size,
        extension: node.extension,
        modified: node.modified,
        mountSource: node.mountSource,
        children: node.children ? convertToTreeData(node.children) : undefined
      }));
    };
    
    const data = searchQuery ? searchResults : entries;
    const converted = convertToTreeData(data);
    console.log('FileBrowserPanel - treeData updated:', {
      entriesLength: entries.length,
      dataLength: data.length,
      convertedLength: converted.length,
      firstItem: converted[0],
      allItems: converted
    });
    
    return converted;
  }, [entries, searchResults, searchQuery]);
  
  // Remove the automatic loading based on currentPath
  // Directories are now loaded when mounted or expanded
  
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
    if (mountActionPending) {
      return;
    }

    setMountActionPending(true);
    setMountActionError(null);

    try {
      await getTransport().invoke<void>('open_mount_dialog');
    } catch (error) {
      console.error('Failed to open mount dialog:', error);
      setMountActionError('Could not open folder picker. Use File > Mount Directory…');
    } finally {
      setMountActionPending(false);
    }
  }

  async function openFileDialog() {
    if (mountActionPending) {
      return;
    }

    setMountActionPending(true);
    setMountActionError(null);

    try {
      await getTransport().invoke<void>('open_file_dialog');
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      setMountActionError('Could not open file picker. Please try again.');
    } finally {
      setMountActionPending(false);
    }
  }

  async function openRemoteMountDialog() {
    if (mountActionPending) {
      return;
    }

    const host = window.prompt('SSH host (e.g. login.example.org)');
    if (!host || !host.trim()) {
      return;
    }

    const user = window.prompt('SSH username');
    if (!user || !user.trim()) {
      return;
    }

    const remotePathInput = window.prompt('Remote folder path', '/');
    if (!remotePathInput || !remotePathInput.trim()) {
      return;
    }

    const portInput = window.prompt('SSH port', '22');
    const parsedPort = portInput ? Number.parseInt(portInput, 10) : 22;
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 22;

    const authMethodInput = window
      .prompt(
        'Auth method: password, key_file, agent, keyboard_interactive',
        'password'
      )
      ?.trim()
      .toLowerCase() as RemoteMountRequest['authMethod'] | undefined;

    const authMethod: RemoteMountRequest['authMethod'] =
      authMethodInput === 'key_file' ||
      authMethodInput === 'agent' ||
      authMethodInput === 'keyboard_interactive' ||
      authMethodInput === 'password'
        ? authMethodInput
        : 'password';

    let password: string | undefined;
    if (authMethod === 'password') {
      const passwordInput = window.prompt(
        'SSH password (visible in this v1 prompt UI; secure keychain storage is still used backend-side)'
      );
      if (!passwordInput || !passwordInput.trim()) {
        setMountActionError('Password is required for password auth.');
        return;
      }
      password = passwordInput;
    }

    const rememberPassword =
      authMethod === 'password'
        ? window.confirm('Remember password in OS keychain for this host/user?')
        : false;
    const saveProfile = window.confirm('Save this remote connection profile?');
    const profileName = saveProfile
      ? window.prompt('Profile name', `${user}@${host}:${remotePathInput}`) ?? undefined
      : undefined;

    setMountActionPending(true);
    setMountActionError(null);

    try {
      const initialRequest = {
        host: host.trim(),
        port,
        user: user.trim(),
        remote_path: remotePathInput.trim(),
        auth_method: authMethod,
        password,
        remember_password: rememberPassword,
        save_profile: saveProfile,
        profile_name: profileName,
      };

      let result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_connect', {
        request: initialRequest,
      });

      while (result.status !== 'connected') {
        if (result.status === 'need_host_key') {
          const { challenge } = result;
          const actionLabel =
            challenge.disposition === 'mismatch' ? 'host key mismatch' : 'unknown host key';
          const trust = window.confirm(
            `SSH ${actionLabel} for ${challenge.host}:${challenge.port}\n\n` +
              `Algorithm: ${challenge.algorithm}\n` +
              `Fingerprint: ${challenge.sha256_fingerprint}\n\n` +
              'Trust this host key and continue?'
          );
          if (!trust) {
            throw new Error('Host key was not trusted.');
          }
          result = await getTransport().invoke<RemoteMountConnectResult>(
            'remote_mount_respond_host_key',
            {
              challengeId: challenge.challenge_id,
              trust: true,
            }
          );
          continue;
        }

        if (result.status === 'need_auth') {
          const { challenge } = result;
          const responses: string[] = [];
          for (const prompt of challenge.prompts) {
            const promptText =
              prompt.prompt && prompt.prompt.trim().length > 0
                ? prompt.prompt
                : 'Authentication response';
            const response = window.prompt(promptText);
            if (response === null) {
              throw new Error('Authentication cancelled.');
            }
            responses.push(response);
          }

          result = await getTransport().invoke<RemoteMountConnectResult>(
            'remote_mount_respond_auth',
            {
              conversationId: challenge.conversation_id,
              responses,
            }
          );
          continue;
        }

        throw new Error('Unexpected remote mount state.');
      }

      const mount = result.mount;
      await fileBrowserStore.mountDirectory(mount.local_path, {
        displayName: mount.display_name,
        mountSource: {
          kind: 'remote',
          label: mount.origin.label,
          mountId: mount.mount_id,
          host: mount.origin.host,
          port: mount.origin.port,
          user: mount.origin.user,
          remotePath: mount.origin.remote_path,
        },
      });
    } catch (error) {
      console.error('Failed to mount remote folder:', error);
      setMountActionError(
        error instanceof Error ? error.message : 'Could not mount remote folder over SSH.'
      );
    } finally {
      setMountActionPending(false);
    }
  }

  function handleNoResultsReset() {
    clearSearch();
    setMountActionError(null);
  }

  const hasMountedDirectory = rootPath.trim().length > 0 || entries.length > 0;
  const isSearchEmptyState = searchQuery.trim().length > 0 && hasMountedDirectory;
  const refreshTargetPath = currentPath || rootPath;
  const canRefresh = refreshTargetPath.trim().length > 0;
  const shortcutLabel = useMemo(
    () => (navigator.platform.toLowerCase().includes('mac') ? 'Cmd+O' : 'Ctrl+O'),
    []
  );
  
  return (
    <div className="file-browser-panel">
      <PanelHeader
        title="Files"
        icon={<VscFolder className="h-4 w-4" />}
        primaryAction={{
          label: 'Mount',
          onClick: () => {
            void openMountDialog();
          },
          disabled: mountActionPending,
          title: 'Mount directory',
        }}
        overflowActions={[
          {
            id: 'mount-remote',
            label: 'Mount Remote (SSH)…',
            onClick: () => {
              void openRemoteMountDialog();
            },
            disabled: mountActionPending,
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

      {/* Inline controls strip */}
      <div className="fb-controls">
        {/* Search and sort */}
        <div className="fb-controls-bottom">
          <div className="fb-search">
            <svg 
              className="fb-search-icon"
              width="14"
              height="14"
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input
              type="text"
              placeholder="Search files..."
              value={searchInput}
              onChange={handleSearchInput}
              className="fb-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="fb-search-clear"
                onClick={clearSearch}
              >
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
                </svg>
              </button>
            )}
          </div>
          
          <div className="fb-sort">
            <select
              value={sortBy}
              onChange={(e) => fileBrowserStore.setSortBy(e.target.value as any)}
              className="fb-sort-select"
            >
              <option value="name">Name</option>
              <option value="modified">Modified</option>
              <option value="size">Size</option>
              <option value="type">Type</option>
            </select>
            <button
              type="button"
              className="fb-sort-order"
              onClick={() => fileBrowserStore.setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              title={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            >
              {sortOrder === 'asc' ? <VscChevronUp /> : <VscChevronDown />}
            </button>
          </div>
        </div>
      </div>
      
      {/* File tree with virtual scrolling */}
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
        ) : treeData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-card">
              <div className="empty-state-icon" aria-hidden="true">
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                >
                  <path d="M3 6h7l2 2h9v12H3V6z" />
                </svg>
              </div>

              <p className="empty-state-kicker">
                {isSearchEmptyState ? 'No Matching Files' : 'No Directory Mounted'}
              </p>

              <p className="empty-state-message">
                {isSearchEmptyState
                  ? 'No neuroimaging files match your current search. Reset search or mount another folder.'
                  : 'Mount a directory to browse and load NIfTI/GIfTI files directly from the Files panel.'}
              </p>

              <div className="empty-state-actions">
                {isSearchEmptyState ? (
                  <button
                    type="button"
                    className="empty-state-button secondary"
                    onClick={handleNoResultsReset}
                  >
                    Clear Search
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="empty-state-button primary"
                      onClick={() => void openMountDialog()}
                      disabled={mountActionPending}
                    >
                      {mountActionPending ? 'Opening…' : 'Mount Directory'}
                    </button>
                    <button
                      type="button"
                      className="empty-state-button secondary"
                      onClick={() => void openRemoteMountDialog()}
                      disabled={mountActionPending}
                    >
                      Mount Remote (SSH)…
                    </button>
                    <button
                      type="button"
                      className="empty-state-button secondary"
                      onClick={() => void openFileDialog()}
                      disabled={mountActionPending}
                    >
                      Open File...
                    </button>
                  </>
                )}
              </div>

              {!isSearchEmptyState && (
                <p className="empty-state-hint">
                  Shortcut: <span>{shortcutLabel}</span> (File {'>'} Mount Directory…)
                </p>
              )}

              {mountActionError && (
                <p className="empty-state-error" role="status">
                  {mountActionError}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div ref={treeContainerRef} style={{ 
            width: '100%', 
            height: '100%', 
            position: 'relative'
          }}>
            {(treeSize.width > 0 && treeSize.height > 0) || treeData.length > 0 ? (
              <Tree
                key={`tree-${entries.length}`}
                data={treeData}
                openByDefault={false}
                width={treeSize.width || 300}
                height={treeSize.height || 400}
                indent={24}
                rowHeight={28}
                overscanCount={5}
                className="react-arborist"
                onActivate={(node) => {
                  // Always select the node that was clicked
                  fileBrowserStore.selectFile(node.data.path);
                  
                  // If it's a directory, toggle its state
                  if (node.isInternal) {
                    node.toggle();
                    
                    // If we just opened the folder, load its contents
                    if (!node.isOpen && (!node.data.children || node.data.children.length === 0)) {
                      fileBrowserStore.loadDirectory(node.data.path);
                    }
                  }
                }}
                disableMultiSelection={true}
                disableEdit={true}
              >
                {(props: any) => <FileTreeItem {...props} />}
              </Tree>
            ) : (
              <div style={{ padding: '20px', color: 'var(--app-text-muted)' }}>
                Initializing file browser…
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Status bar */}
      <div className="status-bar">
        {searchQuery ? (
          `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`
        ) : (
          `${treeData.length} item${treeData.length === 1 ? '' : 's'}`
        )}
        {selectedPath && (
          <span style={{ marginLeft: '8px' }}>• {selectedPath.split('/').pop()} selected</span>
        )}
      </div>
    </div>
  );
};

// Export wrapped component with error boundary
export const FileBrowserPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="FileBrowserPanel">
      <FileBrowserPanelContent />
    </PanelErrorBoundary>
  );
};
