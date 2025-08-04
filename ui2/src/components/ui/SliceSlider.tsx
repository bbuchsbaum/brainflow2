/**
 * SliceSlider Component
 * A slider control for navigating through slices in world space coordinates
 */

import React, { useState } from 'react';
import type { ViewType } from '@/types/coordinates';
import { useDragSourceStore } from '@/stores/dragSourceStore';

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
  const { setDraggingSource } = useDragSourceStore();
  
  // Debug logging
  React.useEffect(() => {
    console.log(`SliceSlider ${viewType}: value=${value}, min=${min}, max=${max}, step=${step}`);
  }, [viewType, value, min, max, step]);
  
  // Get the axis label based on view type
  const axisLabel = viewType === 'axial' ? 'Z' : viewType === 'sagittal' ? 'X' : 'Y';
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    
    // Prevent feedback loops - only update if value actually changed
    if (Math.abs(newValue - value) < 0.01) {
      console.log(`SliceSlider ${viewType}: onChange fired but value unchanged (${newValue} ≈ ${value}), skipping update`);
      return;
    }
    
    console.log(`SliceSlider ${viewType}: onChange fired - value changed from ${value} to ${newValue}`);
    onChange(newValue);       // Trigger parent update
  };
  
  
  // Handle pointer events for better drag support
  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    console.log(`SliceSlider ${viewType}: Pointer down - setting drag source`);
    setIsDragging(true);
    setDraggingSource('slider');  // Notify global state
    // Capture pointer for consistent drag behavior
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    console.log(`SliceSlider ${viewType}: Pointer up - clearing drag source`);
    setIsDragging(false);
    setDraggingSource(null);  // Clear global state
    // Release pointer capture
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!isDragging) return;
    
    // Calculate value from pointer position during drag
    const input = e.currentTarget;
    const rect = input.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newValue = min + (max - min) * percentage;
    
    // Snap to step
    const steppedValue = Math.round(newValue / step) * step;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));
    
    // Prevent excessive updates during drag - only update if value actually changed
    if (Math.abs(clampedValue - value) < 0.01) {
      return; // Skip update if value hasn't changed meaningfully
    }
    
    console.log(`SliceSlider ${viewType}: Pointer move - value changed from ${value} to ${clampedValue}`);
    onChange(clampedValue);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLInputElement>) => {
    // Ensure cleanup if pointer is cancelled
    if (isDragging) {
      console.log(`SliceSlider ${viewType}: Pointer cancel - clearing state`);
      setIsDragging(false);
      setDraggingSource(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Clean up drag state on unmount
  React.useEffect(() => {
    return () => {
      if (isDragging) {
        setDraggingSource(null);
      }
    };
  }, []);
  
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerCancel={handlePointerCancel}
        className="w-full h-5 bg-gray-700 rounded accent-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 slider-custom"
      />
    </div>
  );
}