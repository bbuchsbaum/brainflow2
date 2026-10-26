/**
 * Export Dialog Store
 *
 * Holds transient state for the Export Active View dialog, including
 * preview bytes/URL and export options.
 */

import { create } from 'zustand';
import type { CaptureTarget, ExportFormat } from '@/services/ViewExportService';
import type { ViewType } from '@/types/coordinates';

interface ExportDialogState {
  isOpen: boolean;
  isCapturing: boolean;
  error: string | null;

  format: ExportFormat;
  transparentBackground: boolean;
  suggestedName: string;
  /** The user typed the file name: recaptures keep it (only the extension follows the format). */
  nameEdited: boolean;
  /** Slice view to export (null: the last interacted view, resolved on capture). */
  viewType: ViewType | null;
  /** What the last capture shows (the dialog's View line). */
  target: CaptureTarget | null;

  bytes: Uint8Array | null;
  mime: string | null;
  imageUrl: string | null;

  open: () => void;
  close: () => void;
  setFormat: (format: ExportFormat) => void;
  setTransparentBackground: (value: boolean) => void;
  setSuggestedName: (name: string) => void;
  setViewType: (viewType: ViewType) => void;

  setCapturing: (value: boolean) => void;
  setError: (message: string | null) => void;
  setCaptureResult: (
    bytes: Uint8Array,
    mime: string,
    suggestedName: string,
    target?: CaptureTarget | null,
  ) => void;
  clearCapture: () => void;
}

export const useExportDialogStore = create<ExportDialogState>((set, get) => ({
  isOpen: false,
  isCapturing: false,
  error: null,

  format: 'png',
  transparentBackground: false,
  suggestedName: '',
  nameEdited: false,
  viewType: null,
  target: null,

  bytes: null,
  mime: null,
  imageUrl: null,

  open: () => {
    // Reset capture state but keep last-used options.
    get().clearCapture();
    set({ isOpen: true, error: null, nameEdited: false, viewType: null, target: null });
  },

  close: () => {
    get().clearCapture();
    set({ isOpen: false });
  },

  setFormat: (format) => set({ format }),
  setTransparentBackground: (value) => set({ transparentBackground: value }),
  setSuggestedName: (name) => set({ suggestedName: name, nameEdited: true }),
  setViewType: (viewType) => set({ viewType }),

  setCapturing: (value) => set({ isCapturing: value }),
  setError: (message) => set({ error: message }),

  setCaptureResult: (bytes, mime, suggestedName, target = null) => {
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

    // A typed name survives recaptures (format or view changes): only its
    // extension follows the format.
    const { nameEdited, suggestedName: typed } = get();
    const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
    set({
      bytes,
      mime,
      imageUrl,
      target: target ?? null,
      suggestedName: nameEdited ? typed.replace(/\.(png|jpe?g)$/i, '') + `.${ext}` : suggestedName,
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

