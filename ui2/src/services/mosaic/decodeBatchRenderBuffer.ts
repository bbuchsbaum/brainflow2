/**
 * decodeBatchRenderBuffer
 *
 * Pure decoder for the packed buffer returned by the backend `batch_render_slices`
 * command. The buffer layout is:
 *
 *   [width u32][height u32][slice_count u32]   (little-endian header, 12 bytes)
 *   slice_count x (width * height * 4)         raw RGBA slabs, one per slice
 *
 * Each slab is copied into its own ImageData so the returned values never alias
 * the source ArrayBuffer.
 */

export interface DecodedSlice {
  width: number;
  height: number;
  image: ImageData;
}

export const BATCH_RENDER_HEADER_BYTES = 12;

export function decodeBatchRenderBuffer(buffer: ArrayBuffer): DecodedSlice[] {
  if (buffer.byteLength < BATCH_RENDER_HEADER_BYTES) {
    throw new Error(
      `Batch render buffer too small: ${buffer.byteLength} bytes (need at least ${BATCH_RENDER_HEADER_BYTES})`,
    );
  }

  const header = new DataView(buffer, 0, BATCH_RENDER_HEADER_BYTES);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const sliceCount = header.getUint32(8, true);

  if (width === 0 || height === 0) {
    throw new Error(`Batch render buffer has zero dimensions: ${width}x${height}`);
  }

  const bytesPerSlice = width * height * 4;
  const expectedBytes = BATCH_RENDER_HEADER_BYTES + sliceCount * bytesPerSlice;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `Batch render buffer truncated: have ${buffer.byteLength} bytes, ` +
        `need ${expectedBytes} for ${sliceCount} ${width}x${height} slices`,
    );
  }

  const slices: DecodedSlice[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const offset = BATCH_RENDER_HEADER_BYTES + i * bytesPerSlice;
    // Copy the slab so the returned ImageData does not alias the source buffer,
    // which the caller may reuse or free after decoding.
    const slab = new Uint8ClampedArray(buffer.slice(offset, offset + bytesPerSlice));
    slices.push({ width, height, image: new ImageData(slab, width, height) });
  }

  return slices;
}
