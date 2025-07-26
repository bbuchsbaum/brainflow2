/**
 * SliceSlider Component
 * A slider control for navigating through slices in world space coordinates
 */

import React, { useState } from 'react';
import type { ViewType } from '@/types/coordinates';

interface SliceSliderProps {
  viewType: ViewType;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function SliceSlider({
  viewType,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange
}: SliceSliderProps) {
  const [showValue, setShowValue] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Debug logging
  React.useEffect(() => {
    console.log(`SliceSlider ${viewType}: value=${value}, min=${min}, max=${max}, step=${step}`);
  }, [viewType, value, min, max, step]);
  
  // Get the axis label based on view type
  const axisLabel = viewType === 'axial' ? 'Z' : viewType === 'sagittal' ? 'X' : 'Y';
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    console.log(`SliceSlider ${viewType}: value changed from ${value} to ${newValue}`);
    onChange(newValue);
  };
  
  // Handle drag state
  React.useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging]);
  
  // Format the value for display
  const displayValue = value.toFixed(1);
  
  // Calculate position for the value label (0-100% based on slider position)
  const percentage = max !== min ? ((value - min) / (max - min)) * 100 : 50;
  // Clamp percentage to keep label visible at edges
  const clampedPercentage = Math.max(10, Math.min(90, percentage));
  
  return (
    <div 
      className="relative p-1.5 bg-gray-800 border-t border-gray-600 flex-shrink-0"
      onMouseEnter={() => setShowValue(true)}
      onMouseLeave={() => setShowValue(false)}
    >
      {/* Value indicator that appears on hover/drag */}
      {(showValue || isDragging) && (
        <div 
          className="absolute bottom-full mb-2 text-green-500 text-xs font-medium pointer-events-none whitespace-nowrap"
          style={{ 
            left: `${percentage}%`,
            transform: 'translateX(-50%)'
          }}
        >
          {axisLabel}: {displayValue}mm
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onMouseDown={() => setIsDragging(true)}
        onTouchStart={() => setIsDragging(true)}
        className="w-full h-5 bg-gray-700 rounded accent-blue-500"
      />
    </div>
  );
}