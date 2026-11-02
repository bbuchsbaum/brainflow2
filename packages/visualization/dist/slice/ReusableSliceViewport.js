import { jsx as _jsx } from "react/jsx-runtime";
import { useSliceViewerController } from './useSliceViewerController.js';
export function ReusableSliceViewport({ width, height, viewPlane, crosshair, crosshairStyle, showSliceBorder = false, sliceBorderWidth = 1, className = '', onCanvasReady, onPlacementChange, onWorldClick, onMouseDown, customRender, tool, renderSurface, }) {
    const { handleCanvasReady, handleMouseDown, handleRender, pointerHandlers } = useSliceViewerController({
        viewPlane,
        crosshair,
        crosshairStyle,
        showSliceBorder,
        sliceBorderWidth,
        onCanvasReady,
        onPlacementChange,
        onWorldClick,
        onMouseDown,
        customRender,
        tool,
    });
    return (_jsx("div", { className: `relative h-full w-full ${className}`, style: tool ? { touchAction: 'none' } : undefined, ...pointerHandlers, onMouseDown: handleMouseDown, children: renderSurface({
            width,
            height,
            customRender: handleRender,
            onCanvasReady: handleCanvasReady,
        }) }));
}
//# sourceMappingURL=ReusableSliceViewport.js.map