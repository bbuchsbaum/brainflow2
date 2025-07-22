/**
 * File System Types - for file browser and navigation
 */

export interface FileSystemEntry {
  id: string;           // Unique identifier 
  name: string;         // Display name
  path: string;         // Full file path
  type: 'file' | 'directory';
  size?: number;        // File size in bytes
  modified?: Date;      // Last modified date
  extension?: string;   // File extension
  isHidden?: boolean;   // Hidden file/directory
  isSymlink?: boolean;  // Symbolic link
  permissions?: FilePermissions;
}

export interface FilePermissions {
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

export interface FileTreeNode extends FileSystemEntry {
  children?: FileTreeNode[];
  expanded?: boolean;
  loading?: boolean;
  depth: number;
  parent?: string;      // Parent node ID
}

export interface FileTypeInfo {
  icon: string;         // Icon class or emoji
  color: string;        // Color for the file type
  description: string;  // Human-readable description
  extensions: string[]; // File extensions
}

// Common neuroimaging file types
export const NEUROIMAGING_FILE_TYPES: Record<string, FileTypeInfo> = {
  nifti: {
    icon: '🧠',
    color: '#3b82f6',
    description: 'NIfTI Volume',
    extensions: ['.nii', '.nii.gz']
  },
  gifti: {
    icon: '🌐',
    color: '#10b981',
    description: 'GIfTI Surface',
    extensions: ['.gii', '.surf.gii', '.func.gii']
  },
  analyze: {
    icon: '📊',
    color: '#f59e0b',
    description: 'Analyze 7.5',
    extensions: ['.img', '.hdr']
  },
  dicom: {
    icon: '🏥',
    color: '#ef4444',
    description: 'DICOM Image',
    extensions: ['.dcm', '.dicom']
  },
  freesurfer: {
    icon: '🎭',
    color: '#8b5cf6',
    description: 'FreeSurfer',
    extensions: ['.mgz', '.mgh']
  },
  json: {
    icon: '📄',
    color: '#6b7280',
    description: 'JSON Data',
    extensions: ['.json']
  },
  tsv: {
    icon: '📊',
    color: '#6b7280',
    description: 'TSV Data',
    extensions: ['.tsv', '.csv']
  }
};

export interface FileBrowserState {
  // Current directory
  currentPath: string;
  rootPath: string;
  
  // File tree data
  entries: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  
  // UI state
  loading: boolean;
  error: string | null;
  
  // Search
  searchQuery: string;
  searchResults: FileTreeNode[];
  
  // View options
  showHidden: boolean;
  sortBy: 'name' | 'modified' | 'size' | 'type';
  sortOrder: 'asc' | 'desc';
}

export interface DragFileData {
  path: string;
  name: string;
  type: FileSystemEntry['type'];
  extension?: string;
}