import { writable, derived, get } from 'svelte/store';

// File extension patterns for different file types
export const FILE_PATTERNS = {
  nifti: ['.nii', '.nii.gz'],
  gifti: ['.gii', '.gii.gz'],
  image: ['.png', '.jpg', '.jpeg', '.bmp'],
  data: ['.csv', '.tsv', '.txt'],
  all: [] // Empty array means all files
} as const;

export type FilePatternKey = keyof typeof FILE_PATTERNS;

export interface MountedDirectory {
  id: string;
  path: string;
  label: string; // User-friendly name for the mount
  filePatterns: string[]; // Array of file extensions to filter
  isExpanded: boolean;
}

// Create the writable stores
const mounts = writable<Map<string, MountedDirectory>>(new Map());
const activeMountId = writable<string | null>(null);

// Create derived store for all mounts as array
export const allMounts = derived(mounts, $mounts => Array.from($mounts.values()));

// Create the mount store with methods
function createMountStore() {
  const mountDirectory = (path: string, label?: string, filePatterns?: string[]) => {
    const id = `mount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const mount: MountedDirectory = {
      id,
      path,
      label: label || path.split('/').pop() || path,
      filePatterns: filePatterns || FILE_PATTERNS.nifti, // Default to NIfTI files
      isExpanded: true
    };
    
    mounts.update(currentMounts => {
      const newMounts = new Map(currentMounts);
      newMounts.set(id, mount);
      return newMounts;
    });
    
    // Automatically make the new mount active
    activeMountId.set(id);
    
    return id;
  };

  const unmountDirectory = (id: string) => {
    mounts.update(currentMounts => {
      const newMounts = new Map(currentMounts);
      newMounts.delete(id);
      return newMounts;
    });
    
    // Update active mount if necessary
    const currentActiveId = get(activeMountId);
    if (currentActiveId === id) {
      const currentMounts = get(mounts);
      const newActiveId = currentMounts.size > 0 ? Array.from(currentMounts.keys())[0] : null;
      activeMountId.set(newActiveId);
    }
  };

  const setActiveMountId = (id: string | null) => {
    activeMountId.set(id);
  };

  const toggleMountExpanded = (id: string) => {
    mounts.update(currentMounts => {
      const mount = currentMounts.get(id);
      if (!mount) return currentMounts;
      
      const newMounts = new Map(currentMounts);
      newMounts.set(id, { ...mount, isExpanded: !mount.isExpanded });
      return newMounts;
    });
  };

  const updateMountPatterns = (id: string, patterns: string[]) => {
    mounts.update(currentMounts => {
      const mount = currentMounts.get(id);
      if (!mount) return currentMounts;
      
      const newMounts = new Map(currentMounts);
      newMounts.set(id, { ...mount, filePatterns: patterns });
      return newMounts;
    });
  };

  const getMountById = (id: string): MountedDirectory | undefined => {
    return get(mounts).get(id);
  };

  const getAllMounts = (): MountedDirectory[] => {
    return Array.from(get(mounts).values());
  };

  const getState = () => ({
    mounts: get(mounts),
    activeMountId: get(activeMountId)
  });

  const subscribe = (callback: (state: any) => void) => {
    // Subscribe to both stores and call callback when either changes
    const unsubMounts = mounts.subscribe(() => {
      callback(getState());
    });
    const unsubActiveId = activeMountId.subscribe(() => {
      callback(getState());
    });
    
    // Return cleanup function
    return () => {
      unsubMounts();
      unsubActiveId();
    };
  };

  return {
    // Expose readable stores
    mounts: { subscribe: mounts.subscribe },
    activeMountId: { subscribe: activeMountId.subscribe },
    allMounts,
    
    // Expose methods
    mountDirectory,
    unmountDirectory,
    setActiveMountId,
    toggleMountExpanded,
    updateMountPatterns,
    getMountById,
    getAllMounts,
    getState,
    subscribe
  };
}

// Create and export the store
export const mountStore = createMountStore();

// Svelte-compatible hook
export function useMountStore() {
  return mountStore;
}