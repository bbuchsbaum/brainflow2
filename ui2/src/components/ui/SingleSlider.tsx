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
}

export const SingleSlider: React.FC<SingleSliderProps> = ({
  min,
  max,
  value,
  label,
  onChange,
  showPercentage = false,
  className = ''
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
  const displayValue = showPercentage ? Math.round(localValue * 100) : localValue.toFixed(1);

  return (
    <div className={`single-slider ${className}`} style={{ marginBottom: className?.includes('mb-0') ? '0' : '16px' }}>
      {/* Label and value display */}
      <div className="flex justify-between items-center" style={{ marginBottom: '8px' }}>
        <label className="text-[13px] font-medium" style={{ color: 'var(--layer-text)' }}>
          {label}
        </label>
        <span className="text-[11px] font-mono tabular-nums" style={{ color: '#94a3b8' }}>
          {showPercentage ? `${Math.round(localValue * 100)}%` : localValue.toFixed(1)}
        </span>
      </div>

      {/* Slider track */}
      <div className="relative h-8 flex items-center">
        <div
          ref={trackRef}
          className="relative w-full h-[3px] rounded-full"
          style={{ backgroundColor: 'var(--layer-track-bg)' }}
        >
          {/* Filled portion */}
          <div
            className="absolute h-full rounded-full"
            style={{
              backgroundColor: 'var(--layer-accent)',
              width: `${percent}%`
            }}
          />

          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
            style={{ left: `${percent}%` }}
            onMouseDown={handleMouseDown}
          >
            <div
              className="w-[14px] h-[14px] rounded-full border border-white shadow-[0_0_2px_black] transition-transform absolute top-[-5px]"
              style={{
                backgroundColor: 'var(--layer-accent)',
                transform: isDragging ? 'scale(1.1)' : 'scale(1)'
              }}
            />
            {/* Tooltip */}
            {showTooltip && (
              <div
                className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 text-[11px] text-white rounded shadow-lg pointer-events-none whitespace-nowrap"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
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