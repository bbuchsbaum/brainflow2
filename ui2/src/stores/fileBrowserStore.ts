/**
 * File Browser Store - Manages file system navigation and state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type { FileBrowserState, FileTreeNode, MountSource } from '@/types/filesystem';
import { getEventBus } from '@/events/EventBus';
import { getApiService } from '@/services/apiService';
import { formatTauriError } from '@/utils/formatTauriError';

// Enable Map and Set support in Immer
enableMapSet();

// Declare global interface for store
declare global {
  interface Window {
    __fileBrowserStore?: any;
  }
}

interface FileBrowserActions {
  // Mount operations
  mountDirectory: (
    path: string,
    options?: { displayName?: string; mountSource?: MountSource }
  ) => Promise<void>;
  unmountDirectory: (path: string) => void;
  
  // Navigation
  setCurrentPath: (path: string) => void;
  setRootPath: (path: string) => void;
  navigateToParent: () => void;
  
  // Tree operations
  loadDirectory: (path: string) => Promise<void>;
  expandPath: (path: string) => void;
  collapsePath: (path: string) => void;
  toggleExpanded: (path: string) => void;
  refreshDirectory: (path?: string) => Promise<void>;
  
  // Selection
  selectFile: (path: string | null) => void;
  
  // Search
  setSearchQuery: (query: string) => void;
  performSearch: () => void;
  clearSearch: () => void;
  
  // View options
  setShowHidden: (show: boolean) => void;
  setSortBy: (sortBy: FileBrowserState['sortBy']) => void;
  setSortOrder: (order: FileBrowserState['sortOrder']) => void;
  
  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Utilities
  getFileTypeInfo: (path: string) => { icon: string; color: string } | null;
  isNeuroimagingFile: (path: string) => boolean;
  flattenTree: () => FileTreeNode[];
}

interface FileBrowserStore extends FileBrowserState, FileBrowserActions {}

// Create store only once and attach to window for cross-root sharing
const createFileBrowserStore = () => create<FileBrowserStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial state
      currentPath: '',
      rootPath: '',
      entries: [],
      expandedPaths: new Set(),
      selectedPath: null,
      loading: false,
      error: null,
      searchQuery: '',
      searchResults: [],
      showHidden: false,
      sortBy: 'name',
      sortOrder: 'asc',
      
      // Mount operations
      mountDirectory: async (path, options) => {
        // Extract directory name from path
        const dirName = options?.displayName || path.split('/').pop() || path;
        
        // Create a root node for the mounted directory
        const mountedNode: FileTreeNode = {
          id: path,
          name: dirName,
          path: path,
          type: 'directory',
          depth: 0,
          expanded: false,
          children: [],
          modified: new Date(),
          mountSource: options?.mountSource ?? { kind: 'local' },
        };
        
        // Add the mount node to state
        set((state) => {
          // Add to entries if not already mounted
          if (!state.entries.find(e => e.path === path)) {
            state.entries.push(mountedNode);
            console.log('Mounted directory node added:', mountedNode);
          }
        });
        
        // Use queueMicrotask to ensure state is committed before loading
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
        
        // Verify the node exists before loading
        const currentEntries = get().entries;
        console.log('Entries after mount:', currentEntries.map(e => e.path));
        
        // Load the directory contents
        await get().loadDirectory(path);
      },
      
      unmountDirectory: (path) => {
        set((state) => {
          state.entries = state.entries.filter(e => e.path !== path);
          // Also remove from expanded paths
          state.expandedPaths.delete(path);
        });
      },
      
      // Navigation
      setCurrentPath: (path) => {
        set((state) => {
          state.currentPath = path;
        });
      },
      
      setRootPath: (path) => {
        set((state) => {
          state.rootPath = path;
          state.currentPath = path;
          state.entries = []; // Clear entries, will be loaded by loadDirectory
          state.expandedPaths.clear();
          state.selectedPath = null;
        });
      },
      
      navigateToParent: () => {
        const current = get().currentPath;
        const parent = current.split('/').slice(0, -1).join('/') || '/';
        get().setCurrentPath(parent);
      },
      
      // Tree operations
      loadDirectory: async (path) => {
        set((state) => {
          state.loading = true;
          state.error = null;
        });
        
        try {
          const apiService = getApiService();
          const files = await apiService.listDirectory(path, 1);
          
          console.log('API returned files:', files);
          
          set((state) => {
            // Neuroimaging file extensions we support
            const NEUROIMAGING_EXTENSIONS = ['.nii', '.nii.gz', '.gii', '.surf.gii', '.func.gii'];
            
            // Convert API response to FileTreeNode format, filtering for neuroimaging files
            const convertToTreeNodes = (fileNodes: any[], parentPath: string, depth: number): FileTreeNode[] => {
              return fileNodes
                .filter(file => {
                  // Keep directories
                  if (file.isDir) return true;
                  
                  // Only keep neuroimaging files
                  const fileName = file.name.toLowerCase();
                  return NEUROIMAGING_EXTENSIONS.some(ext => fileName.endsWith(ext));
                })
                .map(file => ({
                  id: file.id,
                  name: file.name,
                  path: file.id, // API returns full path as id
                  type: file.isDir ? 'directory' : 'file',
                  depth,
                  expanded: false,
                  children: file.isDir ? [] : undefined,
                  size: !file.isDir ? Math.floor(Math.random() * 10000000) : undefined, // API doesn't return size yet
                  extension: !file.isDir ? file.name.match(/\.[^.]+$/)?.[0] : undefined,
                  modified: new Date() // API doesn't return modified date yet
                }));
            };
            
            // Find the node and add children
            const findAndUpdate = (nodes: FileTreeNode[]): boolean => {
              for (const node of nodes) {
                if (node.path === path) {
                  console.log('Found node to update:', node.path);
                  node.children = convertToTreeNodes(files, path, node.depth + 1);
                  node.loading = false;
                  node.expanded = true; // Auto-expand when loaded
                  console.log('Updated node with children:', node.children.length);
                  return true;
                }
                if (node.children && findAndUpdate(node.children)) {
                  return true;
                }
              }
              return false;
            };
            
            const found = findAndUpdate(state.entries);
            if (!found) {
              console.warn('Could not find node to update for path:', path);
              console.log('Current entries:', state.entries.map(e => e.path));
            }
            
            state.loading = false;
            console.log('Final state.entries:', state.entries);
          });
          
          const eventBus = getEventBus();
          eventBus.emit('filebrowser.directory.loaded', { path });
          
        } catch (error) {
          console.error('Error loading directory:', error);
          set((state) => {
            state.loading = false;
            state.error = formatTauriError(error) || 'Failed to load directory';
          });
        }
      },
      
      expandPath: (path) => {
        set((state) => {
          state.expandedPaths.add(path);
        });
        
        // Load directory if not already loaded
        const findNode = (nodes: FileTreeNode[]): FileTreeNode | null => {
          for (const node of nodes) {
            if (node.path === path) return node;
            if (node.children) {
              const found = findNode(node.children);
              if (found) return found;
            }
          }
          return null;
        };
        
        const node = findNode(get().entries);
        if (node && node.type === 'directory' && !node.children) {
          get().loadDirectory(path);
        }
      },
      
      collapsePath: (path) => {
        set((state) => {
          state.expandedPaths.delete(path);
        });
      },
      
      toggleExpanded: (path) => {
        const isExpanded = get().expandedPaths.has(path);
        if (isExpanded) {
          get().collapsePath(path);
        } else {
          get().expandPath(path);
        }
      },
      
      refreshDirectory: async (path) => {
        const targetPath = path || get().currentPath;
        set((state) => {
          // Clear children for the target path
          const clearChildren = (nodes: FileTreeNode[]) => {
            for (const node of nodes) {
              if (node.path === targetPath) {
                node.children = undefined;
                node.loading = false;
              } else if (node.children) {
                clearChildren(node.children);
              }
            }
          };
          clearChildren(state.entries);
        });
        
        await get().loadDirectory(targetPath);
      },
      
      // Selection
      selectFile: (path) => {
        set((state) => {
          state.selectedPath = path;
        });
        
        if (path) {
          const eventBus = getEventBus();
          eventBus.emit('filebrowser.file.selected', { path });
        }
      },
      
      // Search
      setSearchQuery: (query) => {
        set((state) => {
          state.searchQuery = query;
        });
        
        if (query.trim()) {
          get().performSearch();
        } else {
          get().clearSearch();
        }
      },
      
      performSearch: () => {
        const query = get().searchQuery.toLowerCase();
        if (!query.trim()) return;
        
        const searchInTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
          const results: FileTreeNode[] = [];
          
          for (const node of nodes) {
            if (node.name.toLowerCase().includes(query)) {
              results.push(node);
            }
            if (node.children) {
              results.push(...searchInTree(node.children));
            }
          }
          
          return results;
        };
        
        set((state) => {
          state.searchResults = searchInTree(state.entries);
        });
      },
      
      clearSearch: () => {
        set((state) => {
          state.searchQuery = '';
          state.searchResults = [];
        });
      },
      
      // View options
      setShowHidden: (show) => {
        set((state) => {
          state.showHidden = show;
        });
      },
      
      setSortBy: (sortBy) => {
        set((state) => {
          state.sortBy = sortBy;
        });
      },
      
      setSortOrder: (order) => {
        set((state) => {
          state.sortOrder = order;
        });
      },
      
      // State management
      setLoading: (loading) => {
        set((state) => {
          state.loading = loading;
        });
      },
      
      setError: (error) => {
        set((state) => {
          state.error = error;
        });
      },
      
      // Utilities
      getFileTypeInfo: (path) => {
        const extension = path.split('.').pop()?.toLowerCase();
        if (!extension) return null;
        
        // Check for neuroimaging file types
        if (extension === 'gz') {
          const fullExt = path.match(/\.([^.]+\.gz)$/)?.[1];
          if (fullExt === 'nii.gz') {
            return { icon: '🧠', color: '#3b82f6' };
          }
        }
        
        const fileTypeMap: Record<string, { icon: string; color: string }> = {
          'nii': { icon: '🧠', color: '#3b82f6' },
          'gii': { icon: '🌐', color: '#10b981' },
          'json': { icon: '📄', color: '#6b7280' },
          'tsv': { icon: '📊', color: '#6b7280' },
          'csv': { icon: '📊', color: '#6b7280' },
          'txt': { icon: '📝', color: '#6b7280' },
          'md': { icon: '📖', color: '#6b7280' },
          'img': { icon: '📊', color: '#f59e0b' },
          'hdr': { icon: '📊', color: '#f59e0b' },
          'dcm': { icon: '🏥', color: '#ef4444' },
          'mgz': { icon: '🎭', color: '#8b5cf6' },
          'mgh': { icon: '🎭', color: '#8b5cf6' }
        };
        
        return fileTypeMap[extension] || { icon: '📄', color: '#6b7280' };
      },
      
      isNeuroimagingFile: (path) => {
        const neuroimagingExts = [
          '.nii', '.nii.gz', '.gii', '.surf.gii', '.func.gii',
          '.img', '.hdr', '.dcm', '.dicom', '.mgz', '.mgh'
        ];
        
        return neuroimagingExts.some(ext => path.toLowerCase().endsWith(ext));
      },
      
      flattenTree: () => {
        const flatten = (nodes: FileTreeNode[], result: FileTreeNode[] = []): FileTreeNode[] => {
          for (const node of nodes) {
            result.push(node);
            if (node.expanded && node.children) {
              flatten(node.children, result);
            }
          }
          return result;
        };
        
        const { entries, searchQuery, searchResults } = get();
        return searchQuery ? searchResults : flatten(entries);
      }
    }))
  )
);

// Export store with global instance sharing
export const useFileBrowserStore = (() => {
  if (typeof window !== 'undefined' && window.__fileBrowserStore) {
    console.log('Using existing fileBrowserStore from window');
    return window.__fileBrowserStore;
  }
  
  console.log('Creating new fileBrowserStore instance');
  const store = createFileBrowserStore();
  
  if (typeof window !== 'undefined') {
    window.__fileBrowserStore = store;
    console.log('Attached fileBrowserStore to window');
  }
  
  return store;
})();

// Subscribe to relevant events
const eventBus = getEventBus();

eventBus.on('filebrowser.file.selected', ({ path }) => {
  console.log('File selected:', path);
});

eventBus.on('filebrowser.directory.loaded', ({ path }) => {
  console.log('Directory loaded:', path);
});
