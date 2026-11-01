import { describe, expect, it, vi } from 'vitest';
import { mirrorEncodedImage, type MirrorEnv } from '../mirrorImage';

/** Exports of a radiological axial / coronal view are mirrored (QA features 2026-10-31 §2). */
describe('mirrorEncodedImage', () => {
  it('decodes, draws translate(width) · scale(−1, 1) · draw, re-encodes in the same type, closes the decode', async () => {
    const calls: string[] = [];
    const close = vi.fn();
    const bitmap = { width: 40, height: 30, close } as unknown as ImageBitmap;
    const ctx = {
      translate: (x: number, y: number) => void calls.push(`translate ${x} ${y}`),
      scale: (x: number, y: number) => void calls.push(`scale ${x} ${y}`),
      drawImage: (_b: unknown, x: number, y: number) => void calls.push(`draw ${x} ${y}`),
    };
    const out = new Uint8Array([9, 9]);
    const env: MirrorEnv = {
      decode: vi.fn(async () => bitmap),
      canvas: vi.fn((w: number, h: number) => {
        calls.push(`canvas ${w}x${h}`);
        return { getContext: () => ctx } as unknown as OffscreenCanvas;
      }),
      encode: vi.fn(async (_c: OffscreenCanvas, mime: string) => {
        calls.push(`encode ${mime}`);
        return { arrayBuffer: async () => out.buffer } as unknown as Blob;
      }),
    };
    const result = await mirrorEncodedImage(new Uint8Array([1, 2, 3]), 'image/jpeg', env);
    expect(calls).toEqual(['canvas 40x30', 'translate 40 0', 'scale -1 1', 'draw 0 0', 'encode image/jpeg']);
    expect(Array.from(result)).toEqual([9, 9]);
    expect(close).toHaveBeenCalled();
  });
});
