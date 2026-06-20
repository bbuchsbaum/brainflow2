import { useCallback, useEffect, useMemo, useRef } from 'react';
import { drawSliceBorder, drawSliceViewerCrosshair } from './drawing.js';
import { clientPointToWorld, projectWorldToCanvas } from './geometry.js';
export function useSliceViewerController({ viewPlane, crosshair, crosshairStyle, showSliceBorder = false, sliceBorderWidth = 1, onCanvasReady, onPlacementChange, onWorldClick, onMouseDown, customRender, }) {
    const canvasRef = useRef(null);
    const placementRef = useRef(null);
    const viewPlaneRef = useRef(viewPlane ?? null);
    const crosshairRef = useRef(crosshair ?? null);
    const crosshairStyleRef = useRef(crosshairStyle ?? null);
    const showSliceBorderRef = useRef(showSliceBorder);
    const sliceBorderWidthRef = useRef(sliceBorderWidth);
    const customRenderRef = useRef(customRender);
    const onPlacementChangeRef = useRef(onPlacementChange);
    useEffect(() => {
        viewPlaneRef.current = viewPlane ?? null;
    }, [viewPlane]);
    useEffect(() => {
        crosshairRef.current = crosshair ?? null;
    }, [crosshair]);
    useEffect(() => {
        crosshairStyleRef.current = crosshairStyle ?? null;
    }, [crosshairStyle]);
    useEffect(() => {
        showSliceBorderRef.current = showSliceBorder;
    }, [showSliceBorder]);
    useEffect(() => {
        sliceBorderWidthRef.current = sliceBorderWidth;
    }, [sliceBorderWidth]);
    useEffect(() => {
        customRenderRef.current = customRender;
    }, [customRender]);
    useEffect(() => {
        onPlacementChangeRef.current = onPlacementChange;
    }, [onPlacementChange]);
    const handleCanvasReady = useCallback((canvas) => {
        canvasRef.current = canvas;
        onCanvasReady?.(canvas);
    }, [onCanvasReady]);
    const handleRender = useMemo(() => {
        return (ctx, placement) => {
            placementRef.current = placement;
            onPlacementChangeRef.current?.(placement);
            customRenderRef.current?.(ctx, placement);
            if (showSliceBorderRef.current) {
                drawSliceBorder(ctx, placement, sliceBorderWidthRef.current);
            }
            const currentCrosshair = crosshairRef.current;
            const currentStyle = crosshairStyleRef.current;
            const currentViewPlane = viewPlaneRef.current;
            if (!currentCrosshair?.visible || !currentStyle || !currentViewPlane) {
                return;
            }
            const canvasPoint = projectWorldToCanvas(currentCrosshair.world_mm, currentViewPlane, placement);
            if (!canvasPoint)
                return;
            drawSliceViewerCrosshair({
                ctx,
                canvasX: canvasPoint.canvasX,
                canvasY: canvasPoint.canvasY,
                bounds: placement,
                style: currentStyle,
            });
        };
    }, []);
    const handleMouseDown = useCallback((event) => {
        onMouseDown?.(event);
        if (event.defaultPrevented || event.button !== 0 || !onWorldClick)
            return;
        if (!canvasRef.current || !placementRef.current)
            return;
        const currentViewPlane = viewPlaneRef.current;
        if (!currentViewPlane)
            return;
        const worldCoord = clientPointToWorld(event.clientX, event.clientY, canvasRef.current, placementRef.current, currentViewPlane);
        if (!worldCoord)
            return;
        onWorldClick(worldCoord, event);
    }, [onMouseDown, onWorldClick]);
    return {
        handleCanvasReady,
        handleMouseDown,
        handleRender,
    };
}
//# sourceMappingURL=useSliceViewerController.js.map