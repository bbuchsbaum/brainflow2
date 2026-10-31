/**
 * ⇧⌘C "Copy view": the focused view's image on the clipboard. A focused
 * mosaic is copied as shown through the same composite capture as Export
 * (its tiles, colorbar and legend on black); if that capture fails, the last
 * rendered slice view of the tab is copied instead of nothing.
 */
import { getEventBus } from '@/events/EventBus';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { availableExportTargets, captureComposite, type CompositeRequest } from './compositeCapture';
import { EXPORT_PRESETS } from './compositeExport';
import { mirrorsView, useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';
import type { ViewType } from '@/types/coordinates';

/** The mosaic as shown: the page's tiles at screen size, framed like the view. */
export const MOSAIC_COPY_REQUEST: CompositeRequest = {
  frame: { ...EXPORT_PRESETS.shown },
  size: { kind: 'screen', scale: 1 },
  mosaicTiles: { kind: 'page' },
  cropToBrain: true,
};

const SLICE_VIEWS = ['axial', 'sagittal', 'coronal'] as const;

export interface CopyViewDeps {
  activeId: () => string | null;
  image: (id: string) => ImageBitmap | null;
  captureMosaic: () => Promise<Blob>;
  mosaicAvailable: () => boolean;
  write: (png: Blob) => Promise<void>;
  /** Whether the view is shown mirrored (radiological axial / coronal). */
  mirrored: (viewId: string) => boolean;
  bitmapToPng: (bitmap: ImageBitmap, mirrored: boolean) => Promise<Blob>;
  notify: (type: 'success' | 'warning' | 'error', message: string) => void;
}

const defaultDeps: CopyViewDeps = {
  activeId: () => useActiveRenderContextStore.getState().activeId,
  image: (id) => useRenderStateStore.getState().getState(id).lastImage,
  mosaicAvailable: () => availableExportTargets().includes('mosaic'),
  captureMosaic: async () => {
    const result = await captureComposite('mosaic', 'png', MOSAIC_COPY_REQUEST);
    return new Blob([result.bytes as BlobPart], { type: 'image/png' });
  },
  write: (png) => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
  mirrored: (viewId) =>
    mirrorsView(viewId as ViewType, useViewDisplaySettingsStore.getState().radiological),
  bitmapToPng: async (bitmap, mirrored) => {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    drawForCopy(ctx, bitmap, mirrored);
    return canvas.convertToBlob({ type: 'image/png' });
  },
  notify: (type, message) => getEventBus().emit('ui.notification', { type, message }),
};

/**
 * The copied pixels as the screen shows them: the backend bitmap is never
 * flipped, so a radiological axial / coronal pane is mirrored here.
 */
export function drawForCopy(
  ctx: Pick<OffscreenCanvasRenderingContext2D, 'translate' | 'scale' | 'drawImage'>,
  bitmap: ImageBitmap,
  mirrored: boolean,
): void {
  if (mirrored) {
    ctx.translate(bitmap.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(bitmap, 0, 0);
}

export async function copyActiveView(deps: CopyViewDeps = defaultDeps): Promise<void> {
  const activeId = deps.activeId();
  if (!activeId) {
    deps.notify('warning', 'No active view to copy');
    return;
  }
  const mosaic = activeId.startsWith('mosaic:');
  try {
    if (mosaic && deps.mosaicAvailable()) {
      try {
        await deps.write(await deps.captureMosaic());
        deps.notify('success', 'Mosaic copied to clipboard');
        return;
      } catch (error) {
        console.warn('[copyView] Mosaic capture failed; copying the last slice view:', error);
      }
    }
    // A mosaic has no single bitmap: the last rendered slice view of the tab.
    const sourceId = mosaic ? (SLICE_VIEWS.find((id) => deps.image(id)) ?? null) : activeId;
    const bitmap = sourceId ? deps.image(sourceId) : null;
    if (!sourceId || !bitmap) {
      deps.notify('warning', 'No rendered image available');
      return;
    }
    await deps.write(await deps.bitmapToPng(bitmap, deps.mirrored(sourceId)));
    deps.notify('success', 'View copied to clipboard');
  } catch (err) {
    console.error('[copyView] Copy view failed:', err);
    deps.notify('error', err instanceof Error ? err.message : 'Failed to copy to clipboard');
  }
}
