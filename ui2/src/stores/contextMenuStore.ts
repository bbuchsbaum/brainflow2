/**
 * ContextMenuStore
 *
 * Lightweight global context menu state. Any component can open a menu
 * at a screen position with a list of items. A single overlay renders
 * the current menu.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ReactNode } from 'react';

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  open: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>()(
  subscribeWithSelector((set, get) => ({
    isOpen: false,
    x: 0,
    y: 0,
    items: [],

    open: (x, y, items) => {
      set({ isOpen: true, x, y, items });
    },

    close: () => {
      if (!get().isOpen) return;
      set({ isOpen: false, items: [] });
    }
  }))
);

