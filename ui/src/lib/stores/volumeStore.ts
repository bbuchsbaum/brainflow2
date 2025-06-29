import { createStore } from '$lib/zustand-vanilla';
import { nanoid } from 'nanoid';
import type { VolumeHandleInfo } from '@brainflow/api';


interface VolumeState {
  byId: Record<string, VolumeHandleInfo>;
  add: (info: VolumeHandleInfo) => void;
  getById: (id: string) => VolumeHandleInfo | undefined;
  // Added getter for convenience, `ids` can be derived if needed
}

export const useVolumeStore = createStore<VolumeState>((set, get) => ({
  byId: {},
  add: (info) => {
    console.log('[volumeStore] Adding volume:', info);
    set((state) => ({
      byId: { ...state.byId, [info.id]: info },
    }));
  },
  getById: (id) => get().byId[id],
  // Removed ids() method, can be derived: Object.keys(useVolumeStore.getState().byId)
}));

// Optional: Subscribe to changes for debugging
useVolumeStore.subscribe((newState, prevState) => {
  console.log('[volumeStore] State changed:', { 
    added: Object.keys(newState.byId).filter(id => !prevState.byId[id]),
    // removed: Object.keys(prevState.byId).filter(id => !newState.byId[id]) // If removal is added later
  });
}); 