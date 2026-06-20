import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef } from 'react';
import { drawScaledImage } from './canvasUtils.js';
export function SliceViewerImageSurface({ width, height, image, isLoading = false, error = null, className = '', canvasClassName = '', loadingFallback, errorFallback, emptyFallback, customRender, onCanvasReady, onImageReceived, }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        if (canvasRef.current) {
            onCanvasReady(canvasRef.current);
        }
    }, [onCanvasReady]);
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !image)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, width, height);
        const placement = drawScaledImage(ctx, image, width, height);
        customRender(ctx, placement);
        onImageReceived?.(image);
    }, [customRender, height, image, onImageReceived, width]);
    return (_jsxs("div", { className: `relative h-full w-full ${className}`, children: [_jsx("canvas", { ref: canvasRef, width: width, height: height, className: `block ${canvasClassName}` }), isLoading && loadingFallback, error && errorFallback, !image && !isLoading && !error && emptyFallback] }));
}
//# sourceMappingURL=SliceViewerImageSurface.js.map