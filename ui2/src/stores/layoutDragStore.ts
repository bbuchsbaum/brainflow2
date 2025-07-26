/**
 * Layout Drag Store
 * Tracks whether the user is currently dragging split panes
 * This allows us to pause expensive operations during drag
 */

import { create } from 'zustand';

interface LayoutDragState {
  isDragging: boolean;
  setDragging: (dragging: boolean) => void;
}

export const useLayoutDragStore = create<LayoutDragState>((set) => ({
  isDragging: false,
  setDragging: (dragging) => {
    console.log(`[LayoutDragStore] Dragging state changed to: ${dragging}`);
    set({ isDragging: dragging });
  },
}));