import React from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  label: string;
  disabled?: boolean;
  showValue?: boolean;
  precision?: number;
  onChange: (value: number) => void;
}

export const Slider: React.FC<SliderProps> = ({
  min,
  max,
  step = 1,
  value,
  label,
  disabled = false,
  showValue = true,
  precision = 1,
  onChange
}) => {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const newValue = parseFloat(event.target.value);
    onChange(newValue);
  }

  function formatValue(val: number): string {
    return val.toFixed(precision);
  }

  return (
    <div className="slider">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-700">{label}</label>
        {showValue && (
          <span className="text-xs text-gray-500">{formatValue(value)}</span>
        )}
      </div>
      
      <div className="relative">
        <input
          type="range"
          className={`${styles.sliderInput} w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer`}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};