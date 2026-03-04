/**
 * Export Dialog Store
 *
 * Holds transient state for the Export Active View dialog, including
 * preview bytes/URL and export options.
 */

import { create } from 'zustand';
import type { ExportFormat } from '@/services/ViewExportService';

interface ExportDialogState {
  isOpen: boolean;
  isCapturing: boolean;
  error: string | null;

  format: ExportFormat;
  transparentBackground: boolean;
  suggestedName: string;

  bytes: Uint8Array | null;
  mime: string | null;
  imageUrl: string | null;

  open: () => void;
  close: () => void;
  setFormat: (format: ExportFormat) => void;
  setTransparentBackground: (value: boolean) => void;
  setSuggestedName: (name: string) => void;

  setCapturing: (value: boolean) => void;
  setError: (message: string | null) => void;
  setCaptureResult: (bytes: Uint8Array, mime: string, suggestedName: string) => void;
  clearCapture: () => void;
}

export const useExportDialogStore = create<ExportDialogState>((set, get) => ({
  isOpen: false,
  isCapturing: false,
  error: null,

  format: 'png',
  transparentBackground: false,
  suggestedName: '',

  bytes: null,
  mime: null,
  imageUrl: null,

  open: () => {
    // Reset capture state but keep last-used options.
    get().clearCapture();
    set({ isOpen: true, error: null });
  },

  close: () => {
    get().clearCapture();
    set({ isOpen: false });
  },

  setFormat: (format) => set({ format }),
  setTransparentBackground: (value) => set({ transparentBackground: value }),
  setSuggestedName: (name) => set({ suggestedName: name }),

  setCapturing: (value) => set({ isCapturing: value }),
  setError: (message) => set({ error: message }),

  setCaptureResult: (bytes, mime, suggestedName) => {
    const prevUrl = get().imageUrl;
    if (prevUrl) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        // Ignore revoke errors.
      }
    }

    const blob = new Blob([bytes], { type: mime });
    const imageUrl = URL.createObjectURL(blob);

    set({
      bytes,
      mime,
      imageUrl,
      suggestedName
    });
  },

  clearCapture: () => {
    const prevUrl = get().imageUrl;
    if (prevUrl) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        // Ignore.
      }
    }

    set({
      bytes: null,
      mime: null,
      imageUrl: null,
      isCapturing: false,
      error: null
    });
  }
}));

