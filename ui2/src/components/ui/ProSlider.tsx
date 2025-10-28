import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDragSourceStore } from '@/stores/dragSourceStore';

interface ProSliderProps {
  min: number;
  max: number;
  value: [number, number];
  label: string;
  onChange: (value: [number, number]) => void;
  precision?: number;
  showTooltip?: boolean;
  className?: string;
  disabled?: boolean;
}

export const ProSlider: React.FC<ProSliderProps> = ({
  min,
  max,
  value,
  label,
  onChange,
  precision = 0,
  showTooltip = true,
  className = '',
  disabled = false,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const [activeThumb, setActiveThumb] = useState<'left' | 'right' | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, right: 0 });
  const trackRef = useRef<HTMLDivElement>(null);
  const leftThumbRef = useRef<HTMLDivElement>(null);
  const rightThumbRef = useRef<HTMLDivElement>(null);
  
  // Track last update time for throttling
  const lastUpdateRef = useRef(0);
  const THROTTLE_MS = 50; // Update at most every 50ms
  
  // Track pending value for throttled updates
  const pendingValueRef = useRef<[number, number] | null>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Call onChange with throttling
  const handleValueChange = useCallback((newValue: [number, number]) => {
    setLocalValue(newValue);
    localValueRef.current = newValue; // Keep ref in sync immediately
    pendingValueRef.current = newValue;
    
    // Clear existing timeout
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
    }
    
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    
    if (timeSinceLastUpdate >= THROTTLE_MS) {
      // Send immediately if enough time has passed
      onChange(newValue);
      lastUpdateRef.current = now;
      pendingValueRef.current = null;
    } else {
      // Schedule update for later
      const delay = THROTTLE_MS - timeSinceLastUpdate;
      throttleTimeoutRef.current = setTimeout(() => {
        if (pendingValueRef.current) {
          onChange(pendingValueRef.current);
          lastUpdateRef.current = Date.now();
          pendingValueRef.current = null;
        }
      }, delay);
    }
  }, [onChange]);

  // Format value for display
  const formatValue = (val: number): string => {
    // Use consistent formatting
    if (val >= 1e4) return `${(val / 1000).toFixed(1)}K`;
    if (val <= -1e4) return `${(val / 1000).toFixed(1)}K`;
    return val.toFixed(0);
  };

  // Convert value to position percentage
  const valueToPercent = (val: number): number => {
    return ((val - min) / (max - min)) * 100;
  };

  // Convert position to value
  const percentToValue = useCallback((percent: number): number => {
    return min + (percent / 100) * (max - min);
  }, [min, max]);

  // Use refs to avoid stale closures
  const isDraggingRef = useRef(false);
  const activeThumbRef = useRef<'left' | 'right' | null>(null);
  const localValueRef = useRef(localValue);
  
  // Note: localValueRef is kept in sync in handleValueChange and prop sync effect
  
  // Handle thumb drag
  const handleThumbDrag = useCallback((e: MouseEvent) => {
    if (!trackRef.current || !activeThumbRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newValue = percentToValue(percent);

    const [currentLeft, currentRight] = localValueRef.current;
    let updatedValue: [number, number];
    
    if (activeThumbRef.current === 'left') {
      // Ensure left thumb doesn't go past right thumb
      updatedValue = [Math.min(newValue, currentRight), currentRight];
    } else {
      // Ensure right thumb doesn't go past left thumb
      updatedValue = [currentLeft, Math.max(newValue, currentLeft)];
    }
    
    handleValueChange(updatedValue);
  }, [min, max, percentToValue, handleValueChange]);

  // Create stable event handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        handleThumbDrag(e);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        activeThumbRef.current = null;
        setIsDragging(false);
        setActiveThumb(null);
        
        // Clear drag source
        useDragSourceStore.getState().setDraggingSource(null);
        
        // Clear any pending throttled update
        if (throttleTimeoutRef.current) {
          clearTimeout(throttleTimeoutRef.current);
          throttleTimeoutRef.current = null;
        }
        
        // Send final value immediately
        onChange(localValueRef.current);
        lastUpdateRef.current = 0;
        pendingValueRef.current = null;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleThumbDrag, onChange]);

  // Mouse event handlers
  const handleMouseDown = (thumb: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    isDraggingRef.current = true;
    activeThumbRef.current = thumb;
    setIsDragging(true);
    setActiveThumb(thumb);
    
    // Notify drag source store
    useDragSourceStore.getState().setDraggingSource('slider');
  };

  // Update tooltip positions
  useEffect(() => {
    const leftPercent = valueToPercent(localValue[0]);
    const rightPercent = valueToPercent(localValue[1]);
    setTooltipPosition({ left: leftPercent, right: rightPercent });
  }, [localValue, min, max]);

  // Sync local state from props when not dragging, but avoid churn on equal values
  useEffect(() => {
    if (!isDragging) {
      const [lv0, lv1] = localValueRef.current;
      if (lv0 !== value[0] || lv1 !== value[1]) {
        setLocalValue(value);
        localValueRef.current = value;
      }
    }
  }, [value, isDragging]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);

  const leftPercent = valueToPercent(localValue[0]);
  const rightPercent = valueToPercent(localValue[1]);

  return (
    <div className={`pro-slider ${className}`} style={{ marginBottom: '16px' }}>
      {/* Label */}
      <label className="block text-[13px] font-medium" style={{ color: 'var(--layer-text)', marginBottom: '6px' }}>
        {label}
      </label>
      
      {/* Value display */}
      <div className="flex justify-between text-[11px] font-mono tabular-nums text-neutral-400" style={{ marginBottom: '8px' }}>
        <span>{formatValue(localValue[0])}</span>
        <span>{formatValue(localValue[1])}</span>
      </div>

      {/* Slider track */}
      <div className={`relative h-8 flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div
          ref={trackRef}
          className="relative w-full h-[3px] rounded-full"
          style={{ backgroundColor: 'var(--layer-track-bg)' }}
        >
          {/* Selected range */}
          <div
            className="absolute h-full rounded-full"
            style={{
              backgroundColor: 'var(--layer-accent)',
              left: `${leftPercent}%`,
              width: `${rightPercent - leftPercent}%`
            }}
          />

          {/* Left thumb */}
          <div
            ref={leftThumbRef}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${leftPercent}%` }}
            onMouseDown={handleMouseDown('left')}
          >
            <div
              className="w-[14px] h-[14px] rounded-full border border-white shadow-[0_0_2px_black] transition-transform absolute top-[-5px]"
              style={{
                backgroundColor: 'var(--layer-accent)',
                transform: isDragging && activeThumb === 'left' ? 'scale(1.1)' : 'scale(1)'
              }}
            />
            {/* Tooltip */}
            {showTooltip && isDragging && activeThumb === 'left' && (
              <div
                className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 text-[11px] text-white rounded shadow-lg pointer-events-none whitespace-nowrap"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
              >
                {formatValue(localValue[0])}
              </div>
            )}
          </div>

          {/* Right thumb */}
          <div
            ref={rightThumbRef}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${rightPercent}%` }}
            onMouseDown={handleMouseDown('right')}
          >
            <div
              className="w-[14px] h-[14px] rounded-full border border-white shadow-[0_0_2px_black] transition-transform absolute top-[-5px]"
              style={{
                backgroundColor: 'var(--layer-accent)',
                transform: isDragging && activeThumb === 'right' ? 'scale(1.1)' : 'scale(1)'
              }}
            />
            {/* Tooltip */}
            {showTooltip && isDragging && activeThumb === 'right' && (
              <div
                className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 text-[11px] text-white rounded shadow-lg pointer-events-none whitespace-nowrap"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
              >
                {formatValue(localValue[1])}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
