/**
 * Encoded image bytes mirrored left-right, for exports of a view the screen
 * shows mirrored (radiological axial / coronal, QA features 2026-10-31 §2).
 * The backend render is never flipped; only the exported pixels are.
 */

export interface MirrorEnv {
  decode: (bytes: Uint8Array, mime: string) => Promise<ImageBitmap>;
  canvas: (width: number, height: number) => OffscreenCanvas;
  encode: (canvas: OffscreenCanvas, mime: string) => Promise<Blob>;
}

const defaultEnv: MirrorEnv = {
  decode: (bytes, mime) => createImageBitmap(new Blob([bytes as BlobPart], { type: mime })),
  canvas: (width, height) => new OffscreenCanvas(width, height),
  encode: (canvas, mime) =>
    canvas.convertToBlob(mime === 'image/jpeg' ? { type: mime, quality: 0.95 } : { type: mime }),
};

/** Draw `image` mirrored: translate(width) · scale(−1, 1) · draw. */
export function drawMirrored(
  ctx: Pick<OffscreenCanvasRenderingContext2D, 'translate' | 'scale' | 'drawImage'>,
  image: CanvasImageSource & { width: number },
): void {
  ctx.translate(image.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0);
}

export async function mirrorEncodedImage(
  bytes: Uint8Array,
  mime: string,
  env: MirrorEnv = defaultEnv,
): Promise<Uint8Array> {
  const bitmap = await env.decode(bytes, mime);
  try {
    const canvas = env.canvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    drawMirrored(ctx, bitmap);
    return new Uint8Array(await (await env.encode(canvas, mime)).arrayBuffer());
  } finally {
    // Our own decode, never handed to a view: safe to close.
    bitmap.close?.();
  }
}
