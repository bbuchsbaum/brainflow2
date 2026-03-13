import React from 'react';
import { ColormapPicker } from './ColormapPicker';
export { colormaps } from './colormapOptions';

interface ColormapSelectorProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export const ColormapSelector: React.FC<ColormapSelectorProps> = ({
  value,
  disabled = false,
  onChange,
}) => (
  <ColormapPicker
    value={value}
    disabled={disabled}
    onChange={onChange}
    variant="default"
  />
);
