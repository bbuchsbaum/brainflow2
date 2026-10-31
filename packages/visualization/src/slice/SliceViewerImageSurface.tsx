import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { drawScaledImage } from './canvasUtils.js';
import type { SliceViewerSurfaceProps } from './types.js';

export interface SliceViewerImageSurfaceProps extends SliceViewerSurfaceProps {
  image: ImageBitmap | null;
  isLoading?: boolean;
  error?: string | null;
  className?: string;
  canvasClassName?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
  emptyFallback?: ReactNode;
  onImageReceived?: (image: ImageBitmap) => void;
  /**
   * Draw the image mirrored left-right (a display convention such as
   * radiological). The placement passed on says so, so crosshair, clicks
   * and hover map through it unchanged.
   */
  mirrorX?: boolean;
}

export function SliceViewerImageSurface({
  width,
  height,
  image,
  isLoading = false,
  error = null,
  className = '',
  canvasClassName = '',
  loadingFallback,
  errorFallback,
  emptyFallback,
  customRender,
  onCanvasReady,
  onImageReceived,
  mirrorX = false,
}: SliceViewerImageSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!image) return;
    const placement = drawScaledImage(ctx, image, width, height, mirrorX);
    customRender(ctx, placement);
    onImageReceived?.(image);
  }, [customRender, height, image, onImageReceived, width, mirrorX]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`block ${canvasClassName}`}
      />
      {isLoading && loadingFallback}
      {error && errorFallback}
      {!image && !isLoading && !error && emptyFallback}
    </div>
  );
}
