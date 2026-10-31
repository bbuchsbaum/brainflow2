import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ViewExportService', () => ({ getViewExportService: () => ({}) }));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { copyActiveView, drawForCopy, MOSAIC_COPY_REQUEST, type CopyViewDeps } from '../copyView';

/** ⇧⌘C with a focused mosaic copies the mosaic as shown (features 2026-10-31 §3 follow-up). */
const bitmap = (w: number) => ({ width: w, height: w }) as ImageBitmap;
const mosaicPng = new Blob(['mosaic'], { type: 'image/png' });
const slicePngs = new Map<number, Blob>();
const slicePng = (w: number) => {
  if (!slicePngs.has(w)) slicePngs.set(w, new Blob([`slice ${w}`], { type: 'image/png' }));
  return slicePngs.get(w)!;
};
const deps = (over: Partial<CopyViewDeps> = {}): CopyViewDeps & { written: Blob[]; notes: string[] } => {
  const written: Blob[] = [];
  const notes: string[] = [];
  return {
    written,
    notes,
    activeId: () => 'mosaic:ws',
    image: () => null,
    mosaicAvailable: () => true,
    captureMosaic: async () => mosaicPng,
    write: async (png) => void written.push(png),
    mirrored: () => false,
    bitmapToPng: async (b) => slicePng(b.width),
    notify: (type, message) => void notes.push(`${type}: ${message}`),
    ...over,
  };
};

describe('copyActiveView', () => {
  it('copies a focused mosaic through the composite capture, as shown', async () => {
    const d = deps();
    await copyActiveView(d);
    expect(d.written).toHaveLength(1);
    expect(d.written[0]).toBe(mosaicPng);
    expect(d.notes).toEqual(['success: Mosaic copied to clipboard']);
    expect(MOSAIC_COPY_REQUEST.frame.background).toBe('black');
    expect(MOSAIC_COPY_REQUEST.mosaicTiles).toEqual({ kind: 'page' });
  });

  it('falls back to the last rendered slice view when the capture fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({
      captureMosaic: async () => {
        throw new Error('render_view failed');
      },
      image: (id) => (id === 'sagittal' ? bitmap(7) : null),
    });
    await copyActiveView(d);
    expect(d.written[0]).toBe(slicePng(7));
    expect(d.notes).toEqual(['success: View copied to clipboard']);
    warn.mockRestore();
  });

  it('a slice view copies its own image; nothing rendered says so', async () => {
    const d = deps({ activeId: () => 'axial', image: (id) => (id === 'axial' ? bitmap(3) : null) });
    await copyActiveView(d);
    expect(d.written[0]).toBe(slicePng(3));
    const empty = deps({ activeId: () => 'coronal' });
    await copyActiveView(empty);
    expect(empty.notes).toEqual(['warning: No rendered image available']);
    const none = deps({ activeId: () => null });
    await copyActiveView(none);
    expect(none.notes).toEqual(['warning: No active view to copy']);
  });

  it('a radiological axial view is copied mirrored, a sagittal one as is (QA features §2)', async () => {
    const asked: Array<[number, boolean]> = [];
    const d = deps({
      activeId: () => 'axial',
      image: (id) => (id === 'axial' ? bitmap(5) : bitmap(9)),
      mirrored: (id) => id === 'axial',
      bitmapToPng: async (b, m) => {
        asked.push([b.width, m]);
        return slicePng(b.width);
      },
    });
    await copyActiveView(d);
    await copyActiveView({ ...d, activeId: () => 'sagittal' });
    expect(asked).toEqual([
      [5, true],
      [9, false],
    ]);
  });

  it('draws mirrored as translate(width) · scale(−1, 1) · draw; unmirrored draws only', () => {
    const calls: string[] = [];
    const ctx = {
      translate: (x: number, y: number) => void calls.push(`translate ${x} ${y}`),
      scale: (x: number, y: number) => void calls.push(`scale ${x} ${y}`),
      drawImage: (_b: unknown, x: number, y: number) => void calls.push(`draw ${x} ${y}`),
    } as never;
    drawForCopy(ctx, bitmap(64), true);
    expect(calls).toEqual(['translate 64 0', 'scale -1 1', 'draw 0 0']);
    calls.length = 0;
    drawForCopy(ctx, bitmap(64), false);
    expect(calls).toEqual(['draw 0 0']);
  });
});
