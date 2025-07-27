/**
 * Drag Source Store
 * Tracks what type of UI element is currently being dragged
 * This allows components to selectively respond to specific drag operations
 */

import { create } from 'zustand';

// Discriminated union for drag sources
export type DragSource = 'layout' | 'slider' | null;

interface DragSourceState {
  draggingSource: DragSource;
  setDraggingSource: (source: DragSource) => void;
}

export const useDragSourceStore = create<DragSourceState>((set) => ({
  draggingSource: null,
  setDraggingSource: (source) => {
    // console.log(`[DragSourceStore] Drag source changed to: ${source}`);
    set({ draggingSource: source });
  },
}));

// Helper hooks for cleaner component code
export const useIsSliderDragging = () => 
  useDragSourceStore(state => state.draggingSource === 'slider');

export const useIsLayoutDragging = () => 
  useDragSourceStore(state => state.draggingSource === 'layout');

export const useIsAnyDragging = () => 
  useDragSourceStore(state => state.draggingSource !== null);