import { describe, it, expect } from 'vitest';
import { decodeBatchRenderBuffer, BATCH_RENDER_HEADER_BYTES } from '../decodeBatchRenderBuffer';

/**
 * Build a packed buffer with a deterministic per-byte pattern so offset math can
 * be asserted exactly: byte i of slice s is (s * 31 + i) & 0xff.
 */
function makeBuffer(width: number, height: number, count: number): ArrayBuffer {
  const bytesPerSlice = width * height * 4;
  const buffer = new ArrayBuffer(BATCH_RENDER_HEADER_BYTES + count * bytesPerSlice);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  view.setUint32(8, count, true);
  const bytes = new Uint8Array(buffer);
  for (let s = 0; s < count; s++) {
    for (let i = 0; i < bytesPerSlice; i++) {
      bytes[BATCH_RENDER_HEADER_BYTES + s * bytesPerSlice + i] = (s * 31 + i) & 0xff;
    }
  }
  return buffer;
}

describe('decodeBatchRenderBuffer', () => {
  it('parses the little-endian header dimensions and slice count', () => {
    const slices = decodeBatchRenderBuffer(makeBuffer(3, 2, 4));
    expect(slices).toHaveLength(4);
    for (const slice of slices) {
      expect(slice.width).toBe(3);
      expect(slice.height).toBe(2);
      expect(slice.image.width).toBe(3);
      expect(slice.image.height).toBe(2);
      expect(slice.image.data).toHaveLength(3 * 2 * 4);
    }
  });

  it('reads each slice slab at the correct offset', () => {
    const width = 2;
    const height = 2;
    const count = 3;
    const slices = decodeBatchRenderBuffer(makeBuffer(width, height, count));
    const bytesPerSlice = width * height * 4;

    for (let s = 0; s < count; s++) {
      // First, middle, and last bytes of each slab prove the offset arithmetic.
      expect(slices[s].image.data[0]).toBe((s * 31 + 0) & 0xff);
      expect(slices[s].image.data[5]).toBe((s * 31 + 5) & 0xff);
      expect(slices[s].image.data[bytesPerSlice - 1]).toBe((s * 31 + (bytesPerSlice - 1)) & 0xff);
    }
  });

  it('returns an empty array when the slice count is zero', () => {
    expect(decodeBatchRenderBuffer(makeBuffer(4, 4, 0))).toEqual([]);
  });

  it('does not alias the source buffer', () => {
    const buffer = makeBuffer(2, 2, 1);
    const slices = decodeBatchRenderBuffer(buffer);
    // Mutating the source must not change the decoded ImageData.
    new Uint8Array(buffer).fill(0);
    expect(slices[0].image.data[5]).toBe(5 & 0xff);
  });

  it('throws when the buffer is smaller than the header', () => {
    expect(() => decodeBatchRenderBuffer(new ArrayBuffer(8))).toThrow(/too small/);
  });

  it('throws on zero dimensions', () => {
    const buffer = new ArrayBuffer(BATCH_RENDER_HEADER_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, 0, true);
    view.setUint32(4, 4, true);
    view.setUint32(8, 0, true);
    expect(() => decodeBatchRenderBuffer(buffer)).toThrow(/zero dimensions/);
  });

  it('throws when the buffer is truncated for the declared slice count', () => {
    // Header claims 3 slices but only one slab of bytes follows.
    const full = makeBuffer(2, 2, 3);
    const truncated = full.slice(0, BATCH_RENDER_HEADER_BYTES + 2 * 2 * 4);
    expect(() => decodeBatchRenderBuffer(truncated)).toThrow(/truncated/);
  });
});
