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
  /**
   * Compact mode: tighter spacing + smaller thumbs/track for dense grids
   */
  compact?: boolean;
  /**
   * High contrast mode: use direct foreground tokens (bypasses inherited text colors)
   */
  highContrast?: boolean;
  /**
   * Layout mode: stacked (label above) or strip (label left)
   */
  layout?: 'stacked' | 'strip';
  /**
   * Optional widths for strip layout
   */
  labelWidth?: string | number;
  valueWidth?: string | number;
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
  compact = false,
  highContrast = false,
  layout = 'stacked',
  labelWidth,
  valueWidth,
}) => {
  // Ensure we always have a valid [number, number] tuple
  const safeValue: [number, number] = Array.isArray(value) && value.length >= 2
    ? [value[0], value[1]]
    : [min, max];

  const [localValue, setLocalValue] = useState(safeValue);
  const [isDragging, setIsDragging] = useState(false);
  const [activeThumb, setActiveThumb] = useState<'left' | 'right' | null>(null);
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
    // Use consistent formatting with appropriate precision
    if (val >= 1e4) return `${(val / 1000).toFixed(1)}K`;
    if (val <= -1e4) return `${(val / 1000).toFixed(1)}K`;
    return val.toFixed(precision);
  };

  // Convert value to position percentage
  const valueToPercent = (val: number): number => {
    // Guard against division by zero when min === max
    if (max === min) return 50; // Center the thumb when range is zero
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

  // Sync local state from props when not dragging, but avoid churn on equal values
  useEffect(() => {
    if (!isDragging) {
      // Ensure we always have a valid [number, number] tuple when syncing from props
      const safeNewValue: [number, number] = Array.isArray(value) && value.length >= 2
        ? [value[0], value[1]]
        : [min, max];
      const [lv0, lv1] = localValueRef.current;
      if (lv0 !== safeNewValue[0] || lv1 !== safeNewValue[1]) {
        setLocalValue(safeNewValue);
        localValueRef.current = safeNewValue;
      }
    }
  }, [value, isDragging, min, max]);
  
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

  const labelColor = highContrast ? 'hsl(var(--foreground) / 0.92)' : 'hsl(var(--foreground) / 0.72)';
  const valueColor = highContrast ? 'hsl(var(--foreground) / 0.82)' : 'hsl(var(--foreground) / 0.65)';
  const trackColor = 'hsl(var(--border) / 0.7)';
  const accentColor = 'hsl(var(--primary))';
  const thumbWidth = compact ? 6 : 8;
  const thumbHeight = compact ? 12 : 16;
  const thumbOffset = compact ? -5 : -7;
  const valueFontClass = compact ? 'text-[9px]' : 'text-[11px]';
  const labelFontClass = compact ? 'text-[9px]' : 'text-[10px]';
  const containerMargin = compact ? '6px' : '12px';
  const valueMargin = compact ? '4px' : '8px';
  const trackHeightClass = compact ? 'h-4' : 'h-6';
  const tooltipFontClass = compact ? 'text-[9px]' : 'text-[10px]';
  const stripLabelWidth = labelWidth ?? '6rem';
  const stripValueWidth = valueWidth ?? '4.5rem';

  if (layout === 'strip') {
    const combinedValue = `${formatValue(localValue[0])}–${formatValue(localValue[1])}`;
    return (
      <div
        className={`pro-slider-strip flex items-center gap-3 py-1.5 border-b border-border/40 last:border-b-0 ${className}`}
        style={{ marginBottom: 0 }}
      >
        <label
          className="text-[10px] uppercase tracking-wider font-bold text-right shrink-0 truncate"
          style={{ color: labelColor, width: stripLabelWidth }}
        >
          {label}
        </label>

        <div className={`flex-1 relative h-4 flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div
            ref={trackRef}
            className="relative w-full h-[2px]"
            style={{ backgroundColor: trackColor, overflow: 'visible' }}
          >
            <div
              className="absolute h-full"
              style={{
                backgroundColor: accentColor,
                left: `${leftPercent}%`,
                width: `${rightPercent - leftPercent}%`
              }}
            />

            <div
              ref={leftThumbRef}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
              style={{ left: `${leftPercent}%` }}
              onMouseDown={handleMouseDown('left')}
            >
              <div
                className="transition-all absolute"
                style={{
                  backgroundColor: accentColor,
                  borderRadius: '1px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                  transform: isDragging && activeThumb === 'left' ? 'scaleY(1.1)' : 'scaleY(1)',
                  width: `${thumbWidth}px`,
                  height: `${thumbHeight}px`,
                  top: `${thumbOffset}px`
                }}
              />
              {showTooltip && isDragging && activeThumb === 'left' && (
                <div
                  className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 ${tooltipFontClass} font-mono text-white shadow-lg pointer-events-none whitespace-nowrap`}
                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
                >
                  {formatValue(localValue[0])}
                </div>
              )}
            </div>

            <div
              ref={rightThumbRef}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
              style={{ left: `${rightPercent}%` }}
              onMouseDown={handleMouseDown('right')}
            >
              <div
                className="transition-all absolute"
                style={{
                  backgroundColor: accentColor,
                  borderRadius: '1px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                  transform: isDragging && activeThumb === 'right' ? 'scaleY(1.1)' : 'scaleY(1)',
                  width: `${thumbWidth}px`,
                  height: `${thumbHeight}px`,
                  top: `${thumbOffset}px`
                }}
              />
              {showTooltip && isDragging && activeThumb === 'right' && (
                <div
                  className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 ${tooltipFontClass} font-mono text-white shadow-lg pointer-events-none whitespace-nowrap`}
                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
                >
                  {formatValue(localValue[1])}
                </div>
              )}
            </div>
          </div>
        </div>

        <span
          className="text-[10px] font-mono tabular-nums text-right shrink-0"
          style={{ color: valueColor, width: stripValueWidth }}
        >
          {combinedValue}
        </span>
      </div>
    );
  }


  return (
    <div className={`pro-slider ${className}`} style={{ marginBottom: containerMargin }}>
      {/* Label - Instrument Control style */}
      <label
        className={`block ${labelFontClass} uppercase tracking-widest font-semibold`}
        style={{ color: labelColor, marginBottom: compact ? '4px' : '6px' }}
      >
        {label}
      </label>

      {/* Value display - monospace for numeric data */}
      <div
        className={`flex justify-between ${valueFontClass} font-mono tabular-nums`}
        style={{ color: valueColor, marginBottom: valueMargin }}
      >
        <span>{formatValue(localValue[0])}</span>
        <span>{formatValue(localValue[1])}</span>
      </div>

      {/* Slider track - thin 2px track */}
      <div className={`relative ${trackHeightClass} flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div
          ref={trackRef}
          className="relative w-full h-[2px]"
          style={{ backgroundColor: trackColor, overflow: 'visible' }}
        >
          {/* Selected range - no border-radius */}
          <div
            className="absolute h-full"
            style={{
              backgroundColor: accentColor,
              left: `${leftPercent}%`,
              width: `${rightPercent - leftPercent}%`
            }}
          />

          {/* Left thumb - rectangular Albers style */}
          <div
            ref={leftThumbRef}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${leftPercent}%` }}
            onMouseDown={handleMouseDown('left')}
          >
            <div
              className="transition-all absolute"
              style={{
                backgroundColor: accentColor,
                borderRadius: '1px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                transform: isDragging && activeThumb === 'left' ? 'scaleY(1.1)' : 'scaleY(1)',
                width: `${thumbWidth}px`,
                height: `${thumbHeight}px`,
                top: `${thumbOffset}px`
              }}
            />
            {/* Tooltip */}
            {showTooltip && isDragging && activeThumb === 'left' && (
              <div
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 ${tooltipFontClass} font-mono text-white shadow-lg pointer-events-none whitespace-nowrap`}
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
              >
                {formatValue(localValue[0])}
              </div>
            )}
          </div>

          {/* Right thumb - rectangular Albers style */}
          <div
            ref={rightThumbRef}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${rightPercent}%` }}
            onMouseDown={handleMouseDown('right')}
          >
            <div
              className="transition-all absolute"
              style={{
                backgroundColor: accentColor,
                borderRadius: '1px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                transform: isDragging && activeThumb === 'right' ? 'scaleY(1.1)' : 'scaleY(1)',
                width: `${thumbWidth}px`,
                height: `${thumbHeight}px`,
                top: `${thumbOffset}px`
              }}
            />
            {/* Tooltip */}
            {showTooltip && isDragging && activeThumb === 'right' && (
              <div
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 ${tooltipFontClass} font-mono text-white shadow-lg pointer-events-none whitespace-nowrap`}
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
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
