import { type ReactNode } from 'react';
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
export declare function SliceViewerImageSurface({ width, height, image, isLoading, error, className, canvasClassName, loadingFallback, errorFallback, emptyFallback, customRender, onCanvasReady, onImageReceived, }: SliceViewerImageSurfaceProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=SliceViewerImageSurface.d.ts.map