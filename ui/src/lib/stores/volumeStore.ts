import { writable, derived, get } from 'svelte/store';
import { nanoid } from 'nanoid';
import type { VolumeHandleInfo } from '@brainflow/api';

// Create the writable store
const byId = writable<Record<string, VolumeHandleInfo>>({});

// Create derived store for volume IDs
export const volumeIds = derived(byId, $byId => Object.keys($byId));

// Create derived store for volume list
export const volumes = derived(byId, $byId => Object.values($byId));

// Create the volume store with methods
function createVolumeStore() {
  const add = (info: VolumeHandleInfo) => {
    console.log('[volumeStore] Adding volume:', info);
    byId.update(currentById => ({
      ...currentById,
      [info.id]: info
    }));
  };

  const getById = (id: string): VolumeHandleInfo | undefined => {
    return get(byId)[id];
  };

  const getState = () => ({
    byId: get(byId)
  });

  return {
    // Expose the readable stores
    byId: { subscribe: byId.subscribe },
    volumeIds,
    volumes,
    
    // Expose methods
    add,
    getById,
    getState
  };
}

// Create and export the store
export const useVolumeStore = createVolumeStore();

// Optional: Subscribe to changes for debugging
byId.subscribe((newById) => {
  console.log('[volumeStore] State changed:', { 
    volumes: Object.keys(newById)
  });
});