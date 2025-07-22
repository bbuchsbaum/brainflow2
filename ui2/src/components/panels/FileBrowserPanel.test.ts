import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode } from '@/types/filesystem';

// Mock react-arborist to avoid DOM rendering in tests
vi.mock('react-arborist', () => ({
  Tree: ({ children, data }: any) => {
    return data.map((item: any, index: number) => 
      children({ node: { data: item, isOpen: false, toggle: vi.fn() }, style: {}, key: index })
    );
  }
}));

// Mock the event bus to prevent logging during tests
vi.mock('@/events/EventBus', () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }))
}));

describe('FileBrowserPanel', () => {
  beforeEach(() => {
    // Reset store state
    useFileBrowserStore.setState({
      currentPath: '/test',
      rootPath: '/test',
      entries: [],
      expandedPaths: new Set(),
      selectedPath: null,
      loading: false,
      error: null,
      searchQuery: '',
      searchResults: [],
      showHidden: false,
      sortBy: 'name',
      sortOrder: 'asc'
    });
  });

  it('should handle initial state', () => {
    const state = useFileBrowserStore.getState();
    expect(state.currentPath).toBe('/test');
    expect(state.entries).toHaveLength(0);
    expect(state.selectedPath).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('should set current path', () => {
    const { setCurrentPath } = useFileBrowserStore.getState();
    
    setCurrentPath('/new/path');
    
    const state = useFileBrowserStore.getState();
    expect(state.currentPath).toBe('/new/path');
  });

  it('should handle file selection', () => {
    const { selectFile } = useFileBrowserStore.getState();
    
    selectFile('/test/file.nii');
    
    const state = useFileBrowserStore.getState();
    expect(state.selectedPath).toBe('/test/file.nii');
    
    // Clear selection
    selectFile(null);
    const state2 = useFileBrowserStore.getState();
    expect(state2.selectedPath).toBeNull();
  });

  it('should handle path expansion and collapse', () => {
    const { expandPath, collapsePath } = useFileBrowserStore.getState();
    
    expandPath('/test/folder');
    let state = useFileBrowserStore.getState();
    expect(state.expandedPaths.has('/test/folder')).toBe(true);
    
    collapsePath('/test/folder');
    state = useFileBrowserStore.getState();
    expect(state.expandedPaths.has('/test/folder')).toBe(false);
  });

  it('should toggle expanded state', () => {
    const { toggleExpanded } = useFileBrowserStore.getState();
    
    // First toggle should expand
    toggleExpanded('/test/folder');
    let state = useFileBrowserStore.getState();
    expect(state.expandedPaths.has('/test/folder')).toBe(true);
    
    // Second toggle should collapse
    toggleExpanded('/test/folder');
    state = useFileBrowserStore.getState();
    expect(state.expandedPaths.has('/test/folder')).toBe(false);
  });

  it('should handle search', () => {
    const { setSearchQuery, performSearch } = useFileBrowserStore.getState();
    
    // Set up some mock entries
    useFileBrowserStore.setState({
      entries: [
        {
          id: '1',
          name: 'test.nii',
          path: '/test/test.nii',
          type: 'file',
          depth: 0
        },
        {
          id: '2',
          name: 'other.txt',
          path: '/test/other.txt',
          type: 'file',
          depth: 0
        }
      ] as FileTreeNode[]
    });
    
    setSearchQuery('test');
    
    const state = useFileBrowserStore.getState();
    expect(state.searchQuery).toBe('test');
    expect(state.searchResults).toHaveLength(1);
    expect(state.searchResults[0].name).toBe('test.nii');
  });

  it('should clear search', () => {
    const { setSearchQuery, clearSearch } = useFileBrowserStore.getState();
    
    setSearchQuery('test');
    let state = useFileBrowserStore.getState();
    expect(state.searchQuery).toBe('test');
    
    clearSearch();
    state = useFileBrowserStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.searchResults).toHaveLength(0);
  });

  it('should handle view options', () => {
    const { setShowHidden, setSortBy, setSortOrder } = useFileBrowserStore.getState();
    
    setShowHidden(true);
    let state = useFileBrowserStore.getState();
    expect(state.showHidden).toBe(true);
    
    setSortBy('size');
    state = useFileBrowserStore.getState();
    expect(state.sortBy).toBe('size');
    
    setSortOrder('desc');
    state = useFileBrowserStore.getState();
    expect(state.sortOrder).toBe('desc');
  });

  it('should handle loading and error states', () => {
    const { setLoading, setError } = useFileBrowserStore.getState();
    
    setLoading(true);
    let state = useFileBrowserStore.getState();
    expect(state.loading).toBe(true);
    
    setLoading(false);
    state = useFileBrowserStore.getState();
    expect(state.loading).toBe(false);
    
    setError('Test error');
    state = useFileBrowserStore.getState();
    expect(state.error).toBe('Test error');
    
    setError(null);
    state = useFileBrowserStore.getState();
    expect(state.error).toBeNull();
  });

  it('should detect neuroimaging files', () => {
    const { isNeuroimagingFile } = useFileBrowserStore.getState();
    
    expect(isNeuroimagingFile('/test/brain.nii')).toBe(true);
    expect(isNeuroimagingFile('/test/brain.nii.gz')).toBe(true);
    expect(isNeuroimagingFile('/test/surface.gii')).toBe(true);
    expect(isNeuroimagingFile('/test/data.txt')).toBe(false);
  });

  it('should get file type info', () => {
    const { getFileTypeInfo } = useFileBrowserStore.getState();
    
    const niftiInfo = getFileTypeInfo('/test/brain.nii');
    expect(niftiInfo?.icon).toBe('🧠');
    expect(niftiInfo?.color).toBe('#3b82f6');
    
    const jsonInfo = getFileTypeInfo('/test/data.json');
    expect(jsonInfo?.icon).toBe('📄');
    expect(jsonInfo?.color).toBe('#6b7280');
    
    const unknownInfo = getFileTypeInfo('/test/file');
    expect(unknownInfo?.icon).toBe('📄');
    expect(unknownInfo?.color).toBe('#6b7280');
  });

  it('should flatten tree structure', () => {
    const { flattenTree } = useFileBrowserStore.getState();
    
    // Set up nested tree structure
    useFileBrowserStore.setState({
      entries: [
        {
          id: '1',
          name: 'folder1',
          path: '/test/folder1',
          type: 'directory',
          depth: 0,
          expanded: true,
          children: [
            {
              id: '2',
              name: 'file1.nii',
              path: '/test/folder1/file1.nii',
              type: 'file',
              depth: 1
            }
          ]
        },
        {
          id: '3',
          name: 'file2.txt',
          path: '/test/file2.txt',
          type: 'file',
          depth: 0
        }
      ] as FileTreeNode[],
      expandedPaths: new Set(['/test/folder1'])
    });
    
    const flattened = flattenTree();
    expect(flattened).toHaveLength(3); // folder1, file1.nii, file2.txt
    expect(flattened[0].name).toBe('folder1');
    expect(flattened[1].name).toBe('file1.nii');
    expect(flattened[2].name).toBe('file2.txt');
  });

  it('should navigate to parent directory', () => {
    const { setCurrentPath, navigateToParent } = useFileBrowserStore.getState();
    
    setCurrentPath('/test/subfolder');
    navigateToParent();
    
    const state = useFileBrowserStore.getState();
    expect(state.currentPath).toBe('/test');
  });

  it('should handle root path', () => {
    const { setRootPath } = useFileBrowserStore.getState();
    
    setRootPath('/new/root');
    
    const state = useFileBrowserStore.getState();
    expect(state.rootPath).toBe('/new/root');
    expect(state.currentPath).toBe('/new/root');
    expect(state.expandedPaths.size).toBe(0);
    expect(state.selectedPath).toBeNull();
  });
});