/**
 * Export Dialog Store
 *
 * Holds transient state for the Export Active View dialog, including
 * preview bytes/URL and export options.
 */

import { create } from 'zustand';
import type { CaptureTarget, ExportFormat } from '@/services/ViewExportService';
import type { ViewType } from '@/types/coordinates';
import type { ExportTarget, MosaicTileSpec } from '@/services/export/compositeCapture';
import {
  EXPORT_PRESETS,
  type ExportPreset,
  type FrameIncludes,
  type SizeSpec,
} from '@/services/export/compositeExport';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** The active workspace's id (the key the chosen View is remembered under). */
function activeWorkspaceKey(): string | null {
  const ws = useWorkspaceStore.getState();
  return ws.activeWorkspaceId ?? ws.getActiveWorkspace?.()?.id ?? null;
}

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
  /**
   * Composited export target (null: resolved from the active view on capture).
   * Opening restores the View last chosen in the active workspace; the dialog
   * falls back to the active panel only when that target is not available.
   */
  exportTarget: ExportTarget | null;
  /** The View last chosen, per workspace id. Kept across openings. */
  exportTargetByWorkspace: Record<string, ExportTarget>;
  /** What the frame includes (P3.8). Kept across openings. */
  composite: FrameIncludes;
  /** Output size: a screen multiple or a print width at a dpi. */
  size: SizeSpec;
  /** Embed a provenance record in the file. */
  provenance: boolean;
  /** Mosaic: this page, or a slice range. */
  mosaicTiles: MosaicTileSpec;
  /** Crop panes to the brain (+6%); on for the Figure preset. */
  cropToBrain: boolean;
  /** Montage columns (null: the default for the size). */
  mosaicColumns: number | null;
  /** Device-pixel size of the last composition. */
  outputSize: { width: number; height: number } | null;

  bytes: Uint8Array | null;
  mime: string | null;
  imageUrl: string | null;

  open: () => void;
  close: () => void;
  setFormat: (format: ExportFormat) => void;
  setTransparentBackground: (value: boolean) => void;
  setSuggestedName: (name: string) => void;
  setViewType: (viewType: ViewType) => void;
  setExportTarget: (target: ExportTarget) => void;
  setComposite: (patch: Partial<FrameIncludes>) => void;
  setSize: (size: SizeSpec) => void;
  setProvenance: (value: boolean) => void;
  setMosaicTiles: (spec: MosaicTileSpec) => void;
  setCropToBrain: (value: boolean) => void;
  setMosaicColumns: (value: number | null) => void;
  applyPreset: (preset: ExportPreset) => void;
  setOutputSize: (size: { width: number; height: number } | null) => void;

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

function rememberedTarget(byWorkspace: Record<string, ExportTarget> | undefined): ExportTarget | null {
  const key = activeWorkspaceKey();
  return (key && byWorkspace?.[key]) || null;
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
  exportTarget: null,
  exportTargetByWorkspace: {},
  // Default: everything but the crosshair, on white (v2 user critic).
  composite: { ...EXPORT_PRESETS.figure },
  size: { kind: 'screen', scale: 2 },
  provenance: false,
  mosaicTiles: { kind: 'page' },
  cropToBrain: true,
  mosaicColumns: null,
  outputSize: null,

  bytes: null,
  mime: null,
  imageUrl: null,

  open: () => {
    // Reset capture state but keep last-used options.
    get().clearCapture();
    set({
      isOpen: true,
      error: null,
      nameEdited: false,
      viewType: null,
      target: null,
      exportTarget: rememberedTarget(get().exportTargetByWorkspace),
      outputSize: null,
    });
  },

  close: () => {
    get().clearCapture();
    set({ isOpen: false });
  },

  setFormat: (format) => set({ format }),
  setTransparentBackground: (value) => set({ transparentBackground: value }),
  setSuggestedName: (name) => set({ suggestedName: name, nameEdited: true }),
  setViewType: (viewType) => set({ viewType }),
  setExportTarget: (exportTarget) => {
    const key = activeWorkspaceKey();
    set((state) => ({
      exportTarget,
      exportTargetByWorkspace: key
        ? { ...state.exportTargetByWorkspace, [key]: exportTarget }
        : state.exportTargetByWorkspace,
    }));
  },
  setComposite: (patch) => set((state) => ({ composite: { ...state.composite, ...patch } })),
  // A figure is cropped to the brain; "As shown" keeps the view's field.
  applyPreset: (preset) =>
    set({ composite: { ...EXPORT_PRESETS[preset] }, cropToBrain: preset === 'figure' }),
  setCropToBrain: (cropToBrain) => set({ cropToBrain }),
  setMosaicColumns: (mosaicColumns) => set({ mosaicColumns }),
  setSize: (size) => set({ size }),
  setProvenance: (provenance) => set({ provenance }),
  setMosaicTiles: (mosaicTiles) => set({ mosaicTiles }),
  setOutputSize: (outputSize) => set({ outputSize }),

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

