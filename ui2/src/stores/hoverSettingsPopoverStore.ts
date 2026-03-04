/**
 * HoverSettingsPopoverStore
 *
 * Controls the open/close state and position of the hover settings popover.
 */

import { create } from 'zustand';

interface HoverSettingsPopoverState {
  isOpen: boolean;
  x: number;
  y: number;
  open: (x: number, y: number) => void;
  close: () => void;
  toggle: (x: number, y: number) => void;
}

export const useHoverSettingsPopoverStore = create<HoverSettingsPopoverState>()(
  (set, get) => ({
    isOpen: false,
    x: 0,
    y: 0,

    open: (x, y) => {
      set({ isOpen: true, x, y });
    },

    close: () => {
      if (!get().isOpen) return;
      set({ isOpen: false });
    },

    toggle: (x, y) => {
      const { isOpen } = get();
      if (isOpen) {
        set({ isOpen: false });
      } else {
        set({ isOpen: true, x, y });
      }
    },
  })
);
