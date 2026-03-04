import { useRef, useCallback, useEffect, useState } from 'react';

interface UseWindowLevelOptions {
  canvasRef: React.RefObject<HTMLElement | null>;
  layerId: string | null;
  dataRange: { min: number; max: number } | null;
  onUpdate: (intensity: [number, number]) => void;
}

interface OverlayProps {
  style: React.CSSProperties;
  children: string;
}

interface UseWindowLevelReturn {
  isDragging: boolean;
  overlayProps: OverlayProps | null;
}

const DRAG_THRESHOLD = 3;

export function useWindowLevel({
  canvasRef,
  layerId,
  dataRange,
  onUpdate,
}: UseWindowLevelOptions): UseWindowLevelReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [overlayText, setOverlayText] = useState<string | null>(null);

  // Mutable drag state stored in ref to avoid stale closures in event listeners
  const dragState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startCenter: number;
    startWidth: number;
    thresholdMet: boolean;
  } | null>(null);

  // Keep latest values in refs so event listeners always see fresh values
  const dataRangeRef = useRef(dataRange);
  useEffect(() => { dataRangeRef.current = dataRange; }, [dataRange]);

  const layerIdRef = useRef(layerId);
  useEffect(() => { layerIdRef.current = layerId; }, [layerId]);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 2) return;
    if (!layerIdRef.current || !dataRangeRef.current) return;

    const range = dataRangeRef.current;
    const center = (range.min + range.max) / 2;
    const width = range.max - range.min;

    dragState.current = {
      active: false,
      startX: e.clientX,
      startY: e.clientY,
      startCenter: center,
      startWidth: width,
      thresholdMet: false,
    };
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const state = dragState.current;
    if (!state) return;
    if (!dataRangeRef.current) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!state.thresholdMet) {
      if (dist < DRAG_THRESHOLD) return;
      state.thresholdMet = true;
      state.active = true;
      setIsDragging(true);
    }

    const range = dataRangeRef.current;
    const totalRange = range.max - range.min;

    // Get canvas pixel width for sensitivity calculation
    const el = canvasRef.current;
    const canvasPixelWidth = el ? el.clientWidth : 512;
    const sensitivity = totalRange / canvasPixelWidth;

    // Horizontal drag → window width (contrast)
    // Vertical drag → center (brightness)
    let newWidth = Math.max(0, state.startWidth + dx * sensitivity);
    let newCenter = state.startCenter - dy * sensitivity;

    // Clamp so [center - width/2, center + width/2] stays within data range
    const half = newWidth / 2;
    newCenter = Math.max(range.min + half, Math.min(range.max - half, newCenter));

    const newMin = newCenter - half;
    const newMax = newCenter + half;

    setOverlayText(`W: ${newWidth.toFixed(1)} L: ${newCenter.toFixed(1)}`);
    onUpdateRef.current([newMin, newMax]);
  }, [canvasRef]);

  const handleMouseUp = useCallback(() => {
    if (!dragState.current?.thresholdMet) {
      dragState.current = null;
      return;
    }
    dragState.current = null;
    setIsDragging(false);
    setOverlayText(null);
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (dragState.current?.thresholdMet) {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    el.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    el.addEventListener('contextmenu', handleContextMenu);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      el.removeEventListener('contextmenu', handleContextMenu);
      // Clean up any in-progress drag state
      dragState.current = null;
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleContextMenu, canvasRef]);

  const overlayProps: OverlayProps | null = isDragging && overlayText
    ? {
        style: {
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.65)',
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: '13px',
          padding: '4px 10px',
          borderRadius: '4px',
          pointerEvents: 'none',
          zIndex: 50,
          whiteSpace: 'nowrap',
        },
        children: overlayText,
      }
    : null;

  return { isDragging, overlayProps };
}
