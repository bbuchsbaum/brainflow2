import React, { useState, useRef, useCallback, useEffect } from 'react';
import { debounce } from '@/utils/debounce';

interface SingleSliderProps {
  min: number;
  max: number;
  value: number;
  label: string;
  onChange: (value: number) => void;
  showPercentage?: boolean;
  className?: string;
  disabled?: boolean;
  /**
   * Layout mode: stacked (label above) or strip (label left, value right)
   */
  layout?: 'stacked' | 'strip';
  /**
   * Custom formatter for display value (overrides showPercentage/toFixed)
   */
  formatValue?: (value: number) => string;
  /**
   * Optional widths for strip layout
   */
  labelWidth?: string | number;
  valueWidth?: string | number;
  /**
   * Compact mode: reduced vertical footprint for dense layouts (grids)
   * - Smaller label font
   * - Tighter spacing
   * - Inline label + value
   */
  compact?: boolean;
  /**
   * High contrast mode: uses foreground color instead of muted for labels/values
   * (fixes washout on dark/muted backgrounds)
   */
  highContrast?: boolean;
}

export const SingleSlider: React.FC<SingleSliderProps> = ({
  min,
  max,
  value,
  label,
  onChange,
  showPercentage = false,
  className = '',
  disabled = false,
  layout = 'stacked',
  formatValue,
  labelWidth,
  valueWidth,
  compact = false,
  highContrast = false
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  
  // Store the latest onChange in a ref to avoid recreating debounced function
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create stable debounced function that uses the ref
  const debouncedOnChange = useRef(
    debounce((newValue: number) => {
      onChangeRef.current(newValue);
    }, 120)
  ).current;

  // Convert value to position percentage
  const valueToPercent = (val: number): number => {
    // Guard against division by zero when min === max
    if (max === min) return 50; // Center the thumb when range is zero
    return ((val - min) / (max - min)) * 100;
  };

  // Convert position to value
  const percentToValue = (percent: number): number => {
    return min + (percent / 100) * (max - min);
  };

  // Handle thumb drag
  const handleThumbDrag = useCallback((e: MouseEvent) => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newValue = percentToValue(percent);
    setLocalValue(newValue);
  }, [min, max]);

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
    setShowTooltip(true);

    const handleMouseMove = (e: MouseEvent) => {
      requestAnimationFrame(() => {
        handleThumbDrag(e);
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setShowTooltip(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Update local value when prop changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Call debounced onChange when local value changes
  useEffect(() => {
    debouncedOnChange(localValue);
  }, [localValue]); // debouncedOnChange is now stable, no need in deps

  const percent = valueToPercent(localValue);
  const displayValue = formatValue
    ? formatValue(localValue)
    : showPercentage
      ? `${Math.round(localValue * 100)}%`
      : localValue.toFixed(1);

  // Color tokens - highContrast uses direct foreground instead of muted CSS vars
  const labelColor = highContrast
    ? 'hsl(var(--foreground) / 0.92)'
    : 'hsl(var(--foreground) / 0.7)';
  const valueColor = highContrast
    ? 'hsl(var(--foreground) / 0.85)'
    : 'hsl(var(--foreground) / 0.65)';
  const trackBg = 'hsl(var(--border) / 0.72)';
  const accentColor = 'hsl(var(--primary))';

  if (layout === 'strip') {
    const resolvedLabelWidth = labelWidth ?? '6rem';
    const resolvedValueWidth = valueWidth ?? '3.5rem';
    return (
      <div
        className={`single-slider-strip flex items-center gap-3 py-1.5 border-b border-border/40 last:border-b-0 ${className}`}
      >
        <label
          className="text-[10px] uppercase tracking-wider font-bold text-right shrink-0 truncate"
          style={{ color: labelColor, width: resolvedLabelWidth }}
        >
          {label}
        </label>
        <div className={`flex-1 relative h-4 flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div
            ref={trackRef}
            className="relative w-full h-[2px]"
            style={{ backgroundColor: trackBg, overflow: 'visible' }}
          >
            <div
              className="absolute h-full"
              style={{ backgroundColor: accentColor, width: `${percent}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
              style={{ left: `${percent}%` }}
              onMouseDown={handleMouseDown}
            >
              <div
                className="w-[6px] h-[12px] transition-all absolute top-[-5px]"
                style={{
                  backgroundColor: accentColor,
                  borderRadius: '1px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                  transform: isDragging ? 'scaleY(1.1)' : 'scaleY(1)'
                }}
              />
              {showTooltip && (
                <div
                  className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[9px] font-mono text-white shadow-lg pointer-events-none whitespace-nowrap"
                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
                >
                  {displayValue}
                </div>
              )}
            </div>
          </div>
        </div>
        <span
          className="text-[10px] font-mono tabular-nums text-right shrink-0"
          style={{ color: valueColor, width: resolvedValueWidth }}
        >
          {displayValue}
        </span>
      </div>
    );
  }

  // Compact mode: single line with smaller track
  if (compact) {
    return (
      <div className={`single-slider-compact ${className}`}>
        {/* Compact: Label left, value right, track below - minimal height */}
        <div className="flex justify-between items-baseline" style={{ marginBottom: '4px' }}>
          <label
            className="text-[9px] uppercase tracking-widest font-semibold truncate"
            style={{ color: labelColor, maxWidth: '70%' }}
          >
            {label}
          </label>
          <span
            className="text-[9px] font-mono tabular-nums"
            style={{ color: valueColor }}
          >
            {showPercentage ? `${Math.round(localValue * 100)}%` : localValue.toFixed(1)}
          </span>
        </div>

        {/* Compact track - 4px tall container, 2px track */}
        <div className={`relative h-4 flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div
            ref={trackRef}
            className="relative w-full h-[2px]"
            style={{ backgroundColor: trackBg, overflow: 'visible' }}
          >
            {/* Filled portion */}
            <div
              className="absolute h-full"
              style={{ backgroundColor: accentColor, width: `${percent}%` }}
            />

            {/* Thumb - smaller for compact */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
              style={{ left: `${percent}%` }}
              onMouseDown={handleMouseDown}
            >
              <div
                className="w-[6px] h-[12px] transition-all absolute top-[-5px]"
                style={{
                  backgroundColor: accentColor,
                  borderRadius: '1px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                  transform: isDragging ? 'scaleY(1.1)' : 'scaleY(1)'
                }}
              />
              {showTooltip && (
                <div
                  className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[9px] font-mono text-white shadow-lg pointer-events-none whitespace-nowrap"
                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
                >
                  {displayValue}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standard mode
  return (
    <div className={`single-slider ${className}`} style={{ marginBottom: className?.includes('mb-0') ? '0' : '8px' }}>
      {/* Label and value display - Instrument Control style */}
      <div className="flex justify-between items-baseline" style={{ marginBottom: '6px' }}>
        <label
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ color: labelColor }}
        >
          {label}
        </label>
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: valueColor }}
        >
          {showPercentage ? `${Math.round(localValue * 100)}%` : localValue.toFixed(1)}
        </span>
      </div>

      {/* Slider track - thin 2px track */}
      <div className={`relative h-5 flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div
          ref={trackRef}
          className="relative w-full h-[2px]"
          style={{ backgroundColor: trackBg, overflow: 'visible' }}
        >
          {/* Filled portion - no border-radius */}
          <div
            className="absolute h-full"
            style={{ backgroundColor: accentColor, width: `${percent}%` }}
          />

          {/* Thumb - rectangular Albers style */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${percent}%` }}
            onMouseDown={handleMouseDown}
          >
            <div
              className="w-[8px] h-[16px] transition-all absolute top-[-7px]"
              style={{
                backgroundColor: accentColor,
                borderRadius: '1px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
                transform: isDragging ? 'scaleY(1.1)' : 'scaleY(1)'
              }}
            />
            {/* Tooltip */}
            {showTooltip && (
              <div
                className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-mono text-white shadow-lg pointer-events-none whitespace-nowrap"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', borderRadius: '1px' }}
              >
                {displayValue}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
