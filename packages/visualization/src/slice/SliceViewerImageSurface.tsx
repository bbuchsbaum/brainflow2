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
}: SliceViewerImageSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    const placement = drawScaledImage(ctx, image, width, height);
    customRender(ctx, placement);
    onImageReceived?.(image);
  }, [customRender, height, image, onImageReceived, width]);

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
