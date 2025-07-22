/**
 * SliceSlider Component
 * A slider control for navigating through slices in world space coordinates
 */

import React from 'react';
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
  // Get the axis label based on view type
  const axisLabel = viewType === 'axial' ? 'Z' : viewType === 'sagittal' ? 'X' : 'Y';
  const directionLabel = viewType === 'axial' ? 'Inf ↔ Sup' : viewType === 'sagittal' ? 'L ↔ R' : 'Post ↔ Ant';
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    onChange(newValue);
  };
  
  // Format the value for display
  const displayValue = value.toFixed(1);
  
  return (
    <div className="flex flex-col gap-1 p-2 bg-gray-800 border-t border-gray-600 relative z-10">
      <div className="flex justify-between text-xs text-white">
        <span className="font-medium">{axisLabel}: {displayValue}mm</span>
        <span className="text-gray-400">{directionLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className="w-full h-5 appearance-none bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
          [&::-webkit-slider-track]:w-full [&::-webkit-slider-track]:h-1 [&::-webkit-slider-track]:bg-gray-600 [&::-webkit-slider-track]:rounded-sm
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-mt-1.5
          [&::-moz-range-track]:w-full [&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-gray-600 [&::-moz-range-track]:rounded-sm
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}