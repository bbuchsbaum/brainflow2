import React from 'react';
import RangeSliderInput from 'react-range-slider-input';
import 'react-range-slider-input/dist/style.css';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  label: string;
  disabled?: boolean;
  showValues?: boolean;
  precision?: number;
  onChange: (value: [number, number]) => void;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  step = 1,
  value,
  label,
  disabled = false,
  showValues = true,
  precision = 1,
  onChange
}) => {
  function handleChange(newValue: number[]) {
    // Ensure we always get exactly 2 values
    if (newValue.length === 2) {
      onChange([newValue[0], newValue[1]]);
    }
  }

  function formatValue(val: number): string {
    return val.toFixed(precision);
  }

  const customStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 0'
  };

  return (
    <div className="custom-range-slider" style={{ width: '100%' }}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-neutral-300">{label}</label>
        {showValues && (
          <span className="text-xs text-neutral-400">
            {formatValue(value[0])} - {formatValue(value[1])}
          </span>
        )}
      </div>
      
      <div style={customStyles} className="range-slider-dark">
        <RangeSliderInput
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onInput={handleChange}
        />
      </div>
    </div>
  );
};